// One-time script to add missing player_profile columns.
// Run: node scripts/add-missing-profile-columns.cjs
"use strict";
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const { neon } = require("@neondatabase/serverless");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set. Check .env.local");
  process.exit(1);
}

const sql = neon(DB_URL);

const columns = [
  ["rating", "integer NOT NULL DEFAULT 1000"],
  ["ratingDeviation", "integer NOT NULL DEFAULT 350"],
  ["ratingUpdatedAt", "timestamp"],
  ["achievements", "jsonb NOT NULL DEFAULT '[]'::jsonb"],
  ["longTermStats", "jsonb"],
  ["avatar", "text"],
  ["hideFromLeaderboard", "boolean NOT NULL DEFAULT false"],
  ["appSettings", "jsonb"],
];

async function run() {
  for (const [col, def] of columns) {
    const stmt = `ALTER TABLE "player_profile" ADD COLUMN IF NOT EXISTS "${col}" ${def}`;
    try {
      await sql.query(stmt);
      console.log("OK  :", col);
    } catch (e) {
      console.error("FAIL:", col, "-", e.message);
    }
  }
  console.log("Done.");
}

run().catch((e) => { console.error(e); process.exit(1); });
