import { jwtVerify } from "jose";

export type AuthedUser = {
  userId: string;
  username: string;
  avatar: string | null;
  pvpRating: number;
  pvpDeviation: number;
};

function getSecretKey() {
  const raw = process.env.PVP_GATEWAY_JWT_SECRET;
  if (!raw) throw new Error("Missing PVP_GATEWAY_JWT_SECRET");
  return new TextEncoder().encode(raw);
}

export async function verifyWsToken(token: string): Promise<AuthedUser> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: ["HS256"],
  });

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) throw new Error("Invalid token (missing sub)");

  const username = typeof (payload as any).username === "string" ? (payload as any).username : "user";
  const avatar = typeof (payload as any).avatar === "string" ? (payload as any).avatar : null;
  const pvpRating = Number.isFinite((payload as any).pvpRating) ? Math.round((payload as any).pvpRating) : 1500;
  const pvpDeviation = Number.isFinite((payload as any).pvpDeviation)
    ? Math.round((payload as any).pvpDeviation)
    : 350;

  return {
    userId: sub,
    username,
    avatar,
    pvpRating,
    pvpDeviation,
  };
}
