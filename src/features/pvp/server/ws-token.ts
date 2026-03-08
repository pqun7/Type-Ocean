import "server-only";

import { SignJWT } from "jose";
import crypto from "crypto";

import { getPvpWsTokenTtlSeconds } from "@/lib/pvp/fingerprint";

export type PvpWsTokenPayload = {
  sub: string;
  username: string;
  avatar: string | null;
  pvpRating: number;
  pvpDeviation: number;
  fingerprint: string;
  tokenVersion: number;
  tokensValidAfter: Date;
};

function getSecretKey() {
  const raw = process.env.PVP_GATEWAY_JWT_SECRET;
  if (!raw) {
    throw new Error("Missing PVP_GATEWAY_JWT_SECRET");
  }
  return new TextEncoder().encode(raw);
}

export async function mintPvpWsToken(payload: PvpWsTokenPayload, ttlSeconds = getPvpWsTokenTtlSeconds()) {
  const now = Math.floor(Date.now() / 1000);
  const effectiveTtlSeconds = Math.max(60, Math.min(getPvpWsTokenTtlSeconds(), Math.floor(ttlSeconds || getPvpWsTokenTtlSeconds())));
  const exp = now + effectiveTtlSeconds;

  const token = await new SignJWT({
    username: payload.username,
    avatar: payload.avatar,
    pvpRating: payload.pvpRating,
    pvpDeviation: payload.pvpDeviation,
    fp: payload.fingerprint,
    tv: payload.tokenVersion,
    va: Math.floor(payload.tokensValidAfter.getTime() / 1000),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(crypto.randomUUID())
    .sign(getSecretKey());

  return { token, expiresAt: exp };
}
