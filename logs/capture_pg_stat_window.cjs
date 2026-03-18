const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env" });
const { neon } = require("@neondatabase/serverless");

(async () => {
  const outputPath = process.argv[2] || "logs/pg_stat_statements_after_window.json";
  const dbUrl = (process.env.DATABASE_URL || "").trim();
  if (!dbUrl) {
    throw new Error("DATABASE_URL missing");
  }

  const sql = neon(dbUrl);
  const snapshot = {
    capturedAt: new Date().toISOString(),
    extensionAvailable: false,
    extensionError: null,
    totals: {
      totalPlanTime: 0,
      totalExecTime: 0,
      planSharePct: 0,
    },
    topByCalls: [],
    topByPlanning: [],
  };

  try {
    await sql.query("create extension if not exists pg_stat_statements");
    const ext = await sql.query("select extname from pg_extension where extname = 'pg_stat_statements' limit 1");
    snapshot.extensionAvailable = Array.isArray(ext) && ext.length > 0;

    const totals = await sql.query(`
      select
        coalesce(sum(total_plan_time), 0) as total_plan_time,
        coalesce(sum(total_exec_time), 0) as total_exec_time
      from pg_stat_statements
    `);

    const totalPlanTime = Number(totals?.[0]?.total_plan_time || 0);
    const totalExecTime = Number(totals?.[0]?.total_exec_time || 0);
    const totalTime = totalPlanTime + totalExecTime;
    snapshot.totals = {
      totalPlanTime,
      totalExecTime,
      planSharePct: totalTime > 0 ? (totalPlanTime / totalTime) * 100 : 0,
    };

    snapshot.topByCalls = await sql.query(`
      select queryid, calls, rows, total_plan_time, mean_plan_time, total_exec_time, mean_exec_time, query
      from pg_stat_statements
      order by calls desc
      limit 50
    `);

    snapshot.topByPlanning = await sql.query(`
      select queryid, calls, rows, total_plan_time, mean_plan_time, total_exec_time, mean_exec_time, query
      from pg_stat_statements
      order by total_plan_time desc
      limit 50
    `);
  } catch (error) {
    snapshot.extensionError = error instanceof Error ? error.message : String(error);
  }

  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outputPath), JSON.stringify(snapshot, null, 2));
  console.log(path.resolve(outputPath));
})();
