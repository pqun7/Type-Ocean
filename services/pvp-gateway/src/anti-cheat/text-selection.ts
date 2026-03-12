import crypto from "crypto";

import { loadRankedTexts, RANKED_TEXT_MAX_LEN, RANKED_TEXT_MIN_LEN } from "../texts";
import { readJsonValue, writeJsonValue, type RedisLike } from "./store";

const RECENT_TEXT_HISTORY_LIMIT = 5;
const RECENT_TEXT_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSelectionSecret(secretSalt?: string) {
  return secretSalt ?? process.env.PVP_RANKED_TEXT_SECRET ?? process.env.PVP_GATEWAY_JWT_SECRET ?? "type-space-ranked-text";
}

function buildSeedIndex(seed: string, count: number) {
  const digest = crypto.createHash("sha256").update(seed).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16) % count;
}

async function readRecentTextIds(redis: RedisLike | null | undefined, userId: string) {
  return (await readJsonValue<string[]>(redis, `pvp:anti-cheat:v2:text-history:${userId}`)) ?? [];
}

async function writeRecentTextIds(redis: RedisLike | null | undefined, userId: string, textId: string) {
  const current = await readRecentTextIds(redis, userId);
  const next = [textId, ...current.filter((existing) => existing !== textId)].slice(0, RECENT_TEXT_HISTORY_LIMIT);
  await writeJsonValue(redis, `pvp:anti-cheat:v2:text-history:${userId}`, next, RECENT_TEXT_TTL_SECONDS);
}

export async function selectRankedText(params: {
  matchId: string;
  userIds: string[];
  redis?: RedisLike | null;
  secretSalt?: string;
}) {
  const texts = loadRankedTexts();
  if (!texts.length) {
    return { textId: "0", textSnapshot: "The quick brown fox jumps over the lazy dog. ".repeat(60) };
  }

  const recentGroups = await Promise.all(params.userIds.map((userId) => readRecentTextIds(params.redis ?? null, userId)));
  const recentTextIds = new Set(recentGroups.flat());
  const baseIndex = buildSeedIndex(`${params.matchId}:${getSelectionSecret(params.secretSalt)}`, texts.length);

  let selectedIndex = baseIndex;
  for (let offset = 0; offset < texts.length; offset += 1) {
    const candidateIndex = (baseIndex + offset) % texts.length;
    if (!recentTextIds.has(String(candidateIndex))) {
      selectedIndex = candidateIndex;
      break;
    }
  }

  const textId = String(selectedIndex);
  await Promise.all(params.userIds.map((userId) => writeRecentTextIds(params.redis ?? null, userId, textId)));

  return {
    textId,
    textSnapshot: texts[selectedIndex]!,
  };
}

export function getDeterministicRankedTextIndex(matchId: string, count: number, secretSalt?: string) {
  return buildSeedIndex(`${matchId}:${getSelectionSecret(secretSalt)}`, count);
}

export { RANKED_TEXT_MIN_LEN, RANKED_TEXT_MAX_LEN };