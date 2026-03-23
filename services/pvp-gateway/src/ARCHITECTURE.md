# PvP Gateway — Target Architecture

> **Status**: Phase 0 (Baseline & Planning)  
> **Source of truth for all refactoring**: `problem.md`  
> **Design pillars**: Clean Architecture · DDD Aggregates · Vertical Slice · Command Bus

---

## 1. All 14 Problems From `problem.md`

| ID  | Title                                              | Severity   | Phase |
|-----|----------------------------------------------------|------------|-------|
| P1  | Extreme monolith – single god-file                 | Critical   | 2     |
| P2  | No single source of truth (memory ↔ DB ↔ cache)   | Critical   | 2     |
| P3  | Uncontrolled memory growth & global leaks          | High       | 1     |
| P4  | Concurrency races on shared mutable maps           | High       | 1     |
| P5  | Buggy incremental WPM/accuracy (backspace broken)  | High       | 1     |
| P6  | Verbose & duplicated DB write patterns             | High       | 2     |
| P7  | Unsafe type casts & drifting persisted shape       | High       | 2     |
| P8  | Silent/swallowed errors everywhere                 | High       | 1     |
| P9  | Complex & retry-heavy input flush logic            | Med-High   | 3     |
| P10 | Redis vs non-Redis code paths heavily diverged     | Med-High   | 3     |
| P11 | Missing inputNonce in some MATCH_FOUND payloads    | Medium     | 1     |
| P12 | Accumulators not persisted → lost on restart       | Medium     | 1     |
| P13 | Shutdown can drop in-flight input updates          | Medium     | 2     |
| P14 | Inefficient Redis matchmaking Lua script           | Low        | 3     |

---

## 2. Current State Assessment

The gateway has already undergone **significant partial refactoring**. The following modules are
already extracted and working:

| Module file                    | Responsibility                               | Status       |
|-------------------------------|----------------------------------------------|--------------|
| `match-fsm.ts`                | State machine transitions & validation       | ✅ Done       |
| `match-live-state.ts`         | Persisted JSONB live-state types             | ✅ Done       |
| `match-repository.ts`         | DB read/write with optimistic concurrency    | ✅ Done       |
| `match-sync.ts`               | Snapshot + progress payload builders        | ✅ Done       |
| `match-cache.ts`              | Match socket cache                           | ✅ Done       |
| `match-session-guards.ts`     | Session policy helpers                       | ✅ Done       |
| `input-update.ts`             | Seq/idempotency decision logic               | ✅ Done       |
| `local-lock.ts`               | Per-key async lock (replaces race window)    | ✅ Done       |
| `idempotency.ts`              | Redis + in-memory idempotency store          | ✅ Done       |
| `disconnect-forfeit.ts`       | Forfeit outcome builder                      | ✅ Done       |
| `matchmaking/bands.ts`        | Rating band / bucket key logic               | ✅ Done       |
| `matchmaking/metrics.ts`      | Queue wait / quality metrics                 | ✅ Done       |
| `anti-cheat/anomaly.ts`       | Anomaly scorer                               | ✅ Done       |
| `anti-cheat/flagging.ts`      | DB cheat-flag recorder                       | ✅ Done       |
| `anti-cheat/replay.ts`        | Nonce + seq replay protection                | ✅ Done       |
| `anti-cheat/store.ts`         | Anti-cheat in-memory store                   | ✅ Done       |
| `anti-cheat/text-selection.ts`| Ranked text selection                        | ✅ Done       |
| `rooms/lifecycle.ts`          | Room ready/start conditions                  | ✅ Done       |
| `observability/metrics.ts`    | Prometheus-style gauge/counter metrics       | ✅ Done       |
| `metrics.ts`                  | Low-level metric primitives                  | ✅ Done       |
| `events.ts`                   | Internal domain event bus                    | ✅ Done       |
| `protocol.ts`                 | Client/server message types + Zod parsers    | ✅ Done       |
| `auth.ts`                     | JWT verify + WsAuthContext                   | ✅ Done       |
| `redis-bus.ts`                | Redis pub/sub channel abstraction            | ✅ Done       |
| `state.ts`                    | InMemoryState + MatchState types             | ✅ Done       |
| `gateway-db.ts`               | Drizzle DB client + transaction wrapper      | ✅ Done       |
| `in-memory-queue.ts`          | Local-only matchmaking queue                 | ✅ Done       |
| `ai.ts` / `ai-simulation.ts`  | AI opponent logic                            | ✅ Done       |
| `rate-limit.ts`               | Token bucket per IP                          | ✅ Done       |
| `user-cache.ts`               | Connection-user LRU cache                    | ✅ Done       |
| `pvp-rating-cache.ts`         | Invalidate rating cache in Next.js           | ✅ Done       |
| `texts.ts`                    | Typing text picker                           | ✅ Done       |
| `mmr.ts`                      | Elo 1v1 updater                              | ✅ Done       |
| `health.ts`                   | Health controller                            | ✅ Done       |
| `message-batcher.ts`          | WS message batcher                           | ✅ Done       |

