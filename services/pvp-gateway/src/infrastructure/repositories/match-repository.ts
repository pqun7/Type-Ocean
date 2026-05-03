import { sql } from "drizzle-orm";
import type { MatchLifecycleState } from "../../match-fsm";
import type { MatchLiveParticipantState, MatchLiveState } from "../../match-live-state";
import { dbStatusFromMatchState } from "../../match-live-state";
import { runGatewayTransaction, type GatewayDb, type GatewayTx } from "../../gateway-db";
import { incrementGatewayMetric, observeGatewayHistogram } from "../../metrics";

const DB_QUERY_DURATION_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_000, 5_000];

async function observeMatchDbQuery<T>(
  operation: "load" | "load_for_update" | "update_with_revision" | "try_lock_finalization" | "clear_live_state_on_terminal",
  queryKind: "select" | "update",
  run: () => Promise<T>
) {
  const startedAt = Date.now();

  try {
    const result = await run();
    incrementGatewayMetric("pvp_db_query_total", {
      table: "pvp_match",
      operation,
      query_kind: queryKind,
      status: "ok",
    });
    observeGatewayHistogram("pvp_db_query_duration_ms", Date.now() - startedAt, DB_QUERY_DURATION_BUCKETS_MS, {
      table: "pvp_match",
      operation,
      query_kind: queryKind,
      status: "ok",
    });
    return result;
  } catch (error) {
    incrementGatewayMetric("pvp_db_query_total", {
      table: "pvp_match",
      operation,
      query_kind: queryKind,
      status: "error",
    });
    observeGatewayHistogram("pvp_db_query_duration_ms", Date.now() - startedAt, DB_QUERY_DURATION_BUCKETS_MS, {
      table: "pvp_match",
      operation,
      query_kind: queryKind,
      status: "error",
    });
    throw error;
  }
}

export type MatchRow = {
  id: string;
  status: string;
  revision: number;
  instanceId: string | null;
  liveState: MatchLiveState | null;
  textSnapshot: string;
  textId: string | null;
  inputNonce: string | null;
  updatedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  serverStartAt: Date | null;
};

export type MatchTransitionPatch = {
  expectedRevision: number;
  nextState: MatchLifecycleState;
  liveState: MatchLiveState;
  instanceId?: string | null;
  serverStartAt?: Date | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
};

export class MatchRepository {
  constructor(private readonly db: GatewayDb) {}

  async load(matchId: string): Promise<MatchRow | null> {
    const result = await observeMatchDbQuery("load", "select", () =>
      this.db.execute(sql`
        SELECT id, status, revision, "instanceId", "liveState", "textSnapshot", "textId", "inputNonce", "updatedAt", "startedAt", "endedAt", "serverStartAt"
        FROM "pvp_match"
        WHERE id = ${matchId}
        LIMIT 1
      `)
    );

    const row = result.rows[0] as {
      id: string;
      status: string;
      revision: number;
      instanceId: string | null;
      liveState: unknown;
      textSnapshot: string;
      textId: string | null;
      inputNonce: string | null;
      updatedAt: Date;
      startedAt: Date | null;
      endedAt: Date | null;
      serverStartAt: Date | null;
    } | undefined;
    if (!row) return null;

    return {
      ...row,
      liveState: (row.liveState as MatchLiveState | null) ?? null,
    };
  }

  async loadForUpdate(tx: GatewayTx, matchId: string): Promise<MatchRow | null> {
    const result = await observeMatchDbQuery("load_for_update", "select", () =>
      tx.execute(sql`
        SELECT id, status, revision, "instanceId", "liveState", "textSnapshot", "textId", "inputNonce", "updatedAt", "startedAt", "endedAt", "serverStartAt"
        FROM "pvp_match"
        WHERE id = ${matchId}
        FOR UPDATE
      `)
    );

    const row = result.rows[0] as {
      id: string;
      status: string;
      revision: number;
      instanceId: string | null;
      liveState: unknown;
      textSnapshot: string;
      textId: string | null;
      inputNonce: string | null;
      updatedAt: Date;
      startedAt: Date | null;
      endedAt: Date | null;
      serverStartAt: Date | null;
    } | undefined;
    if (!row) return null;

    return {
      ...row,
      liveState: (row.liveState as MatchLiveState | null) ?? null,
    };
  }

  async updateWithRevision(tx: GatewayTx, matchId: string, patch: MatchTransitionPatch) {
    const status = dbStatusFromMatchState(patch.nextState);
    const liveStateJson = JSON.stringify(patch.liveState);

    const result = await observeMatchDbQuery("update_with_revision", "update", () =>
      tx.execute(sql`
        UPDATE "pvp_match"
        SET status = ${status},
            "liveState" = CAST(${liveStateJson} AS jsonb),
            revision = revision + 1,
            "instanceId" = ${patch.instanceId ?? null},
            "serverStartAt" = ${patch.serverStartAt ?? null},
            "startedAt" = ${patch.startedAt ?? null},
            "endedAt" = ${patch.endedAt ?? null}
        WHERE id = ${matchId}
          AND revision = ${patch.expectedRevision}
        RETURNING id
      `)
    );

    return {
      applied: result.rows.length === 1,
      nextRevision: patch.expectedRevision + 1,
    };
  }

