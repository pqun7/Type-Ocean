const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
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

  const clientSecret = process.env.PVP_FIXED_CLIENT_SECRET || 'k6LoadClientSecret_abcdefghijklmnopqrstuvwxyz12';
  const userAgent = process.env.PVP_WS_USER_AGENT || 'k6-ai-stress/1.0';
  const tokenCount = Number(process.env.PVP_AI_STRESS_TOKEN_COUNT || '600');

  const prisma = new PrismaClient();
  const key = new TextEncoder().encode(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + 3600;
  const fingerprint = hashPvpFingerprint({ userAgent, clientSecret });

  const tokens = [];

  for (let i = 1; i <= tokenCount; i += 1) {
    const email = `pvp_load_ai_${i}@local.test`;
    const username = `pvp_load_ai_${i}`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        username,
        banned: false,
      },
      create: {
        email,
        username,
        passwordHash: null,
        banned: false,
      },
      select: {
        id: true,
        username: true,
        pvpWsTokenVersion: true,
        pvpWsTokensValidAfter: true,
        profile: { select: { avatar: true } },
      },
    });

    const rating = await prisma.pvpRating.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
      select: { rating: true, deviation: true },
    });

    const token = await new SignJWT({
      username: user.username,
      avatar: user.profile?.avatar ?? null,
      pvpRating: rating.rating,
      pvpDeviation: rating.deviation,
      fp: fingerprint,
      tv: user.pvpWsTokenVersion ?? 0,
      va: Math.floor((user.pvpWsTokensValidAfter ?? new Date(0)).getTime() / 1000),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuedAt(nowSec)
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

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