**What remains concentrated in `index.ts` (the remaining monolith core):**

- WebSocket server creation, connection lifecycle, and all message handlers (~5 000 LoC)
- Global mutable collections: `participantMetricAccumulators`, `matchFinalizationLocks`,
  `matchCleanupTimers` — the main source of P3, P4, P5, P8, P12
- `updateParticipantMetricsIncremental` + `getOrInitParticipantAccumulator` (P5, P12)
- Match cleanup orchestration scattered across multiple functions (P3)
- Disconnect-forfeit timer management interleaved with message handlers (P3)
- Input flush queue declared inside `main()` (P9, P13)
- Some `MATCH_FOUND` paths that may omit `inputNonce` (P11)

---

## 3. Target Architecture

### 3.1 Layering

```
┌─────────────────────────────────────────────────────────┐
│  Transport Layer  (index.ts, server.ts)                 │
│  WS framing · authentication · routing messages         │
├─────────────────────────────────────────────────────────┤
│  Command / Use-Case Layer                               │
│  handle-input-update.ts  handle-match-join.ts  …        │
│  One file per user-visible action.                      │
├─────────────────────────────────────────────────────────┤
│  Domain / Aggregate Layer                               │
│  MatchAggregate · RoomAggregate · QueueAggregate        │
│  Pure domain logic, no I/O.                             │
├─────────────────────────────────────────────────────────┤
│  Infrastructure / Repository Layer                      │
│  match-repository.ts · gateway-db.ts · redis-bus.ts     │
│  Drizzle · IORedis                                      │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Proposed Folder Structure (end-state)

```
services/pvp-gateway/src/
│
├── index.ts                        # Entrypoint: wire everything, start server
│
├── server/
│   ├── create-server.ts            # http/https server factory
│   ├── ws-connection.ts            # WS handshake, auth, per-connection setup
│   └── ws-message-router.ts        # Route incoming messages to handlers
│
├── commands/                       # One file per WebSocket message type
│   ├── hello.ts                    # HELLO → auth handshake
│   ├── queue-join.ts               # QUEUE_JOIN
│   ├── queue-leave.ts              # QUEUE_LEAVE
│   ├── match-join.ts               # MATCH_JOIN (was MATCH_JOIN_REQUEST)
│   ├── input-update.ts             # INPUT_UPDATE  ← P5, P12 fix lives here
│   ├── finish-match.ts             # FINISH
│   ├── rematch.ts                  # REMATCH_ACCEPT/DECLINE
│   ├── room-create.ts              # ROOM_CREATE
│   ├── room-join.ts                # ROOM_JOIN
│   ├── room-ready.ts               # ROOM_READY
│   ├── room-leave.ts               # ROOM_LEAVE
│   └── room-start.ts               # ROOM_START
│
├── domain/
│   ├── match/
│   │   ├── match-aggregate.ts      # MatchAggregate root (P2, P4, P6, P7)
│   │   ├── match-cleanup.ts        # MatchCleanupService (P3) ← NEW
│   │   ├── participant-stats.ts    # recomputeParticipantStats (P5) ← NEW
│   │   └── types.ts                # LocalMatch, LocalParticipant domain types
│   ├── room/
│   │   └── room-aggregate.ts       # RoomAggregate root
│   └── queue/
│       └── queue-service.ts        # Matchmaking orchestration
│
├── match-fsm.ts                    # ✅ Already done
├── match-live-state.ts             # ✅ Already done (extend with correctChars)
├── match-repository.ts             # ✅ Already done
├── match-sync.ts                   # ✅ Already done
├── match-cache.ts                  # ✅ Already done
├── match-session-guards.ts         # ✅ Already done
├── input-update.ts                 # ✅ Already done (rename → seq-guard.ts later)
├── local-lock.ts                   # ✅ Already done
├── idempotency.ts                  # ✅ Already done
├── disconnect-forfeit.ts           # ✅ Already done
├── matchmaking/                    # ✅ Already done
├── anti-cheat/                     # ✅ Already done
├── rooms/                          # ✅ Already done
├── observability/                  # ✅ Already done
├── metrics.ts                      # ✅ Already done
├── events.ts                       # ✅ Already done
├── protocol.ts                     # ✅ Already done
├── auth.ts                         # ✅ Already done
├── redis-bus.ts                    # ✅ Already done
├── state.ts                        # ✅ Already done
├── gateway-db.ts                   # ✅ Already done
├── in-memory-queue.ts              # ✅ Already done
├── ai.ts / ai-simulation.ts        # ✅ Already done
├── user-cache.ts                   # ✅ Already done
├── pvp-rating-cache.ts             # ✅ Already done
├── load-env.ts                     # ✅ Already done
└── __tests__/
    ├── participant-stats.test.ts   # NEW: property-based WPM/accuracy tests (P5)
    ├── match-cleanup.test.ts       # NEW: cleanup service tests (P3)
    ├── match-nonce.test.ts         # NEW: inputNonce presence tests (P11)
    ├── health.test.ts              # ✅ Already done
    └── metrics.test.ts             # ✅ Already done
