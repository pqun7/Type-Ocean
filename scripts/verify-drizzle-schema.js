/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

function read(file) {
  return fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
}

function parseDeclaredTablesFromDrizzle(schemaText) {
  const declared = [];
  const regex = /pgTable\(\s*"([^"]+)"/g;
  let match;
  while ((match = regex.exec(schemaText)) !== null) {
    declared.push(match[1]);
  }
  return Array.from(new Set(declared)).sort();
}

async function maybeFetchDbTables() {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) {
    return { ok: false, reason: "DATABASE_URL missing", tables: [] };
  }

  try {
    const { neon } = require("@neondatabase/serverless");
    const sql = neon(url);
    const rows = await sql.query("select table_name from information_schema.tables where table_schema='public' order by table_name");
    return { ok: true, reason: null, tables: rows.map((r) => r.table_name) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      tables: [],
    };
  }
}

(async function main() {
  const drizzleText = read("src/db/schema.ts");
  const declared = parseDeclaredTablesFromDrizzle(drizzleText);

  console.log("=== Drizzle schema summary ===");
  console.log("Declared tables in Drizzle:", declared.length);

  const dbInfo = await maybeFetchDbTables();
  console.log("\n=== Database connectivity ===");
  if (!dbInfo.ok) {
    console.log("DB check skipped/failed:", dbInfo.reason);
  } else {
    const missingInDb = declared.filter((t) => !dbInfo.tables.includes(t));
    const extraInDb = dbInfo.tables.filter((t) => !declared.includes(t));
    console.log("DB tables found:", dbInfo.tables.length);
    console.log("Missing in DB (vs Drizzle schema):", missingInDb.length ? missingInDb.join(", ") : "none");
    console.log("Extra in DB (not in Drizzle schema):", extraInDb.length ? extraInDb.join(", ") : "none");

    if (missingInDb.length > 0) {
      process.exitCode = 1;
    }
  }
})();
