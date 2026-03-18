const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { neon } = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-http');
const { sql } = require('drizzle-orm');
const { SignJWT } = require('jose');

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

function sanitizeOpaqueHeaderValue(value, maxLength = 256) {
  return String(value || '').normalize('NFKC').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, Math.max(0, maxLength));
}

function sanitizeUserAgent(value, maxLength = 512) {
  if (typeof value !== 'string') return 'unknown';
  const normalized = sanitizeOpaqueHeaderValue(value, maxLength);
  return normalized || 'unknown';
}

function normalizePvpClientSecret(secret) {
  const normalized = sanitizeOpaqueHeaderValue(secret, 128);
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(normalized)) {
    throw new Error('Invalid fixed client secret for load tokens');
  }
  return normalized;
}

function hashPvpFingerprint({ userAgent, clientSecret }) {
  const normalizedSecret = normalizePvpClientSecret(clientSecret);
  const normalizedAgent = sanitizeUserAgent(userAgent);
  return crypto.createHash('sha256').update(`${normalizedAgent}\n${normalizedSecret}`).digest('hex');
}

async function main() {
  const secret = process.env.PVP_GATEWAY_JWT_SECRET;
  if (!secret) throw new Error('Missing PVP_GATEWAY_JWT_SECRET in env files');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Missing DATABASE_URL in env files');

  const clientSecret = process.env.PVP_FIXED_CLIENT_SECRET || 'k6LoadClientSecret_abcdefghijklmnopqrstuvwxyz12';
  const userAgent = process.env.PVP_WS_USER_AGENT || 'k6-ai-stress/1.0';
  const tokenCount = Number(process.env.PVP_AI_STRESS_TOKEN_COUNT || '600');

  const db = drizzle(neon(databaseUrl));
  const key = new TextEncoder().encode(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + 3600;
  const fingerprint = hashPvpFingerprint({ userAgent, clientSecret });

  const tokens = [];

  for (let i = 1; i <= tokenCount; i += 1) {
    const email = `pvp_load_ai_${i}@local.test`;
    const username = `pvp_load_ai_${i}`;

    const userResult = await db.execute(sql`
      INSERT INTO "User" ("email", "username", "passwordHash", "banned")
      VALUES (${email}, ${username}, NULL, FALSE)
      ON CONFLICT ("email")
      DO UPDATE SET
        "username" = EXCLUDED."username",
        "banned" = FALSE,
        "updatedAt" = NOW()
      RETURNING "id", "username", "pvpWsTokenVersion", "pvpWsTokensValidAfter"
    `);
    const user = userResult.rows[0];
    if (!user) throw new Error(`Failed to upsert user: ${email}`);

    // Avatar is optional in websocket claims and should not block token minting.
    // Avoid coupling this load-test utility to profile table naming differences.
    const avatar = null;

    await db.execute(sql`
      INSERT INTO "pvp_rating" ("userId")
      VALUES (${user.id})
      ON CONFLICT ("userId") DO NOTHING
    `);

    const ratingResult = await db.execute(sql`
      SELECT "rating", "deviation"
      FROM "pvp_rating"
      WHERE "userId" = ${user.id}
      LIMIT 1
    `);
    const rating = ratingResult.rows[0];
    if (!rating) throw new Error(`Missing rating row for user: ${user.id}`);

    const tokenVersion = Number.isFinite(Number(user.pvpWsTokenVersion)) ? Math.trunc(Number(user.pvpWsTokenVersion)) : 0;
    const validAfterMs = user.pvpWsTokensValidAfter ? new Date(user.pvpWsTokensValidAfter).getTime() : 0;
    const validAfterSec = Number.isFinite(validAfterMs) ? Math.floor(validAfterMs / 1000) : 0;

    const issuedAtSec = Math.max(nowSec, validAfterSec + 1);

    const token = await new SignJWT({
      username: user.username,
      avatar,
      pvpRating: Number(rating.rating),
      pvpDeviation: Number(rating.deviation),
      fp: fingerprint,
      tv: tokenVersion,
      va: validAfterSec,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt(issuedAtSec)
      .setExpirationTime(expiresAt)
      .setJti(crypto.randomUUID())
      .sign(key);

    tokens.push(token);
  }

  const outPath = path.join(process.cwd(), 'src', 'load-tests', 'ai-stress-tokens.json');
  fs.writeFileSync(outPath, JSON.stringify(tokens));

  console.log(`Minted ${tokens.length} tokens -> ${outPath}`);
  console.log(`PVP_FIXED_CLIENT_SECRET=${clientSecret}`);
  console.log(`PVP_WS_USER_AGENT=${userAgent}`);

}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
