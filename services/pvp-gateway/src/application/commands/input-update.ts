/**
 * @module application/commands/input-update
 * Handles INPUT_UPDATE — live keystroke events during a match.
 *
 * Validates replay protection, acquires the match lock, updates participant
 * state, enqueues the DB batch write, and broadcasts PROGRESS.
 */

import { recomputeParticipantStats } from "../../domain/match/participant-stats";
import { validateReplayProtectedInput, registerAcceptedReplaySeq } from "../../anti-cheat/replay";
import { shouldAcceptInputUpdate } from "../../input-update";
import { observeGatewayHistogram, incrementGatewayMetric } from "../../metrics";
import { applyMatchTransition } from "../match-state";
import { appendMatchDelta } from "../match-state";
import { withMatchLock, storeIdempotencyHit, maybeBroadcastMatchSnapshot } from "../match-helpers";
import { finalizeMatchIfComplete } from "../finalize-match";
import { buildProgressPayload } from "../../match-sync";
import { broadcastMatch, send } from "../../presentation/ws-sender";
import { PVP_ERROR_CODES } from "../../../../../src/features/pvp/shared/error-codes";
import { IS_PROD } from "../../shared/config";
import { gatewayLogWarn } from "../../shared/logger";
import type { WsConn } from "../../presentation/ws-conn";
import type { ClientMessage } from "../../protocol";
import type { GatewayDeps } from "../deps";
import type { LocalMatch } from "../../shared/types";
import type { loadIdempotencyHit } from "../match-helpers";

