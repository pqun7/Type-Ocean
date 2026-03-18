# PvP Prepared Statements: Measure-First Runbook

This runbook enforces a measurement-first policy before introducing prepared statements.

## Scope

Focus on high-frequency gateway operations backed by pvp_match queries:
- MatchRepository.load
- MatchRepository.loadForUpdate
- MatchRepository.updateWithRevision
- MatchRepository.tryLockFinalization
- MatchRepository.clearLiveStateOnTerminal

## Data Sources

1. Prometheus metrics exported by pvp-gateway `/metrics`.
2. PostgreSQL `pg_stat_statements` in staging or local perf environment.

## Metrics Added In Gateway

- Counter: `pvp_db_query_total{table,operation,query_kind,status}`
- Histogram: `pvp_db_query_duration_ms_bucket{table,operation,query_kind,status,le}`

These metrics are query-operation level and do not change SQL semantics.

## PostgreSQL Requirements

Compose postgres now enables:
- `shared_preload_libraries=pg_stat_statements`
- `pg_stat_statements.track=all`
- `pg_stat_statements.max=10000`
- `track_io_timing=on`
- `compute_query_id=on`

Extension bootstrap file:
- `data/postgres/init/001-enable-pg-stat-statements.sql`

If the database was already initialized before this file existed, run once:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

## Prometheus Queries

Top query operations by traffic:

```promql
sum by (operation, query_kind, status) (rate(pvp_db_query_total[5m]))
```

p95 latency per operation:

```promql
histogram_quantile(
  0.95,
  sum by (le, operation, query_kind, status) (
    rate(pvp_db_query_duration_ms_bucket[5m])
  )
)
```

p99 latency per operation:

```promql
histogram_quantile(
  0.99,
  sum by (le, operation, query_kind, status) (
    rate(pvp_db_query_duration_ms_bucket[5m])
  )
)
```

## pg_stat_statements Queries

Top statements by total planning time:

```sql
SELECT
  calls,
  round(total_plan_time::numeric, 2) AS total_plan_time_ms,
  round(mean_plan_time::numeric, 4) AS mean_plan_time_ms,
  round(total_exec_time::numeric, 2) AS total_exec_time_ms,
  round(mean_exec_time::numeric, 4) AS mean_exec_time_ms,
  round((total_plan_time / NULLIF(total_exec_time, 0))::numeric, 4) AS plan_exec_ratio,
  query
FROM pg_stat_statements
ORDER BY total_plan_time DESC
LIMIT 20;
```

Most-called statements with notable planning overhead:

```sql
SELECT
  calls,
  round(mean_plan_time::numeric, 4) AS mean_plan_time_ms,
  round(mean_exec_time::numeric, 4) AS mean_exec_time_ms,
  round((mean_plan_time / NULLIF(mean_exec_time, 0))::numeric, 4) AS plan_exec_ratio,
  query
FROM pg_stat_statements
WHERE calls >= 1000
ORDER BY plan_exec_ratio DESC, calls DESC
LIMIT 20;
```

## Decision Gate (Go/No-Go)

Introduce prepared statements only when all are true for at least one hot-path statement during representative load:

1. High repetition:
- `calls` is consistently high (for example, >= 1000 in window).

2. Material planning overhead:
- `mean_plan_time` is non-trivial and
- `plan_exec_ratio` indicates planning is meaningful (for example, >= 0.10).

3. User-visible impact:
- p95/p99 latency on matching operation is elevated, and query path is a significant contributor.

4. Better-first checks done:
- Query shape and indexing reviewed first; no cheaper fix gives equivalent ROI.

If any gate fails, do not implement prepared statements yet.

## Execution Checklist

1. Start gateway and traffic scenario.
2. Capture Prometheus operation-level rates and p95/p99.
3. Capture pg_stat_statements snapshot.
4. Document findings and decision.
5. Only if gate passes, open a targeted prepared-statement implementation plan for validated operations.