```

---

## 4. Phase Execution Plan

### Phase 1 — Safety & Correctness (current focus)

These are surgical fixes to the **existing `index.ts`** and
`match-live-state.ts` that deliver immediate correctness without
requiring a full architecture overhaul.

| Step | File(s) touched                                     | Problem(s) fixed |
|------|-----------------------------------------------------|------------------|
| 1.1  | New `domain/match/participant-stats.ts`             | P5, P12          |
| 1.2  | `match-live-state.ts` — make `correctChars`/`mismatchChars` non-optional | P12 |
| 1.3  | New `domain/match/match-cleanup.ts`                 | P3               |
| 1.4  | `index.ts` — replace increment with recompute calls | P5               |
| 1.5  | `index.ts` — wire MatchCleanupService               | P3               |
| 1.6  | `index.ts` — audit all MATCH_FOUND paths for nonce  | P11              |
| 1.7  | `index.ts` — replace all empty `.catch(() => {})`  | P8               |
| 1.8  | New tests: `__tests__/participant-stats.test.ts`    | P5 acceptance    |
| 1.9  | New tests: `__tests__/match-nonce.test.ts`          | P11 acceptance   |

### Phase 2 — Architectural Foundation

Extract remaining logic from `index.ts` into `commands/` and
`domain/` using the Command Handler + Aggregate Root pattern (P1, P2, P4, P6, P7, P13).

### Phase 3 — Scalability & Operations

Replace custom flush/retry with BullMQ (P9), unify Redis paths (P10),
improve Lua script (P14).

---

## 5. Core Design Decisions

### 5.1 Full-Recompute Stats (P5 solution)

**BEFORE** (broken): incremental diff tracking with external `participantMetricAccumulators` Map

```ts
// Bug: backspacing `prev[i]` could be correct char in text, reducing correctChars
// But incrementing then decrementing is not idempotent across context changes.
accumulator.correctChars -= 1; // WRONG when prev[position] !== textSnapshot[position]
```

**AFTER** (correct): O(n) full recompute on every INPUT_UPDATE

```ts
// domain/match/participant-stats.ts
export function recomputeParticipantStats(
  input: string,
  textSnapshot: string,
  startedAtMs: number,
  nowMs: number,
): ParticipantStats {
  let correctChars = 0;
  const n = Math.min(input.length, textSnapshot.length);
  for (let i = 0; i < n; i++) {
    if (input[i] === textSnapshot[i]) correctChars++;
  }
  const errors = input.length - correctChars;
  const accuracy = input.length === 0
    ? 100
    : Number(((correctChars / input.length) * 100).toFixed(1));
  const wpm = computeWpmFromCorrectChars(correctChars, startedAtMs, nowMs);
  return { correctChars, errors, accuracy, wpm };
}
```

n ≤ 1000 characters → O(1000) per keystroke is imperceptibly fast.  
Eliminates `participantMetricAccumulators` Map entirely → fixes P3 + P5 + P12.

### 5.2 MatchCleanupService (P3 solution)

Centralises all per-match lifecycle cleanup in one place:

```ts
// domain/match/match-cleanup.ts
export class MatchCleanupService {
  dispose(matchId: MatchId): void {
    this.clearFinalizationLock(matchId);
    this.clearCleanupTimer(matchId);
    this.clearAntiCheatStore(matchId);
    // participantMetricAccumulators is ELIMINATED (recompute approach)
  }
}
```

### 5.3 Non-optional `correctChars` in `MatchLiveParticipantState` (P12)

`correctChars` and `mismatchChars` move from `optional` to **required** fields
in `MatchLiveParticipantState` so any persist/reload cycle preserves them.
However, with the full-recompute approach (5.1), `correctChars` is derived from
`input` + `textSnapshot` at read-time — so persistence is only needed for the
final result record, not as a running accumulator.

### 5.4 InputNonce Enforcement (P11)

Every call site that emits `MATCH_FOUND` must now call a typed helper:

```ts
function buildMatchFoundPayload(match: MatchState): MatchFoundPayload {
  // TypeScript compile error if inputNonce is null here — enforced by type
  const nonce: string = match.inputNonce ?? (() => {
    throw new GatewayInvariantError(`MATCH_FOUND emitted without inputNonce for match ${match.matchId}`);
  })();
  return { ..., inputNonce: nonce };
}
```

### 5.5 Error Handling Policy (P8 solution)

```
NEVER: .catch(() => {})
ALWAYS one of:
  (a) .catch((err) => gatewayLogError("context", err, meta))
  (b) .catch((err) => { gatewayLogError("context", err, meta); throw err; })
  (c) Wrap with Result<T> = { ok, error } for expected failures
```

---

## 6. Invariants (Never Violate)

1. `inputNonce` MUST be non-null in every `MATCH_FOUND` payload.
2. Participant stats MUST be recomputed from full input string, never from incremental diffs.
3. Every match reference in `matchFinalizationLocks`, `matchCleanupTimers`, etc. MUST be
   released through `MatchCleanupService.dispose()`.
4. No catch block may swallow errors silently.
5. Every DB write to `pvp_match` MUST include `expectedRevision` (optimistic concurrency).
6. `MatchLiveParticipantState.correctChars` in persisted JSONB MUST equal the recomputed
   value from `input` + `textSnapshot` at the time of that write.
