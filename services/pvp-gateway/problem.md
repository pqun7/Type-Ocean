# PvP Gateway - Critical Technical Debt & Refactoring Roadmap

**Status**: 🚨 High Priority – Maintainability & Reliability Cliff Approaching  
**Severity**: Critical (monolith + concurrency + correctness issues accumulating)   
**Impact if ignored**: Increasing frequency of production incidents, OOM crashes, data corruption, unfair matches, very slow velocity for new features

## 1. Executive Summary

The current PvP gateway is a **~2500–6000 LoC single-file monolith** that works under moderate load but is sitting on a growing pile of technical debt:

- No clear architectural boundaries → every change is dangerous  
- In-memory state races & divergence from database  
- Memory leaks from uncleaned global collections  
- Fragile incremental WPM/accuracy logic (backspace bug)  
- Silent error swallowing & incomplete shutdown handling  
- Divergent Redis vs non-Redis paths  
- Loose message validation & unsafe casts

These issues are already causing subtle production bugs and will become exponentially more expensive to fix the longer they remain unaddressed.

## 2. Consolidated Critical Problems (Prioritized)

| Priority | ID  | Problem Title                                      | Severity   | Main Symptoms / Risks                                      | DeepSeek overlap |
|--------|-----|----------------------------------------------------|------------|-------------------------------------------------------------|------------------|
| 1      | P1  | Extreme monolith – single god-file                 | **Critical** | Impossible to test/review/scale safely, regression magnet   | Yes              |
| 2      | P2  | No single source of truth (memory ↔ DB ↔ cache)   | **Critical** | Phantom inputs, lost progress, duplicate ratings, desync    | Yes              |
| 3      | P3  | Uncontrolled memory growth & global leaks          | **High**     | RSS → OOM after sustained load                              | Yes              |
| 4      | P4  | Concurrency races on shared mutable maps           | **High**     | Corrupted state, missed/double finalizations                | Yes              |
| 5      | P5  | Buggy incremental WPM/accuracy (backspace broken)  | **High**     | Wrong final stats → unfair Elo/ranking                      | Yes              |
| 6      | P6  | Verbose & duplicated DB write patterns             | **High**     | Bugs propagate, hard to audit security writes               | —                |
| 7      | P7  | Unsafe type casts & drifting persisted shape       | **High**     | Silent corruption after reconnect / failover                | —                |
| 8      | P8  | Silent/swallowed errors everywhere                 | **High**     | Stuck matches, lost results, hidden failures                | Yes              |
| 9      | P9  | Complex & retry-heavy input flush logic            | **Med-High** | Memory pressure or stalled matches during DB blips          | —                |
| 10     | P10 | Redis vs non-Redis code paths heavily diverged     | **Med-High** | Different behavior dev ↔ prod, hard capacity planning       | —                |
| 11     | P11 | Missing inputNonce in some MATCH_FOUND payloads    | **Medium**   | Replay protection weakened → cheating possible              | Yes              |
| 12     | P12 | Accumulators not persisted → lost on restart       | **Medium**   | Jumpy stats after gateway restart / failover                | Yes              |
| 13     | P13 | Shutdown can drop in-flight input updates          | **Medium**   | Incomplete final results during deploy/restart              | Yes              |
| 14     | P14 | Inefficient Redis matchmaking Lua script           | **Low**      | Higher Redis CPU, more unnecessary AI fallbacks             | Yes              |

## 3. Proposed Solutions & Refactoring Roadmap

### Phase 1 – Safety & Correctness (2–4 weeks)

