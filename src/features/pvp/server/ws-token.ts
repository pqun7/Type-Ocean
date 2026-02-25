import "server-only";

import { SignJWT } from "jose";
import crypto from "crypto";

export type PvpWsTokenPayload = {
  sub: string;
  username: string;
  avatar: string | null;
  pvpRating: number;
  pvpDeviation: number;
};

function getSecretKey() {
  const raw = process.env.PVP_GATEWAY_JWT_SECRET;
  if (!raw) {
    throw new Error("Missing PVP_GATEWAY_JWT_SECRET");
  }
  return new TextEncoder().encode(raw);
}

export async function mintPvpWsToken(payload: PvpWsTokenPayload, ttlSeconds = 120) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(30, Math.min(600, Math.floor(ttlSeconds)));

  const token = await new SignJWT({
    username: payload.username,
    avatar: payload.avatar,
    pvpRating: payload.pvpRating,
    pvpDeviation: payload.pvpDeviation,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(crypto.randomUUID())
    .sign(getSecretKey());

  return { token, expiresAt: exp };
}
