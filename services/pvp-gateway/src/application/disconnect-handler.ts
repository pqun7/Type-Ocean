/**
 * @module application/disconnect-handler
 *
 * Handles match finalization triggered by a disconnect forfeit:
 *   - `finalizeMatchByDisconnectForfeit` — determine forfeit outcome and
 *     call `finalizeMatchResults`.
 *
 * ## Import policy
 * May import from: shared/, application/(deps|match-helpers|finalize-match),
 * presentation/ws-sender, disconnect-forfeit domain module.
 */

import { buildDisconnectForfeitOutcome, runDisconnectForfeitSequence } from "../disconnect-forfeit";
import { gatewayLogWarn } from "../shared/logger";
import { toMatchId } from "../shared/branded-ids";
import { runWithMatchFinalizationLock } from "./match-helpers";
import { finalizeMatchResults } from "./finalize-match";
import { sendToUser } from "../presentation/ws-sender";
import type { GatewayDeps } from "./deps";
import type { LocalMatch } from "../shared/types";

// =============================================================================
// DISCONNECT-FORFEIT FINALIZATION
// =============================================================================

/**
 * Trigger a disconnect-forfeit finalization: builds the outcome, sends
 * MATCH_ENDED to the winner, and persists final results.
 *
 * Silently no-ops if the match is already in a terminal state.
 */
export async function finalizeMatchByDisconnectForfeit(params: {
  matchId: string;
  forfeitedUserId: string;
  deps: GatewayDeps;
}): Promise<void> {
  const { deps } = params;
  const match = deps.state.matches.get(params.matchId) as LocalMatch | undefined;
  if (!match) return;
  if (match.state === "finished" || match.state === "aborted") return;

  await runWithMatchFinalizationLock(toMatchId(params.matchId), async () => {
    const outcome = buildDisconnectForfeitOutcome({
      match: match as unknown as Parameters<typeof buildDisconnectForfeitOutcome>[0]["match"],
      forfeitedUserId: params.forfeitedUserId,
    });
    if (!outcome) return;

    gatewayLogWarn("Applying disconnect forfeit", {
      matchId: params.matchId,
      forfeitedUserId: params.forfeitedUserId,
    });

    const nowMs = Date.now();
    if (outcome.winner.finishedAt == null) outcome.winner.finishedAt = nowMs;
    if (outcome.loser.finishedAt == null) outcome.loser.finishedAt = nowMs + 1;

    match.forfeitedUserId = outcome.loser.userId;
    match.endedReason = "opponent_disconnected";

    await runDisconnectForfeitSequence({
      sendMatchEnded: () => {
        sendToUser(outcome.winner.userId, "MATCH_ENDED", {
          matchId: match.matchId,
          ...outcome.message,
        }, deps);
      },
      finalizeResults: () =>
        finalizeMatchResults({
          matchId: params.matchId,
          placements: outcome.placements,
          reason: "opponent_disconnected",
          deps,
        }),
    });
  }, deps);
}
