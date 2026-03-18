const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env" });
const { neon } = require("@neondatabase/serverless");

(async () => {
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  const jwtSecret = (process.env.PVP_GATEWAY_JWT_SECRET || "").trim();
  if (!dbUrl) throw new Error("DATABASE_URL missing");
  if (!jwtSecret) throw new Error("PVP_GATEWAY_JWT_SECRET missing");

  const logsDir = path.resolve(process.cwd(), "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  const sql = neon(dbUrl);
  const userAgent = "k6-ai-stress/1.0";
  const clientSecret = "k6loadwindowclientsecretfixed12345";
  const fingerprint = crypto.createHash("sha256").update(`${userAgent}\n${clientSecret}`).digest("hex");

  const users = await sql.query(`
    select
      u.id,
      u.username,
      coalesce(pp.avatar, null) as avatar,
      coalesce(r.rating, 1500) as rating,
      coalesce(r.deviation, 350) as deviation,
      coalesce(u."pvpWsTokenVersion", 0) as token_version,
      coalesce(extract(epoch from u."pvpWsTokensValidAfter")::bigint, 0) as valid_after
    from "User" u
    left join player_profile pp on pp."userId" = u.id
    left join pvp_rating r on r."userId" = u.id
    where coalesce(u.banned, false) = false
    order by u."updatedAt" desc
    limit 300
  `);

  const uniqueUsers = [];
  const seenUserIds = new Set();
  for (const row of users) {
    const userId = String(row.id || '');
    if (!userId || seenUserIds.has(userId)) continue;
    seenUserIds.add(userId);
    uniqueUsers.push(row);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + 900;
  const tokens = uniqueUsers.map((row) => jwt.sign({
    sub: row.id,
    username: row.username || "user",
    avatar: row.avatar,
    pvpRating: Number(row.rating) || 1500,
    pvpDeviation: Number(row.deviation) || 350,
    fp: fingerprint,
    tv: Number(row.token_version) || 0,
    va: Number(row.valid_after) || 0,
    iat: nowSec,
    exp: expSec,
  }, jwtSecret, { algorithm: "HS256" }));

  const tokenFile = path.join(logsDir, "pvp_ws_tokens_load_window.json");
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));

  const snapshot = {
    capturedAt: new Date().toISOString(),
    extensionAvailable: false,
    extensionError: null,
    topByCalls: [],
    topByPlanning: [],
  };

  try {
    await sql.query("create extension if not exists pg_stat_statements");
    const ext = await sql.query("select extname from pg_extension where extname = 'pg_stat_statements' limit 1");
    snapshot.extensionAvailable = Array.isArray(ext) && ext.length > 0;

    snapshot.topByCalls = await sql.query(`
      select calls, total_plan_time, mean_plan_time, total_exec_time, mean_exec_time, query
      from pg_stat_statements
      order by calls desc
      limit 20
    `);

    snapshot.topByPlanning = await sql.query(`
      select calls, total_plan_time, mean_plan_time, total_exec_time, mean_exec_time, query
      from pg_stat_statements
      order by total_plan_time desc
      limit 20
    `);
  } catch (error) {
    snapshot.extensionError = error instanceof Error ? error.message : String(error);
  }

  fs.writeFileSync(path.join(logsDir, "pg_stat_statements_before.json"), JSON.stringify(snapshot, null, 2));

  console.log(JSON.stringify({
    tokenCount: tokens.length,
    tokenFile,
    pgSnapshot: path.join(logsDir, "pg_stat_statements_before.json"),
    extensionAvailable: snapshot.extensionAvailable,
    extensionError: snapshot.extensionError,
    clientSecret,
    userAgent,
  }, null, 2));
})();
