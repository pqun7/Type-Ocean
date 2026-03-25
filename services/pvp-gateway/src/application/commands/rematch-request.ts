/**
 * @module application/commands/rematch-request
 * Handles REMATCH_REQUEST — request a rematch after a finished match.
 *
 * Two paths:
 *  - AI opponent: random accept/refuse with cooldown, immediate match creation.
 *  - Human opponent: accumulate accepts, create match when both players agree.
 */

import { eq } from "drizzle-orm";

import { pvpMatches, pvpParticipants } from "../../../../../src/db/schema";
import { selectRankedText } from "../../anti-cheat/text-selection";
import { registerReplayNonce } from "../../anti-cheat/replay";
import { startAiSimulationAdaptive } from "../../ai-simulation";
import { isAiUserId, createInputNonce } from "../../shared/errors";
import { RANKED_MATCH_START_DELAY_MS } from "../../shared/config";
import { gatewayLogInfo } from "../../shared/logger";
import { sendToUser } from "../../presentation/ws-sender";
import { send } from "../../presentation/ws-sender";
import { finalizeMatchIfComplete } from "../finalize-match";
import { maybeBroadcastMatchSnapshot } from "../match-helpers";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { LocalMatch } from "../../shared/types";

export async function handleRematchRequest(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "REMATCH_REQUEST" }>,
  deps: GatewayDeps,
): Promise<void> {
  const match = deps.state.matches.get(msg.payload.matchId) as LocalMatch | undefined;
  if (!match) {
    send(ws, "ERROR", { message: "Unknown match" }, deps);
    return;
  }

  // Re-send MATCH_FOUND if a rematch was already created
  if (match.rematchMatchId) {
    _resendExistingRematch(match.rematchMatchId, ws.user!.userId, deps);
    return;
  }

  if (match.status !== "FINISHED") {
    send(ws, "ERROR", { message: "Match not finished" }, deps);
    return;
  }
  if (match.roomCode !== null) {
    send(ws, "ERROR", { message: "Rematch not supported for rooms" }, deps);
    return;
  }

  const participants = Array.from(match.participants.values());
  if (participants.length !== 2) {
    send(ws, "ERROR", { message: "Rematch only supported for 1v1" }, deps);
    return;
  }

  const meId = ws.user!.userId;
  const me = match.participants.get(meId);
  if (!me) {
    send(ws, "ERROR", { message: "Not a participant" }, deps);
    return;
  }

  const other = participants.find((p) => p.userId !== meId);
  if (!other) {
    send(ws, "ERROR", { message: "Opponent not found" }, deps);
    return;
  }

  // ── AI rematch ────────────────────────────────────────────────────────────
  if (isAiUserId(other.userId)) {
    // AI always accepts — a random 50 % refusal made the feature feel broken.
    // REMATCH_DECLINED is still reachable for human vs human via rematch-response.ts.

    const createdRows = await deps.db
      .insert(pvpMatches)
      .values({ status: "PENDING", textSnapshot: "placeholder" })
      .returning({ id: pvpMatches.id });

    const matchRow = createdRows[0];
    if (!matchRow) {
      send(ws, "ERROR", { message: "Failed to create rematch" }, deps);
      return;
    }

    const rankedText = await selectRankedText({
      matchId: matchRow.id,
      userIds: [meId],
      redis: deps.redisBus?.redis ?? null,
    });
    const inputNonce = createInputNonce();
    const newServerStartAtMs = Date.now() + RANKED_MATCH_START_DELAY_MS;
    const aiUserId = `ai:${matchRow.id}`;

    const local = deps.state.createLocalMatch({
      matchId: matchRow.id,
      roomCode: null,
      users: [
        {
          userId: ws.user!.userId,
          username: ws.user!.username,
          avatar: ws.user!.avatar,
          pvpRating: ws.user!.pvpRating,
          pvpDeviation: ws.user!.pvpDeviation,
          slot: me.slot,
        },
        {
          userId: aiUserId,
          username: other.username,
          avatar: null,
          pvpRating: ws.user!.pvpRating,
          pvpDeviation: 180,
          slot: other.slot,
        },
      ],
      serverStartAtMs: newServerStartAtMs,
      textSnapshot: rankedText.textSnapshot,
      textId: rankedText.textId,
      inputNonce,
    }) as LocalMatch;

    await registerReplayNonce(deps.redisBus?.redis ?? null, matchRow.id, local.inputNonce);

    await deps.db
      .update(pvpMatches)
      .set({
        status: "COUNTDOWN",
        textSnapshot: local.textSnapshot,
        textId: local.textId,
        inputNonce: local.inputNonce,
        serverStartAt: new Date(newServerStartAtMs),
        updatedAt: new Date(),
      })
      .where(eq(pvpMatches.id, matchRow.id));

    await deps.db
      .insert(pvpParticipants)
      .values([{ matchId: matchRow.id, userId: ws.user!.userId, slot: me.slot }])
      .onConflictDoNothing();

    sendToUser(meId, "MATCH_FOUND", {
      matchId: matchRow.id,
      textSnapshot: local.textSnapshot,
      textId: local.textId,
      inputNonce: local.inputNonce,
      serverStartAt: new Date(newServerStartAtMs).toISOString(),
      players: Array.from(local.participants.values()).map((p) => ({
        userId: p.userId,
        username: p.username,
        avatar: p.avatar,
        slot: p.slot,
      })),
    }, deps);

    // Schedule the countdown activation timer so the match transitions to
    // RUNNING at serverStartAtMs instead of relying on the 30 s sweep.
    deps.scheduleCountdownActivation(local);

    await startAiSimulationAdaptive({
      db: deps.db,
      wss: deps.wss,
      matchCache: deps.matchCache,
      matchRepository: deps.matchRepository,
      matchId: matchRow.id,
      humanId: meId,
      aiUserId,
      snapshotIntervalMs: deps.matchSnapshotIntervalMs,
      state: deps.state,
      onFinalizeMatchIfComplete: (matchId) => finalizeMatchIfComplete({ matchId, deps }),
      onBroadcastMatchSnapshot: (matchId, nowMs, intervalMs) => {
        const liveMatch = deps.state.matches.get(matchId) as LocalMatch | undefined;
        if (!liveMatch) return false;
        return maybeBroadcastMatchSnapshot(liveMatch, nowMs, intervalMs, deps);
      },
    });

    return;
  }

  // ── Human vs human rematch ────────────────────────────────────────────────
  let accepted = deps.rematchAcceptedByMatchId.get(match.matchId);
  if (!accepted) {
    accepted = new Set<string>();
    deps.rematchAcceptedByMatchId.set(match.matchId, accepted);
  }
  deps.rematchAcceptedTouchedAtByMatchId.set(match.matchId, Date.now());

  accepted.add(meId);

  const acceptedUserIds = Array.from(accepted);
  sendToUser(meId, "REMATCH_STATUS", { matchId: match.matchId, acceptedUserIds }, deps);
  sendToUser(other.userId, "REMATCH_OFFER", { matchId: match.matchId, fromUserId: meId }, deps);
  sendToUser(other.userId, "REMATCH_STATUS", { matchId: match.matchId, acceptedUserIds }, deps);

  if (accepted.size >= 2) {
    deps.rematchAcceptedByMatchId.delete(match.matchId);
    deps.rematchAcceptedTouchedAtByMatchId.delete(match.matchId);

    const [aConn, bConn] = await Promise.all([
      deps.loadConnectionUser(meId),
      deps.loadConnectionUser(other.userId),
    ]);

    await deps.createLockedHumanRematch({
      sourceMatchId: match.matchId,
      users: [
        { ...aConn, slot: me.slot },
        { ...bConn, slot: other.slot },
      ],
      persistUserIds: [meId, other.userId],
    });
  }

  gatewayLogInfo("Rematch requested", {
    matchId: match.matchId,
    requestedBy: meId,
    acceptedCount: accepted.size,
  });
}

/** Re-send MATCH_FOUND for an already-created rematch to a specific user. */
function _resendExistingRematch(rematchMatchId: string, userId: string, deps: GatewayDeps): boolean {
  const rematch = deps.state.matches.get(rematchMatchId) as LocalMatch | undefined;
  if (!rematch) return false;

  sendToUser(userId, "MATCH_FOUND", {
    matchId: rematch.matchId,
    textSnapshot: rematch.textSnapshot,
    textId: rematch.textId,
    inputNonce: rematch.inputNonce,
    serverStartAt: new Date(rematch.serverStartAtMs).toISOString(),
    players: Array.from(rematch.participants.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      slot: p.slot,
    })),
  }, deps);

  return true;
}
