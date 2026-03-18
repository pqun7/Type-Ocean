require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env" });
const { neon } = require("@neondatabase/serverless");

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql.query(`
    select conname, pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'pvp_participant'
    order by conname
  `);
  console.log(JSON.stringify(rows, null, 2));
})();
