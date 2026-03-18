const fs = require('fs');
const path = require('path');

function parseCounter(content, metric) {
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(new RegExp(`^${metric}\\{(.+)\\}\\s+([0-9eE+\\.-]+)$`));
    if (!m) continue;
    map.set(m[1], Number(m[2]));
  }
  return map;
}

const beforeProm = fs.readFileSync('logs/prometheus_before.prom', 'utf8');
const afterProm = fs.readFileSync('logs/prometheus_after.prom', 'utf8');
const before = parseCounter(beforeProm, 'pvp_db_query_total');
const after = parseCounter(afterProm, 'pvp_db_query_total');

console.log('PROM_DB_QUERY_DELTAS');
const keys = new Set([...before.keys(), ...after.keys()]);
for (const k of [...keys].sort()) {
  const d = (after.get(k) || 0) - (before.get(k) || 0);
  if (d !== 0) console.log(`${k} => delta=${Math.trunc(d)}`);
}

const beforePg = JSON.parse(fs.readFileSync('logs/pg_stat_statements_before_window.json', 'utf8'));
const afterPg = JSON.parse(fs.readFileSync('logs/pg_stat_statements_after_window.json', 'utf8'));
const beforeCalls = new Map((beforePg.topByCalls || []).map(r => [String(r.query), Number(r.calls)]));
const afterCalls = new Map((afterPg.topByCalls || []).map(r => [String(r.query), Number(r.calls)]));
console.log('PG_STATEMENTS_PVP_MATCH_DELTAS');
const pgKeys = new Set([...beforeCalls.keys(), ...afterCalls.keys()]);
for (const q of [...pgKeys]) {
  if (!/pvp_match|pvp_participant|pvp_rating|pvp_room/i.test(q)) continue;
  const d = (afterCalls.get(q) || 0) - (beforeCalls.get(q) || 0);
  if (d > 0) console.log(`delta_calls=${Math.trunc(d)} | ${q.replace(/\s+/g,' ').slice(0,140)}...`);
}

console.log('ARTIFACTS');
for (const f of ['logs/prometheus_before.prom','logs/prometheus_after.prom','logs/k6_load_window.txt','logs/pg_stat_statements_before_window.json','logs/pg_stat_statements_after_window.json']) {
  const st = fs.statSync(f);
  console.log(`${f} | ${st.size} bytes | ${st.mtime.toISOString()}`);
}
