import { sql } from "drizzle-orm";
import type { MatchLifecycleState } from "./match-fsm";
import type { MatchLiveParticipantState, MatchLiveState } from "./match-live-state";
import { dbStatusFromMatchState } from "./match-live-state";
import type { GatewayDb, GatewayTx } from "./gateway-db";

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
  constructor(private readonly prisma: GatewayDb) {}

  async load(matchId: string): Promise<MatchRow | null> {
    const result = await this.prisma.execute(sql`
      SELECT id, status, revision, "instanceId", "liveState", "textSnapshot", "textId", "inputNonce", "updatedAt", "startedAt", "endedAt", "serverStartAt"
      FROM "pvp_match"
      WHERE id = ${matchId}
      LIMIT 1
    `);

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
    const result = await tx.execute(sql`
      SELECT id, status, revision, "instanceId", "liveState", "textSnapshot", "textId", "inputNonce", "updatedAt", "startedAt", "endedAt", "serverStartAt"
      FROM "pvp_match"
      WHERE id = ${matchId}
      FOR UPDATE
    `);

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

    const result = await tx.execute(sql`
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
    `);

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
    const result = await tx.execute(sql`
      UPDATE "pvp_match"
      SET revision = revision + 1,
          "instanceId" = ${params.instanceId},
          "liveState" = CAST(${liveStateJson} AS jsonb)
      WHERE id = ${params.matchId}
        AND revision = ${params.expectedRevision}
        AND status NOT IN ('FINISHED', 'ABORTED')
      RETURNING id
    `);

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
    const result = await tx.execute(sql`
      UPDATE "pvp_match"
      SET status = ${params.status},
          "liveState" = NULL,
          revision = revision + 1,
          "endedAt" = ${params.endedAt ?? new Date()}
      WHERE id = ${params.matchId}
        AND revision = ${params.expectedRevision}
      RETURNING id
    `);

    return {
      applied: result.rows.length === 1,
      nextRevision: params.expectedRevision + 1,
    };
  }

  async withTransaction<T>(run: (tx: GatewayTx) => Promise<T>) {
    return this.prisma.transaction((tx) => run(tx));
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
