import type { ConnectionUser, QueueEntry } from "./state";
import {
  areMatchmakingPreferencesCompatible,
  canUsersMatchByRating,
  DEFAULT_QUEUE_BAND_CONFIG,
} from "./matchmaking/bands";

export type QueueMatchResult =
  | {
      kind: "matched";
      users: [ConnectionUser, ConnectionUser];
      queueWaitMs: [number, number];
    }
  | {
      kind: "searching";
    };

export function enqueueOrMatchInMemory(params: {
  queue: QueueEntry[];
  user: ConnectionUser;
  ratingRange: number;
  nowMs?: number;
  requestId?: string;
  connectionId?: string;
}): QueueMatchResult {
  const { queue, user, ratingRange } = params;
  const nowMs = params.nowMs ?? Date.now();

  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index]?.user.userId === user.userId) {
      queue.splice(index, 1);
    }
  }

  const idx = queue.findIndex(
    (entry) => {
      if (entry.user.userId === user.userId) return false;
      if (!areMatchmakingPreferencesCompatible(entry.user.matchmakingPreference, user.matchmakingPreference)) {
        return false;
      }

      return canUsersMatchByRating({
        myRating: user.pvpRating,
        otherRating: entry.user.pvpRating,
        myJoinedAtMs: nowMs,
        otherJoinedAtMs: entry.joinedAtMs,
        nowMs,
        config: {
          ...DEFAULT_QUEUE_BAND_CONFIG,
          initialRange: ratingRange,
        },
      });
    }
  );

  if (idx >= 0) {
    const matchedEntry = queue[idx]!;
    const other = queue[idx]!.user;
    queue.splice(idx, 1);
    return {
      kind: "matched",
      users: [other, user],
      queueWaitMs: [Math.max(0, nowMs - matchedEntry.joinedAtMs), 0],
    };
  }

  queue.push({
    user,
    joinedAtMs: nowMs,
    requestId: params.requestId,
    connectionId: params.connectionId,
  });
  return { kind: "searching" };
}