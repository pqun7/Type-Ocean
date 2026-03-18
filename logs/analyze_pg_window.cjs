const fs = require('fs');

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const before = readJson('logs/pg_stat_statements_before_window.json');
const after = readJson('logs/pg_stat_statements_after_window.json');

const beforeById = new Map((before.topByCalls || []).map((q) => [String(q.queryid), q]));

const rows = [];
for (const a of after.topByCalls || []) {
  const id = String(a.queryid);
  const b = beforeById.get(id);
  if (!b) continue;
  rows.push({
    queryid: id,
    calls_before: Number(b.calls || 0),
    calls_after: Number(a.calls || 0),
    calls_delta: Number(a.calls || 0) - Number(b.calls || 0),
    exec_ms_delta: Number(a.total_exec_time || 0) - Number(b.total_exec_time || 0),
    plan_ms_delta: Number(a.total_plan_time || 0) - Number(b.total_plan_time || 0),
    rows_delta: Number(a.rows || 0) - Number(b.rows || 0),
    query: String(a.query || '').replace(/\s+/g, ' ').trim().slice(0, 220),
  });
}

rows.sort((x, y) => y.calls_delta - x.calls_delta);

const top = rows.slice(0, 20);
const pvp = rows.filter((r) => /pvp_/i.test(r.query));

const totals = {
  matching_queries: rows.length,
  total_calls_delta: rows.reduce((s, r) => s + r.calls_delta, 0),
  total_exec_ms_delta: rows.reduce((s, r) => s + r.exec_ms_delta, 0),
  total_plan_ms_delta: rows.reduce((s, r) => s + r.plan_ms_delta, 0),
  pvp_calls_delta: pvp.reduce((s, r) => s + r.calls_delta, 0),
  pvp_exec_ms_delta: pvp.reduce((s, r) => s + r.exec_ms_delta, 0),
  pvp_plan_ms_delta: pvp.reduce((s, r) => s + r.plan_ms_delta, 0),
};

console.log(JSON.stringify({ totals, top, pvp }, null, 2));
