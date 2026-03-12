export type InputUpdateDecision =
  | { accept: true }
  | { accept: false; reason: "stale_seq" | "duplicate_request" };

export function shouldAcceptInputUpdate(params: {
  lastProcessedSeq: number;
  incomingSeq: number;
  cachedProcessedSeq?: number | null;
}) : InputUpdateDecision {
  if (params.incomingSeq <= params.lastProcessedSeq) {
    return { accept: false, reason: "stale_seq" };
  }

  if (params.cachedProcessedSeq != null && params.cachedProcessedSeq === params.incomingSeq) {
    return { accept: false, reason: "duplicate_request" };
  }

  return { accept: true };
}