1. **Replace incremental metrics with full recomputation** (P5)  
   → O(n) per INPUT_UPDATE (n ≤ 1000 chars) is acceptable and removes entire class of stats bugs

   ```ts
   function recomputeParticipantStats(p: LocalParticipant, text: string, startedAtMs: number) {
     let correct = 0;
     for (let i = 0; i < p.input.length; i++) {
       if (p.input[i] === text[i]) correct++;
     }
     p.errors   = p.input.length - correct;
     p.accuracy = p.input.length === 0 ? 100 : Number((correct / p.input.length * 100).toFixed(1));
     p.wpm      = computeWpmFromCorrectChars(correct, startedAtMs, Date.now());
   }

Persist participant accumulators inside liveState jsonb (P12)
→ correctChars & mismatchChars become part of persisted match state → survive gateway restarts
Introduce per-match mutex / async lock (P4)
→ Use async-mutex or Promise-based lock per matchId to eliminate racests

const matchLocks = new Map<string, Mutex>();
async function withMatchLock<T>(matchId: string, fn: () => Promise<T>): Promise<T> { … }

Audit & enforce inputNonce in every MATCH_FOUND (P11)
→ Add unit test + runtime check that payload always contains nonce
Replace empty catch blocks with logging + decision (P8)
→ Policy: never swallow silently → log + re-throw or circuit-break

Phase 2 – Architectural Foundation (3–5 weeks)Aggressive modularization (P1)
Split into ~12–15 focused modules (see list in previous analysis)
Introduce Match Aggregate + Command Bus (P2, P4, P6, P7)
→ All mutations go through one choke-point with revision check + DB-first semanticsts

type MatchCommand = { type: "InputUpdate"; payload: { … } } | …;
class MatchAggregate {
  async handle(cmd: MatchCommand): Promise<{ events: DomainEvent[]; newRevision: number }> { … }
}

Make DB authoritative source of truth (P2)
→ Reload from DB after any persistence failure
→ In-memory state = write-through cache only
Strict Zod validation on every incoming message (P15)
→ No more unsafe property access

Phase 3 – Scalability & Operations (ongoing)Replace custom flush/retry with proper queue (P9)
→ BullMQ / Bee-Queue or Redis Streams + worker
Unify Redis & non-Redis paths (P10)
→ Long-term: move queue, presence, locks, pub/sub to Redis
Unified explicit cleanup service (P3)
→ One place responsible for disposing timers, accumulators, caches per match
Improve Redis matchmaking Lua script (P14)
→ Scan more candidates or maintain online-only sorted set

4. Acceptance Criteria for Phase 1WPM/accuracy always correct even after many backspaces (property-based test)
No memory growth after 24h sustained load (heap snapshot diff)
No races under high concurrency (stress test + Jepsen-like simulation)
All MATCH_FOUND payloads contain inputNonce (unit + integration test)
Accumulator values survive gateway restart & reconnect
No empty catch blocks remain (eslint rule + manual audit)

5. Risks & MitigationsRisk: Refactoring introduces new bugs
→ Mitigation: Incremental rollout + strong test coverage + canary deployments
Risk: Downtime during DB schema change (liveState)
→ Mitigation: Backward-compatible column addition first
Risk: Team resistance to big refactor
→ Mitigation: Start with high-ROI fixes (metrics recompute + cleanup) to show quick wins


You are an Elite Principal TypeScript Engineer with 20+ years experience. You never apply band-aids. You always fix problems at the root.

We have a monolithic ~3000+ line PvP WebSocket gateway file. The biggest issues right now are:

- Buggy incremental WPM/accuracy calculation (backspace breaks stats)
- participantMetricAccumulators memory leak
- Missing inputNonce in some MATCH_FOUND payloads
- Silent error swallowing
- Accumulators not persisted → lost on restart

Task:
1. Replace the entire incremental metric logic (`updateParticipantMetricsIncremental` + `getOrInitParticipantAccumulator`) with a clean, correct full-recompute function.
2. Make correctChars and mismatchChars part of the persisted liveState (jsonb column).
3. Ensure EVERY MATCH_FOUND payload always includes inputNonce.
4. Add a centralized `MatchCleanupService` that completely clears all timers, maps, and accumulators when a match is removed.
5. Replace all empty `.catch(() => {})` with proper logging + decision (never swallow silently).

Rules:
- Use modern TypeScript (2025–2026 style)
- Zero `any`, zero unsafe casts
- Add full JSDoc + inline comments where logic is non-obvious
- Output the refactored code as clean, separate files where possible
- Show Before → After diff for the metric function
- After changes, the stats must be 100% correct even with heavy backspacing

Start now. First output the new recompute function and the updated MatchLiveState type, then the cleanup service.