export async function handleInputUpdate(
  ws: WsConn,
  msg: Extract<ClientMessage, { type: "INPUT_UPDATE" }>,
  deps: GatewayDeps,
  idempotency: Awaited<ReturnType<typeof loadIdempotencyHit>>,
): Promise<void> {
  const match = deps.state.matches.get(msg.payload.matchId) as LocalMatch | undefined;
  if (!match) {
    send(ws, "ERROR", { message: "Unknown match" }, deps);
    return;
  }

  const participant = match.participants.get(ws.user!.userId);
  if (!participant) {
    send(ws, "ERROR", { message: "Not joined" }, deps);
    return;
  }

  if (match.state === "waiting_for_both") {
    send(ws, "ERROR", { message: "Waiting for both players to connect" }, deps);
    return;
  }

  const nowMs = Date.now();
  if (nowMs < match.serverStartAtMs) {
    send(ws, "ERROR", { message: "Match not started" }, deps);
    return;
  }

  if (match.state === "countdown") {
    applyMatchTransition({ match, nextState: "live", eventBus: deps.eventBus, reason: "completed" });
  }

  const inputDecision = shouldAcceptInputUpdate({
    lastProcessedSeq: participant.seq,
    incomingSeq: msg.payload.seq,
    cachedProcessedSeq: idempotency?.record?.processedSeq,
  });
  if (!inputDecision.accept) return;

  if (!msg.payload.inputNonce && !IS_PROD) {
    gatewayLogWarn("Accepted INPUT_UPDATE without inputNonce in non-production", {
      matchId: match.matchId,
      userId: ws.user!.userId,
      seq: msg.payload.seq,
      requestId: msg.requestId,
    });
  } else {
    const replayDecision = await validateReplayProtectedInput({
      redis: deps.redisBus?.redis ?? null,
      matchId: match.matchId,
      userId: ws.user!.userId,
      seq: msg.payload.seq,
      inputNonce: msg.payload.inputNonce,
      expectedNonce: match.inputNonce,
    });
    if (!replayDecision.accept) {
      gatewayLogWarn("Rejected INPUT_UPDATE by replay validation", {
        matchId: match.matchId,
        userId: ws.user!.userId,
        reason: replayDecision.reason,
        seq: msg.payload.seq,
        inputNonce: msg.payload.inputNonce ?? null,
        expectedNonce: match.inputNonce ?? null,
      });
      incrementGatewayMetric("pvp_anti_cheat_nonce_reject_total", {
        reason:
          replayDecision.reason === "missing_nonce"
            ? "missing"
            : replayDecision.reason === "mismatch_nonce"
              ? "mismatch"
              : "replayed_seq",
      });
      send(ws, "ERROR", {
        code:
          replayDecision.reason === "missing_nonce"
            ? PVP_ERROR_CODES.INPUT_NONCE_MISSING
            : PVP_ERROR_CODES.INPUT_NONCE_INVALID,
        message:
          replayDecision.reason === "replayed_seq"
            ? "This PvP input was already processed. Please refresh and try again."
            : "This PvP client is out of date. Please refresh and try again.",
        retryable: false,
        details: { requestId: msg.requestId, phase: "input_update_replay" },
      }, deps);
      return;
    }
  }

  const inputUpdateUserId = ws.user!.userId;

  await withMatchLock(match.matchId, async () => {
    const prev = participant.input;
    const next = msg.payload.input;
    if (next.length > match.textSnapshot.length) {
      incrementGatewayMetric("ws_validation_failed", { reason: "input_exceeds_text" });
      send(ws, "ERROR", { message: "Input exceeds match text length" }, deps);
      return;
    }

    const isAppend = next.startsWith(prev);
    const isBackspace = prev.startsWith(next);
    if (!isAppend && !isBackspace) {
      incrementGatewayMetric("ws_validation_failed", { reason: "invalid_input_evolution" });
      send(ws, "ERROR", { message: "Invalid input evolution" }, deps);
      return;
    }

    if (isAppend) {
      const added = next.slice(prev.length);
      if (added.length > 32) {
        incrementGatewayMetric("ws_validation_failed", { reason: "input_delta_too_large" });
        send(ws, "ERROR", { message: "Input delta too large" }, deps);
        return;
      }
    }

    const nextInput = next.slice(0, match.textSnapshot.length);
    const inputStats = recomputeParticipantStats(
      nextInput,
      match.textSnapshot,
      match.serverStartAtMs,
      nowMs,
    );
    participant.input = nextInput;
    participant.errors = inputStats.errors;
    participant.accuracy = inputStats.accuracy;
    participant.wpm = inputStats.wpm;
    participant.seq = msg.payload.seq;
    participant.inputEvents = participant.inputEvents ?? [];
    participant.inputEvents.push({
      atMs: nowMs,
      inputLength: participant.input.length,
      deltaChars: participant.input.length - (participant.lastInputLen ?? 0),
      wpm: participant.wpm,
    });
    if (participant.inputEvents.length > 64) {
      participant.inputEvents.shift();
    }
    participant.lastInputAtMs = nowMs;
    participant.lastInputLen = participant.input.length;
    observeGatewayHistogram("pvp_input_update_chars", participant.input.length, [8, 16, 32, 64, 128, 256, 512, 1024]);

    deps.enqueueInputUpdateBatch(match.matchId, inputUpdateUserId, msg.payload.seq);
    const queuedBatch = deps.pendingInputUpdatesByMatch.get(match.matchId);
    if (queuedBatch && queuedBatch.enqueuedCount >= deps.inputUpdateFlushMaxEnqueued) {
      void deps.flushPendingInputUpdates("threshold");
    }

    await registerAcceptedReplaySeq(
      deps.redisBus?.redis ?? null,
      match.matchId,
      inputUpdateUserId,
      msg.payload.seq,
    );

    if (participant.input.length >= match.textSnapshot.length && participant.finishedAt === null) {
      participant.finishedAt = nowMs;
    }

    const progressPayload = buildProgressPayload(
      match as unknown as Parameters<typeof buildProgressPayload>[0],
      participant,
      nowMs,
    );
    appendMatchDelta(match, { type: "PROGRESS", payload: progressPayload, atMs: nowMs });
    broadcastMatch(match.matchId, "PROGRESS", progressPayload, deps);
    maybeBroadcastMatchSnapshot(match, nowMs, deps.matchSnapshotIntervalMs, deps);

    await storeIdempotencyHit({
      redis: deps.redisBus?.redis ?? null,
      store: deps.idempotencyStore,
      key: idempotency?.key,
      messageType: msg.type,
      value: { processedSeq: msg.payload.seq },
    });

    await finalizeMatchIfComplete({ matchId: match.matchId, deps });
  }, deps);
}
