/**
 * @module application/commands/match-join
 * Handles MATCH_JOIN — join or reconnect to a ranked/room match.
 *
 * Acquires matchJoinLock, performs DB transaction to hydrate local state,
 * and sends MATCH_STATE + optional PROGRESS deltas for reconnect replay.
 */

import { and, eq } from "drizzle-orm";

import { pvpParticipants, users, playerProfiles } from "../../../../../src/db/schema";
import { sanitizeDisplayName, sanitizeAvatarUrl } from "../../../../../src/lib/sanitize";
import { canJoinPvpMatchSocket } from "../../../../../src/features/pvp/server/match-access";
import { PVP_ERROR_CODES } from "../../../../../src/features/pvp/shared/error-codes";
import { buildMatchStatePayload } from "../../match-sync";
import { matchStateFromDbStatus, matchStateToLegacyStatus } from "../../match-fsm";
import { createInitialLiveState } from "../../match-live-state";
import { INSTANCE_ID } from "../../shared/config";
import { gatewayLogDebug, gatewayLogWarn } from "../../shared/logger";
import { storeIdempotencyHit } from "../match-helpers";
import { send } from "../../presentation/ws-sender";
import { toMatchId } from "../../shared/branded-ids";
import type { MatchLiveState } from "../../match-live-state";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { LocalMatch } from "../../shared/types";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleMatchJoin(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "MATCH_JOIN" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const lastSeenRevision = Math.max(0, msg.payload.lastSeenRevision ?? 0);
  const fullUser = await deps.loadConnectionUser(ws.user!.userId);
  ws.user = { ...fullUser, tokenVersion: ws.user!.tokenVersion, validAfter: ws.user!.validAfter, issuedAt: ws.user!.issuedAt };

  gatewayLogDebug("Match join requested", { userId: ws.user.userId, matchId: msg.payload.matchId });
  deps.beginMatchJoinInFlight(msg.payload.matchId, ws.user.userId);

  try {
    await deps.matchJoinLock.runExclusive(async () => {
      const sessionKey = `${msg.payload.matchId}:${ws.user!.userId}`;
      const cachedMatch = deps.state.matches.get(msg.payload.matchId) as LocalMatch | undefined;

      // Fast path: already joined from this socket
      if (
        ws.matchId === msg.payload.matchId &&
        ws.matchSessionKey === sessionKey &&
        cachedMatch?.participants.has(ws.user!.userId)
      ) {
        const cachedPayload = buildMatchStatePayload(
          cachedMatch as unknown as Parameters<typeof buildMatchStatePayload>[0],
        );
        await storeIdempotencyHit({
          redis: deps.redisBus?.redis ?? null,
          store: deps.idempotencyStore,
          key: idempotency?.key,
          messageType: msg.type,
          value: { response: { type: "MATCH_STATE", payload: cachedPayload } },
        });
        send(ws, "MATCH_STATE", cachedPayload, deps);
        return;
      }

      const joinSnapshot = await deps.matchRepository.withTransaction(async (tx) => {
        const dbMatch = await deps.matchRepository.loadForUpdate(tx, msg.payload.matchId);
        const fallbackLiveParticipant = dbMatch?.liveState?.participants?.[ws.user!.userId] ?? null;

        const participantRows = await tx
          .select({
            slot: pvpParticipants.slot,
            username: users.username,
            avatar: playerProfiles.avatar,
          })
          .from(pvpParticipants)
          .innerJoin(users, eq(pvpParticipants.userId, users.id))
          .leftJoin(playerProfiles, eq(pvpParticipants.userId, playerProfiles.userId))
          .where(and(eq(pvpParticipants.matchId, msg.payload.matchId), eq(pvpParticipants.userId, ws.user!.userId)))
          .limit(1);

        const participantRow =
          participantRows[0] ??
          (deps.allowParticipantPersistFallback && fallbackLiveParticipant
            ? { slot: fallbackLiveParticipant.slot, username: fallbackLiveParticipant.username, avatar: fallbackLiveParticipant.avatar }
            : null);

        const matchJoinAccess = canJoinPvpMatchSocket({
          status: dbMatch?.status ?? "FINISHED",
          participantExists: Boolean(participantRow),
          userId: ws.user!.userId,
        });

        if (!matchJoinAccess.allowed) {
          return {
            ok: false as const,
            error: matchJoinAccess.reason === "not_participant" ? "Not a participant" : "Match can no longer be joined",
          };
        }

        if (!dbMatch) {
          return { ok: false as const, error: "Match not found" };
        }

        const participants = await tx
          .select({
            userId: pvpParticipants.userId,
            slot: pvpParticipants.slot,
            username: users.username,
            avatar: playerProfiles.avatar,
          })
          .from(pvpParticipants)
          .innerJoin(users, eq(pvpParticipants.userId, users.id))
          .leftJoin(playerProfiles, eq(pvpParticipants.userId, playerProfiles.userId))
          .where(eq(pvpParticipants.matchId, dbMatch.id));

        const liveState: MatchLiveState =
          dbMatch.liveState ??
          createInitialLiveState({
            state: matchStateFromDbStatus(dbMatch.status),
            participants: participants.map((p) => ({
              userId: p.userId,
              username: sanitizeDisplayName(p.username ?? "user", 32) || "user",
              avatar: sanitizeAvatarUrl(p.avatar ?? null),
              slot: p.slot,
            })),
          });

        const participantsFromLiveState = Object.values(liveState.participants ?? {}).map((p) => ({
          userId: p.userId,
          slot: p.slot,
          username: p.username,
          avatar: p.avatar,
        }));
        const effectiveParticipants = participants.length > 0 ? participants : participantsFromLiveState;

        const participantState = liveState.participants[ws.user!.userId];
        if (participantState) {
          participantState.lastInputAtMs = Date.now();
        }

        if (liveState.reconnectUntilByUserId) {
          delete liveState.reconnectUntilByUserId[ws.user!.userId];
        }

        const staleGap = Math.max(0, dbMatch.revision - lastSeenRevision);
        const shouldReplayProgressDeltas = staleGap > 0 && staleGap <= deps.matchResumeDeltaLimit;
        const progressDeltas = shouldReplayProgressDeltas
          ? (liveState.deltas ?? [])
              .filter((delta) => delta.type === "PROGRESS" && delta.revision > lastSeenRevision)
              .slice(-deps.matchResumeDeltaLimit)
              .map((delta) => delta.payload)
          : [];

        const updateResult = await deps.matchRepository.updateWithRevision(tx, dbMatch.id, {
          expectedRevision: dbMatch.revision,
          nextState: liveState.state,
          liveState,
          instanceId: INSTANCE_ID,
          serverStartAt: dbMatch.serverStartAt,
          startedAt: dbMatch.startedAt,
          endedAt: dbMatch.endedAt,
        });

        return {
          ok: true as const,
          dbMatch,
          participants: effectiveParticipants,
          participantRow,
          liveState,
          revision: updateResult.applied ? updateResult.nextRevision : dbMatch.revision,
          progressDeltas,
        };
      });

      if (!joinSnapshot.ok) {
        gatewayLogWarn("Blocked invalid match join", {
          userId: ws.user!.userId,
          matchId: msg.payload.matchId,
          reason: joinSnapshot.error,
        });
        send(ws, "ERROR", { message: joinSnapshot.error, code: PVP_ERROR_CODES.MATCH_JOIN_REJECTED }, deps);
        return;
      }

      const { participantRow, dbMatch } = joinSnapshot;
      const existingMatch = deps.state.matches.get(msg.payload.matchId);
      if (!existingMatch) {
        const lifecycleState = matchStateFromDbStatus(dbMatch.status);
        const newMatch: LocalMatch = {
          matchId: toMatchId(dbMatch.id),
          roomCode: null,
          state: lifecycleState,
          stateChangedAt: joinSnapshot.liveState.stateChangedAtMs,
          revision: joinSnapshot.revision,
          lastSnapshotBroadcastAtMs: 0,
          status: matchStateToLegacyStatus(lifecycleState),
          textSnapshot: dbMatch.textSnapshot,
          textId: dbMatch.textId ?? null,
          inputNonce: dbMatch.inputNonce ?? null,
          // NTZ fix: read ms from JSONB (timezone-safe) if available; fall back to
          // the Date column only as a last resort (may be 2 h off on UTC+X hosts).
          serverStartAtMs: joinSnapshot.liveState.serverStartAtEpochMs
            ?? (dbMatch.serverStartAt ? dbMatch.serverStartAt.getTime() : Date.now() + 3000),
          participants: new Map(),
          endedReason: joinSnapshot.liveState.endedReason,
          forfeitedUserId: joinSnapshot.liveState.forfeitedUserId,
          rematchMatchId: null,
          finalizedAtMs: joinSnapshot.liveState.finalizedAtMs,
          cleanupScheduledAtMs: null,
          reconnectUntilByUserId: joinSnapshot.liveState.reconnectUntilByUserId ?? {},
          recentDeltas: joinSnapshot.liveState.deltas ?? [],
          tieWindowStartedAt: joinSnapshot.liveState.tieWindowStartedAt ?? null,
          isLowConfidence: joinSnapshot.liveState.isLowConfidence ?? false,
        };
        deps.state.matches.set(dbMatch.id, newMatch as unknown as ReturnType<(typeof deps.state)["createLocalMatch"]>);

        const hydrated = deps.state.matches.get(dbMatch.id) as LocalMatch | undefined;
        if (hydrated) {
          for (const participant of joinSnapshot.participants) {
            const liveParticipant = joinSnapshot.liveState.participants[participant.userId];
            hydrated.participants.set(participant.userId, {
              userId: participant.userId,
              username: sanitizeDisplayName(participant.username ?? "user", 32) || "user",
              avatar: sanitizeAvatarUrl(participant.avatar ?? null),
              slot: participant.slot,
              input: liveParticipant?.input ?? "",
              seq: liveParticipant?.seq ?? 0,
              errors: liveParticipant?.errors ?? 0,
              wpm: liveParticipant?.wpm ?? 0,
              accuracy: liveParticipant?.accuracy ?? 100,
              totalMistakes: liveParticipant?.totalMistakes ?? liveParticipant?.errors ?? 0,
              finishedAt: liveParticipant?.finishedAt ?? null,
              lastInputAtMs: liveParticipant?.lastInputAtMs ?? undefined,
              inputEvents: liveParticipant?.inputEvents ?? [],
            });
          }
        }
      }

      const effective = deps.state.matches.get(msg.payload.matchId) as LocalMatch;
      effective.revision = Math.max(effective.revision, joinSnapshot.revision);
      effective.reconnectUntilByUserId =
        joinSnapshot.liveState.reconnectUntilByUserId ?? effective.reconnectUntilByUserId ?? {};
      effective.recentDeltas = joinSnapshot.liveState.deltas ?? effective.recentDeltas ?? [];

      const effectiveAccess = canJoinPvpMatchSocket({
        status: effective.status,
        participantExists: Boolean(participantRow) || effective.participants.has(ws.user!.userId),
        userId: ws.user!.userId,
        forfeitedUserId: effective.forfeitedUserId,
        endedReason: effective.endedReason,
      });
      if (!effectiveAccess.allowed) {
        gatewayLogWarn("Blocked match join — match already ended", {
          userId: ws.user!.userId,
          matchId: msg.payload.matchId,
          reason: effectiveAccess.reason,
        });
        send(ws, "MATCH_ENDED", {
          matchId: msg.payload.matchId,
          reason: "no_show",
          message: "The match ended before you could join.",
        }, deps);
        return;
      }

      const p = effective.participants.get(ws.user!.userId);
      if (!p) {
        if (!participantRow) {
          send(ws, "ERROR", { message: "Not a participant" }, deps);
          return;
        }
        effective.participants.set(ws.user!.userId, {
          userId: ws.user!.userId,
          username: ws.user!.username,
          avatar: ws.user!.avatar,
          slot: participantRow.slot,
          input: "",
          seq: 0,
          errors: 0,
          wpm: 0,
          accuracy: 100,
          finishedAt: null,
          inputEvents: [],
        });
      }

      ws.matchId = toMatchId(msg.payload.matchId);
      deps.claimMatchSession(msg.payload.matchId, ws.user!.userId, ws);
      deps.clearDisconnectForfeitTimer(msg.payload.matchId, ws.user!.userId);

      if (effective.state === "countdown") {
        // RC-2 fix: Rehydrate via orchestrator (idempotent, computes remaining
        // delay from DB-authoritative serverStartAt, handles gateway restart).
        deps.matchStartOrchestrator?.rehydrate(effective, joinSnapshot.liveState);
      }

      if (effective.roomCode === null && effective.state === "waiting_for_both") {
        // Try to advance to countdown if both players are now joined.
        // advanceToCountdown is idempotent; if not yet ready, rehydrate re-arms
        // the no-show timer (RC-1 fix: timer survives gateway restart).
        const advanced = await deps.matchStartOrchestrator?.advanceToCountdown(effective);
        if (!advanced) {
          deps.matchStartOrchestrator?.rehydrate(effective, joinSnapshot.liveState);
        }
      }

      const matchStatePayload = buildMatchStatePayload(
        effective as unknown as Parameters<typeof buildMatchStatePayload>[0],
      );
      const localResumeDeltas = (effective.recentDeltas ?? [])
        .filter((delta) => delta.type === "PROGRESS" && delta.revision > lastSeenRevision)
        .slice(-deps.matchResumeDeltaLimit)
        .map((delta) => delta.payload);

      const replayProgressDeltas =
        localResumeDeltas.length > 0 ? localResumeDeltas : joinSnapshot.progressDeltas;

      await storeIdempotencyHit({
        redis: deps.redisBus?.redis ?? null,
        store: deps.idempotencyStore,
        key: idempotency?.key,
        messageType: msg.type,
        value: { response: { type: "MATCH_STATE", payload: matchStatePayload } },
      });
      send(ws, "MATCH_STATE", matchStatePayload, deps);

      for (const deltaPayload of replayProgressDeltas) {
        send(ws, "PROGRESS", deltaPayload, deps);
      }
    });
  } finally {
    deps.endMatchJoinInFlight(msg.payload.matchId, ws.user.userId);
  }
}
