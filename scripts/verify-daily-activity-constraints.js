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

  const constraints = await sql.query(`
    select
      tc.constraint_name,
      tc.constraint_type,
      string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
     and tc.table_name = kcu.table_name
    where tc.table_schema = 'public'
      and tc.table_name = 'daily_typing_activity'
      and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
    group by tc.constraint_name, tc.constraint_type
    order by tc.constraint_type, tc.constraint_name
  `);

  console.log("daily_typing_activity constraints:");
  if (constraints.length === 0) {
    console.log("  none");
  } else {
    for (const row of constraints) {
      console.log(`  - ${row.constraint_type}: ${row.constraint_name} (${row.columns})`);
    }
  }

  const duplicates = await sql.query(`
    select "userId", "localDate", count(*) as c
    from "daily_typing_activity"
    group by "userId", "localDate"
    having count(*) > 1
    order by c desc
    limit 20
  `);

  console.log("duplicate userId+localDate rows:", duplicates.length);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
