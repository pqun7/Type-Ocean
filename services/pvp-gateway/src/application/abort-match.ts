/**
 * @module application/abort-match
 *
 * Handles match abort lifecycle:
 *   - `abortMatchLifecycle` — transition to `aborted`, persist DB status,
 *     notify participants, and restore room state.
 *
 * ## Import policy
 * May import from: shared/, application/(deps|match-state|match-helpers|finalize-match|room-helpers),
 * presentation/ws-sender, anti-cheat, drizzle schema.
 */

import { eq } from "drizzle-orm";

import { pvpMatches } from "../../../../src/db/schema";
import { matchStateToDbStatus } from "../match-fsm";
import { clearReplayProtection } from "../anti-cheat/replay";
import { isAiUserId } from "../shared/errors";
import { gatewayLogInfo } from "../shared/logger";
import { toMatchId } from "../shared/branded-ids";
import { applyMatchTransition } from "./match-state";
import { runWithMatchFinalizationLock, scheduleMatchCleanup } from "./match-helpers";
import { tryBeginMatchFinalizationWithDbLock, clearTerminalMatchLiveState } from "./finalize-match";
import { restoreRoomAfterMatch } from "./room-helpers";
import { sendToUser } from "../presentation/ws-sender";
import type { GatewayDeps } from "./deps";
import type { LocalMatch } from "../shared/types";

// =============================================================================
// MATCH ABORT LIFECYCLE
// =============================================================================

/**
 * Full abort sequence for a match: acquire finalization lock, persist ABORTED
 * status, send MATCH_ENDED to all participants, clear replay protection, wipe
 * live state, and restore the room (if applicable).
 *
 * @param reasonCode  `"aborted"` for admin/error aborts; `"no_show"` for
 *                    matches where a player never appeared.
 */
export async function abortMatchLifecycle(params: {
  matchId: string;
  reasonMessage: string;
  reasonCode?: "aborted" | "no_show";
  deps: GatewayDeps;
}): Promise<void> {
  const { deps } = params;
  const match = deps.state.matches.get(params.matchId) as LocalMatch | undefined;
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;

  await runWithMatchFinalizationLock(toMatchId(params.matchId), async () => {
    const dbLock = await tryBeginMatchFinalizationWithDbLock({ db: deps.db, match });
    if (!dbLock) return;

    const reasonCode = params.reasonCode ?? "aborted";
    match.endedReason = reasonCode;

    const transitioned = applyMatchTransition({
      match,
      nextState: "aborted",
      eventBus: deps.eventBus,
      reason: "aborted",
    });
    if (!transitioned) return;

    deps.state.clearAiInterval(match.matchId);

    gatewayLogInfo("Aborting match", {
      matchId: params.matchId,
      reasonCode,
      reasonMessage: params.reasonMessage,
    });

    await deps.db
      .update(pvpMatches)
      .set({
        status: matchStateToDbStatus("aborted"),
        startedAt: reasonCode === "no_show" ? null : new Date(match.serverStartAtMs),
        endedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pvpMatches.id, match.matchId));

    for (const participant of match.participants.values()) {
      if (isAiUserId(participant.userId)) continue;
      sendToUser(participant.userId, "MATCH_ENDED", {
        matchId: match.matchId,
        reason: reasonCode,
        message: params.reasonMessage,
        finalResultsPending: false,
      }, deps);
    }

    await clearReplayProtection(
      deps.redisBus?.redis ?? null,
      match.matchId,
      Array.from(match.participants.values())
        .filter((p) => !isAiUserId(p.userId))
        .map((p) => p.userId),
    );

    match.finalizedAtMs = Date.now();
    await clearTerminalMatchLiveState({
      db: deps.db,
      matchId: match.matchId,
      status: "ABORTED",
    });
    deps.matchCache?.clearMatch(match.matchId);
    scheduleMatchCleanup(toMatchId(match.matchId), deps);

    if (match.roomCode) {
      await restoreRoomAfterMatch(deps.db, match.roomCode, deps);
    }
  }, deps);
}
