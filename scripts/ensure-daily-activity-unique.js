/* eslint-disable no-console */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const { neon } = require("@neondatabase/serverless");

async function main() {
  const url = (process.env.DATABASE_URL || "").trim();
  if (!url) {
    console.error("DATABASE_URL is missing");
    process.exit(2);
  }

  const sql = neon(url);

  // Ensure there are no duplicates before adding UNIQUE.
  const duplicates = await sql.query(`
    select "userId", "localDate", count(*) as c
    from "daily_typing_activity"
    group by "userId", "localDate"
    having count(*) > 1
    limit 1
  `);

  if (duplicates.length > 0) {
    console.error("Cannot add UNIQUE(userId, localDate): duplicate rows exist.");
    process.exit(1);
  }

  try {
    await sql.query(`
      alter table "daily_typing_activity"
      add constraint "daily_typing_activity_userId_localDate_key"
      unique ("userId", "localDate")
    `);
    console.log("UNIQUE_CONSTRAINT_ADDED");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("already exists")) {
      console.log("UNIQUE_ALREADY_EXISTS");
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
