import type { ConnectionUser, QueueEntry } from "./state";

export type QueueMatchResult =
  | {
      kind: "matched";
      users: [ConnectionUser, ConnectionUser];
    }
  | {
      kind: "searching";
    };

export function enqueueOrMatchInMemory(params: {
  queue: QueueEntry[];
  user: ConnectionUser;
  ratingRange: number;
  nowMs?: number;
}): QueueMatchResult {
  const { queue, user, ratingRange } = params;
  const nowMs = params.nowMs ?? Date.now();

  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index]?.user.userId === user.userId) {
      queue.splice(index, 1);
    }
  }

  const idx = queue.findIndex(
    (entry) =>
      entry.user.userId !== user.userId &&
      Math.abs(entry.user.pvpRating - user.pvpRating) <= ratingRange
  );

  if (idx >= 0) {
    const other = queue[idx]!.user;
    queue.splice(idx, 1);
    return {
      kind: "matched",
      users: [other, user],
    };
  }

  queue.push({ user, joinedAtMs: nowMs });
  return { kind: "searching" };
}