  async tryLockFinalization(tx: GatewayTx, params: {
    matchId: string;
    expectedRevision: number;
    instanceId: string;
    liveState: MatchLiveState;
  }) {
    const liveStateJson = JSON.stringify(params.liveState);
    const result = await observeMatchDbQuery("try_lock_finalization", "update", () =>
      tx.execute(sql`
        UPDATE "pvp_match"
        SET revision = revision + 1,
            "instanceId" = ${params.instanceId},
            "liveState" = CAST(${liveStateJson} AS jsonb)
        WHERE id = ${params.matchId}
          AND revision = ${params.expectedRevision}
          AND status NOT IN ('FINISHED', 'ABORTED')
        RETURNING id
      `)
    );

    return {
      acquired: result.rows.length === 1,
      nextRevision: params.expectedRevision + 1,
    };
  }

  async clearLiveStateOnTerminal(tx: GatewayTx, params: {
    matchId: string;
    expectedRevision: number;
    status: "FINISHED" | "ABORTED";
    endedAt?: Date;
  }) {
    const result = await observeMatchDbQuery("clear_live_state_on_terminal", "update", () =>
      tx.execute(sql`
        UPDATE "pvp_match"
        SET status = ${params.status},
            "liveState" = NULL,
            revision = revision + 1,
            "endedAt" = ${params.endedAt ?? new Date()}
        WHERE id = ${params.matchId}
          AND revision = ${params.expectedRevision}
        RETURNING id
      `)
    );

    return {
      applied: result.rows.length === 1,
      nextRevision: params.expectedRevision + 1,
    };
  }

  /**
   * Load all non-terminal matches for startup recovery.
   *
   * Returns up to `limit` rows where status is PENDING, COUNTDOWN, or RUNNING,
   * with an optional `updatedAt` age filter.  Each row includes the associated
   * room code (null for ranked matches).
   */
  async loadAllActive(params: {
    maxAgeMs?: number;
    limit?: number;
  } = {}): Promise<Array<{
    id: string;
    status: string;
    revision: number;
    instanceId: string | null;
    liveState: MatchLiveState | null;
    textSnapshot: string;
    textId: string | null;
    inputNonce: string | null;
    serverStartAt: Date | null;
    updatedAt: Date;
    roomCode: string | null;
  }>> {
    const limit = params.limit ?? 200;
    const cutoff = params.maxAgeMs != null
      ? new Date(Date.now() - params.maxAgeMs)
      : null;

    const result = await this.db.execute(
      cutoff != null
        ? sql`
            SELECT m.id, m.status, m.revision, m."instanceId", m."liveState",
                   m."textSnapshot", m."textId", m."inputNonce", m."serverStartAt",
                   m."updatedAt", r.code AS "roomCode"
            FROM "pvp_match" m
            LEFT JOIN "pvp_room" r ON m."roomId" = r.id
            WHERE m.status IN ('PENDING','COUNTDOWN','RUNNING')
              AND m."updatedAt" >= ${cutoff}
            ORDER BY m."updatedAt" ASC
            LIMIT ${limit}
          `
        : sql`
            SELECT m.id, m.status, m.revision, m."instanceId", m."liveState",
                   m."textSnapshot", m."textId", m."inputNonce", m."serverStartAt",
                   m."updatedAt", r.code AS "roomCode"
            FROM "pvp_match" m
            LEFT JOIN "pvp_room" r ON m."roomId" = r.id
            WHERE m.status IN ('PENDING','COUNTDOWN','RUNNING')
            ORDER BY m."updatedAt" ASC
            LIMIT ${limit}
          `
    );

    return (result.rows as Array<{
      id: string;
      status: string;
      revision: number;
      instanceId: string | null;
      liveState: unknown;
      textSnapshot: string;
      textId: string | null;
      inputNonce: string | null;
      serverStartAt: Date | null;
      updatedAt: Date;
      roomCode: string | null;
    }>).map((row) => ({
      ...row,
      liveState: (row.liveState as MatchLiveState | null) ?? null,
    }));
  }

  async withTransaction<T>(run: (tx: GatewayTx) => Promise<T>) {
    return runGatewayTransaction(this.db, run);
  }

  /**
   * Writes AI participant progress to liveState with optimistic revision checking.
   */
  async updateAiProgress(
    matchId: string,
    expectedRevision: number,
    aiUpdates: Partial<MatchLiveParticipantState> & { userId: string }
  ): Promise<boolean> {
    const current = await this.load(matchId);
    if (!current) return false;
    if (current.revision !== expectedRevision) return false;
    if (!current.liveState) return false;

    const participant = current.liveState.participants[aiUpdates.userId];
    if (!participant) return false;

    const nextLiveState: MatchLiveState = {
      ...current.liveState,
      participants: {
        ...current.liveState.participants,
        [aiUpdates.userId]: {
          ...participant,
          ...aiUpdates,
        },
      },
    };

    const updated = await this.withTransaction(async (tx) => {
      return this.updateWithRevision(tx, matchId, {
        expectedRevision,
        nextState: nextLiveState.state,
        liveState: nextLiveState,
        instanceId: current.instanceId,
        serverStartAt: current.serverStartAt,
        startedAt: current.startedAt,
        endedAt: current.endedAt,
      });
    });

    return updated.applied;
  }
}
