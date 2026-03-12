import type Redis from "ioredis";

type RedisMetricClient = Pick<Redis, "incr" | "incrbyfloat">;

const QUEUE_WAIT_COUNT_KEY = "pvp:metrics:queue_wait_count";
const QUEUE_WAIT_SUM_KEY = "pvp:metrics:queue_wait_sum_ms";
const MATCH_QUALITY_COUNT_KEY = "pvp:metrics:match_quality_count";
const MATCH_QUALITY_SUM_KEY = "pvp:metrics:match_quality_sum";

export async function recordQueueMatchMetrics(
  redis: RedisMetricClient | null | undefined,
  params: { queueWaitMs: number[]; ratingDelta: number }
) {
  if (!redis) return;

  await Promise.all([
    ...params.queueWaitMs.map((queueWaitMs) => redis.incrbyfloat(QUEUE_WAIT_SUM_KEY, queueWaitMs)),
    ...params.queueWaitMs.map(() => redis.incr(QUEUE_WAIT_COUNT_KEY)),
    redis.incr(MATCH_QUALITY_COUNT_KEY),
    redis.incrbyfloat(MATCH_QUALITY_SUM_KEY, params.ratingDelta),
  ]);
}