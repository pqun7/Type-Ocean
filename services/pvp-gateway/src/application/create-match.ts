/**
 * @module application/create-match
 *
 * Match creation use-cases extracted from main() closures:
 *   - `buildMatchFoundPlayerPayload` — pure helper, builds the player summary
 *   - `startRoomMatch` — create a room match, persist DB rows, broadcast MATCH_FOUND
 *   - `maybeAutoStartPublicRoom` — auto-trigger startRoomMatch for public rooms
 *   - `createRanked1v1Match` — create a ranked 1v1 (human/AI) match, broadcast MATCH_FOUND
 *
 * ## Import policy
 * May import from: shared/, domain/match/, application/deps,
 * presentation/ws-sender, anti-cheat, drizzle schema, rooms, matchmaking.
 */

import { and, eq, inArray, isNull, asc } from "drizzle-orm";

import {
  playerProfiles,
  pvpMatches,
  pvpParticipants,
  pvpRoomMembers,
  pvpRooms,
  users,
} from "../../../../src/db/schema";
import { createInitialLiveState } from "../match-live-state";
import { runGatewayTransaction } from "../gateway-db";
import { selectRankedText } from "../anti-cheat/text-selection";
import { registerReplayNonce } from "../anti-cheat/replay";
import { getPublicRoomStartCondition } from "../rooms/lifecycle";
import { sanitizeDisplayName } from "../../../../src/lib/sanitize";
import { createInputNonce, isAiUserId } from "../shared/errors";
import { RANKED_MATCH_START_DELAY_MS, ROOM_MATCH_START_DELAY_MS, INSTANCE_ID } from "../shared/config";
import { gatewayLogInfo, gatewayLogWarn } from "../shared/logger";
import { incrementGatewayMetric } from "../metrics";
import { broadcastRoom, sendToUser } from "../presentation/ws-sender";
import type { GatewayDeps } from "./deps";
import type { LocalMatch } from "../shared/types";
import type { ConnectionUser } from "../state";

// =============================================================================
// PLAYER PAYLOAD BUILDER (pure helper)
// =============================================================================

/**
 * Build the per-player summary included in `MATCH_FOUND` payloads.
 */
export function buildMatchFoundPlayerPayload(user: ConnectionUser & { slot: number }): {
  userId: string;
  username: string;
  avatar: string | null;
  slot: number;
  rating: number;
  rankTier: string;
  averageWpm: number | null;
} {
  return {
    userId: user.userId,
    username: user.username,
    avatar: user.avatar,
    slot: user.slot,
    rating: user.pvpRating,
    rankTier: user.rankTier ?? "unrated",
    averageWpm: user.averageWpm ?? null,
  };
}

// =============================================================================
// ROOM MATCH CREATION
// =============================================================================

/**
 * Create a room match: persist participant rows, update room status, and
 * broadcast `MATCH_FOUND` to all room sockets.
 *
 * Returns `null` when there are fewer than 2 active members.
 */
export async function startRoomMatch(
  params: {
    roomId: string;
    roomCode: string;
    members: Array<{
      userId: string;
      colorSlot: number;
      readyAt: Date | null;
      leftAt: Date | null;
      user: { username: string | null; profile: { avatar: string | null } | null };
    }>;
    startDelayMs?: number;
  },
  deps: GatewayDeps,
): Promise<{ matchId: string; local: LocalMatch; serverStartAtMs: number } | null> {
  const activeMembers = params.members.filter((member) => member.leftAt === null);
  if (activeMembers.length < 2) {
    return null;
  }

  const serverStartAtMs = Date.now() + (params.startDelayMs ?? ROOM_MATCH_START_DELAY_MS);
  const createdMatchRows = await deps.db
    .insert(pvpMatches)
    .values({
      status: "COUNTDOWN",
      roomId: params.roomId,
      textSnapshot: "placeholder",
      serverStartAt: new Date(serverStartAtMs),
    })
    .returning({ id: pvpMatches.id });

  const match = createdMatchRows[0];
  if (!match) {
    throw new Error("Failed to create room match");
  }

  const local = deps.state.createLocalMatch({
    matchId: match.id,
    roomCode: params.roomCode,
    users: activeMembers.map((member) => ({
      userId: member.userId,
      username: sanitizeDisplayName(member.user.username ?? "user", 32) || "user",
      avatar: member.user.profile?.avatar ?? null,
      pvpRating: 1500,
      pvpDeviation: 350,
      slot: member.colorSlot,
    })),
    serverStartAtMs,
  }) as LocalMatch;

  deps.eventBus.emit("match:countdown", {
    matchId: match.id,
    from: "lobby",
    to: "countdown",
    roomCode: params.roomCode,
    atMs: local.stateChangedAt,
  });

  await deps.db
    .update(pvpMatches)
    .set({ textSnapshot: local.textSnapshot, updatedAt: new Date() })
    .where(eq(pvpMatches.id, match.id));

  if (activeMembers.length > 0) {
    await deps.db
      .insert(pvpParticipants)
      .values(
        activeMembers.map((member) => ({
          matchId: match.id,
          userId: member.userId,
          slot: member.colorSlot,
        })),
      )
      .onConflictDoNothing({ target: [pvpParticipants.matchId, pvpParticipants.userId] });
  }

  await deps.db
    .update(pvpRooms)
    .set({ status: "IN_MATCH", autoStartAt: null, updatedAt: new Date() })
    .where(eq(pvpRooms.id, params.roomId));

  broadcastRoom(params.roomCode, "MATCH_FOUND", {
    matchId: match.id,
    textSnapshot: local.textSnapshot,
    serverStartAt: new Date(serverStartAtMs).toISOString(),
    inputNonce: local.inputNonce,
    players: Array.from(local.participants.values()).map((participant) => ({
      userId: participant.userId,
      username: participant.username,
      avatar: participant.avatar,
      slot: participant.slot,
    })),
  }, deps);

  return { matchId: match.id, local, serverStartAtMs };
}

