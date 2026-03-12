import { deleteValue, readJsonValue, writeJsonValue, type RedisLike } from "./store";

const REPLAY_TTL_SECONDS = 6 * 60 * 60;

function nonceKey(matchId: string) {
  return `pvp:anti-cheat:v2:replay:${matchId}:nonce`;
}

function seqKey(matchId: string, userId: string) {
  return `pvp:anti-cheat:v2:replay:${matchId}:user:${userId}:seq`;
}

export async function registerReplayNonce(redis: RedisLike | null | undefined, matchId: string, inputNonce: string | null | undefined) {
  if (!inputNonce) return;
  await writeJsonValue(redis, nonceKey(matchId), inputNonce, REPLAY_TTL_SECONDS);
}

export async function validateReplayProtectedInput(params: {
  redis?: RedisLike | null;
  matchId: string;
  userId: string;
  seq: number;
  inputNonce?: string | null;
  expectedNonce?: string | null;
}) {
  const redis = params.redis ?? null;
  const persistedNonce = await readJsonValue<string>(redis, nonceKey(params.matchId));
  const expectedNonce = persistedNonce ?? params.expectedNonce ?? null;

  if (expectedNonce) {
    if (!params.inputNonce) {
      return { accept: false as const, reason: "missing_nonce" as const };
    }

    if (params.inputNonce !== expectedNonce) {
      return { accept: false as const, reason: "mismatch_nonce" as const };
    }
  }

  const lastSeq = await readJsonValue<number>(redis, seqKey(params.matchId, params.userId));
  if (typeof lastSeq === "number" && params.seq <= lastSeq) {
    return { accept: false as const, reason: "replayed_seq" as const, lastSeq };
  }

  return { accept: true as const };
}

export async function registerAcceptedReplaySeq(
  redis: RedisLike | null | undefined,
  matchId: string,
  userId: string,
  seq: number
) {
  await writeJsonValue(redis, seqKey(matchId, userId), seq, REPLAY_TTL_SECONDS);
}

export async function clearReplayProtection(
  redis: RedisLike | null | undefined,
  matchId: string,
  userIds: string[]
) {
  await Promise.all([
    deleteValue(redis, nonceKey(matchId)),
    ...userIds.map((userId) => deleteValue(redis, seqKey(matchId, userId))),
  ]);
}