// =============================================================================
// PUBLIC ROOM AUTO-START
// =============================================================================

/**
 * Check if a public room meets its start condition and, if so, trigger
 * `startRoomMatch`.  Returns `true` when a match was started.
 */
export async function maybeAutoStartPublicRoom(
  roomCode: string,
  deps: GatewayDeps,
): Promise<boolean> {
  const roomRows = await deps.db
    .select({
      id: pvpRooms.id,
      code: pvpRooms.code,
      status: pvpRooms.status,
      visibility: pvpRooms.visibility,
      minPlayers: pvpRooms.minPlayers,
      maxPlayers: pvpRooms.maxPlayers,
      autoStartAt: pvpRooms.autoStartAt,
    })
    .from(pvpRooms)
    .where(eq(pvpRooms.code, roomCode))
    .limit(1);

  const roomBase = roomRows[0] ?? null;
  if (!roomBase || roomBase.status !== "OPEN" || roomBase.visibility !== "PUBLIC") {
    return false;
  }

  const memberRows = await deps.db
    .select({
      userId: pvpRoomMembers.userId,
      colorSlot: pvpRoomMembers.colorSlot,
      readyAt: pvpRoomMembers.readyAt,
      leftAt: pvpRoomMembers.leftAt,
      username: users.username,
      avatar: playerProfiles.avatar,
    })
    .from(pvpRoomMembers)
    .innerJoin(users, eq(pvpRoomMembers.userId, users.id))
    .leftJoin(playerProfiles, eq(pvpRoomMembers.userId, playerProfiles.userId))
    .where(and(eq(pvpRoomMembers.roomId, roomBase.id), isNull(pvpRoomMembers.leftAt)))
    .orderBy(asc(pvpRoomMembers.joinedAt));

  const room = {
    ...roomBase,
    members: memberRows.map((member) => ({
      userId: member.userId,
      colorSlot: member.colorSlot,
      readyAt: member.readyAt,
      leftAt: member.leftAt,
      user: {
        username: member.username,
        profile: { avatar: member.avatar },
      },
    })),
  };

  const startCondition = getPublicRoomStartCondition({
    members: room.members,
    minimumPlayers: room.minPlayers,
    maxPlayers: room.maxPlayers,
    autoStartAt: room.autoStartAt,
  });
  if (!startCondition) {
    return false;
  }

  await startRoomMatch(
    {
      roomId: room.id,
      roomCode: room.code,
      members: room.members,
    },
    deps,
  );
  return true;
}

// =============================================================================
// RANKED 1v1 MATCH CREATION
// =============================================================================

/**
 * Persist a ranked 1v1 match (human vs human or human vs AI), create the
 * in-memory state, register the replay nonce, broadcast `MATCH_FOUND` to
 * human participants, and schedule the no-show timeout for human-only matches.
 */
export async function createRanked1v1Match(
  params: {
    users: Array<ConnectionUser & { slot: number }>;
    persistUserIds: string[];
    startDelayMs?: number;
  },
  deps: GatewayDeps,
): Promise<{ matchId: string; local: LocalMatch; serverStartAtMs: number; payload: unknown }> {
  const matchId = crypto.randomUUID();
  const redis = deps.redisBus?.redis ?? null;

  const hasAiParticipant = params.users.some((user) => isAiUserId(user.userId));
  const initialState: "countdown" | "waiting_for_both" = hasAiParticipant ? "countdown" : "waiting_for_both";
  const initialDbStatus = hasAiParticipant ? "COUNTDOWN" : "PENDING";

  const requestedPersistUserIds = Array.from(
    new Set(params.persistUserIds.filter((userId) => !isAiUserId(userId))),
  );
  let persistUserIds = requestedPersistUserIds;

  if (requestedPersistUserIds.length > 0) {
    const existingUsers = await deps.db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, requestedPersistUserIds));

    const existingUserIds = new Set(existingUsers.map((row) => row.id));
    persistUserIds = requestedPersistUserIds.filter((userId) => existingUserIds.has(userId));

    if (persistUserIds.length !== requestedPersistUserIds.length) {
      incrementGatewayMetric("pvp_match_participant_persist_skipped_total", {
        reason: "user_not_found",
      });
      gatewayLogWarn("Skipping non-persistable ranked participants", {
        matchId,
        requestedPersistUserIds,
        persistedUserIds: persistUserIds,
      });
    }
  }

  const rankedText = await selectRankedText({
    matchId,
    userIds: persistUserIds,
    redis,
  });
  const inputNonce = createInputNonce();
  const liveState = createInitialLiveState({
    state: initialState,
    participants: params.users,
  });

  const serverStartAtMs = Date.now() + (params.startDelayMs ?? RANKED_MATCH_START_DELAY_MS);

  await runGatewayTransaction(deps.db, async (tx) => {
    await tx
      .insert(pvpMatches)
      .values({
        id: matchId,
        status: initialDbStatus,
        textSnapshot: rankedText.textSnapshot,
        textId: rankedText.textId,
        inputNonce,
        serverStartAt: hasAiParticipant ? new Date(serverStartAtMs) : null,
        revision: 1,
        instanceId: INSTANCE_ID,
        liveState: liveState as unknown,
      })
      .onConflictDoNothing({ target: [pvpMatches.id] });

    if (persistUserIds.length) {
      try {
        await tx
          .insert(pvpParticipants)
          .values(
            persistUserIds.map((userId) => ({
              matchId,
              userId,
              slot: params.users.find((u) => u.userId === userId)?.slot ?? 0,
            })),
          )
          .onConflictDoNothing({ target: [pvpParticipants.matchId, pvpParticipants.userId] });
      } catch (error) {
        if (!deps.allowParticipantPersistFallback) {
          throw error;
        }

        incrementGatewayMetric("pvp_match_participant_persist_skipped_total", {
          reason: "insert_failure",
        });

        gatewayLogWarn("Skipping participant persistence for ranked match after insert failure", {
          matchId,
          persistUserIds,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  const local = deps.state.createLocalMatch({
    matchId,
    roomCode: null,
    users: params.users,
    serverStartAtMs,
    initialState,
    textSnapshot: rankedText.textSnapshot,
    textId: rankedText.textId,
    inputNonce,
  }) as LocalMatch;

  if (hasAiParticipant) {
    deps.eventBus.emit("match:countdown", {
      matchId,
      from: "lobby",
      to: "countdown",
      roomCode: null,
      atMs: local.stateChangedAt,
    });
  }

  await registerReplayNonce(redis, matchId, local.inputNonce);

  const payload = {
    matchId,
    textSnapshot: local.textSnapshot,
    textId: local.textId,
    inputNonce: local.inputNonce,
    serverStartAt: new Date(serverStartAtMs).toISOString(),
    players: params.users.map((user) => buildMatchFoundPlayerPayload(user)),
  };

  for (const u of params.users) {
    if (isAiUserId(u.userId)) continue;
    sendToUser(u.userId, "MATCH_FOUND", payload, deps);
  }

  if (!hasAiParticipant) {
    deps.scheduleNoShowTimeout(matchId);
  }

  gatewayLogInfo("Created ranked 1v1 match", {
    matchId,
    hasAiParticipant,
    initialState,
    initialDbStatus,
    userIds: params.users.map((user) => user.userId),
    requestedPersistUserIds,
    persistedUserIds: persistUserIds,
    serverStartDelayMs: Math.max(0, serverStartAtMs - Date.now()),
  });

  return { matchId, local, serverStartAtMs, payload };
}
