import { PrismaClient, Prisma } from "@prisma/client";
import type { MatchLifecycleState } from "./match-fsm";
import type { MatchLiveParticipantState, MatchLiveState } from "./match-live-state";
import { dbStatusFromMatchState } from "./match-live-state";

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
  constructor(private readonly prisma: PrismaClient) {}

  async load(matchId: string): Promise<MatchRow | null> {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      status: string;
      revision: number;
      instanceId: string | null;
      liveState: Prisma.JsonValue | null;
      textSnapshot: string;
      textId: string | null;
      inputNonce: string | null;
      updatedAt: Date;
      startedAt: Date | null;
      endedAt: Date | null;
      serverStartAt: Date | null;
    }>>`
      SELECT id, status, revision, "instanceId", "liveState", "textSnapshot", "textId", "inputNonce", "updatedAt", "startedAt", "endedAt", "serverStartAt"
      FROM "pvp_match"
      WHERE id = ${matchId}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      ...row,
      liveState: (row.liveState as MatchLiveState | null) ?? null,
    };
  }

  async loadForUpdate(tx: Prisma.TransactionClient, matchId: string): Promise<MatchRow | null> {
    const rows = await tx.$queryRaw<Array<{
      id: string;
      status: string;
      revision: number;
      instanceId: string | null;
      liveState: Prisma.JsonValue | null;
      textSnapshot: string;
      textId: string | null;
      inputNonce: string | null;
      updatedAt: Date;
      startedAt: Date | null;
      endedAt: Date | null;
      serverStartAt: Date | null;
    }>>`
      SELECT id, status, revision, "instanceId", "liveState", "textSnapshot", "textId", "inputNonce", "updatedAt", "startedAt", "endedAt", "serverStartAt"
      FROM "pvp_match"
      WHERE id = ${matchId}
      FOR UPDATE
    `;

    const row = rows[0];
    if (!row) return null;

    return {
      ...row,
      liveState: (row.liveState as MatchLiveState | null) ?? null,
    };
  }

  async updateWithRevision(tx: Prisma.TransactionClient, matchId: string, patch: MatchTransitionPatch) {
    const status = dbStatusFromMatchState(patch.nextState);
    const liveStateJson = JSON.stringify(patch.liveState);
    const updated = await tx.$executeRaw`
      UPDATE "pvp_match"
      SET status = ${status},
          "liveState" = ${liveStateJson}::jsonb,
          revision = revision + 1,
          "instanceId" = ${patch.instanceId ?? null},
          "serverStartAt" = ${patch.serverStartAt ?? null},
          "startedAt" = ${patch.startedAt ?? null},
          "endedAt" = ${patch.endedAt ?? null}
      WHERE id = ${matchId}
        AND revision = ${patch.expectedRevision}
    `;

    return {
      applied: updated === 1,
      nextRevision: patch.expectedRevision + 1,
    };
  }

  async tryLockFinalization(tx: Prisma.TransactionClient, params: {
    matchId: string;
    expectedRevision: number;
    instanceId: string;
    liveState: MatchLiveState;
  }) {
    const liveStateJson = JSON.stringify(params.liveState);
    const updated = await tx.$executeRaw`
      UPDATE "pvp_match"
      SET revision = revision + 1,
          "instanceId" = ${params.instanceId},
          "liveState" = ${liveStateJson}::jsonb
      WHERE id = ${params.matchId}
        AND revision = ${params.expectedRevision}
        AND status NOT IN ('FINISHED', 'ABORTED')
    `;

    return {
      acquired: updated === 1,
      nextRevision: params.expectedRevision + 1,
    };
  }

  async clearLiveStateOnTerminal(tx: Prisma.TransactionClient, params: {
    matchId: string;
    expectedRevision: number;
    status: "FINISHED" | "ABORTED";
    endedAt?: Date;
  }) {
    const updated = await tx.$executeRaw`
      UPDATE "pvp_match"
      SET status = ${params.status},
          "liveState" = NULL,
          revision = revision + 1,
          "endedAt" = ${params.endedAt ?? new Date()}
      WHERE id = ${params.matchId}
        AND revision = ${params.expectedRevision}
    `;

    return {
      applied: updated === 1,
      nextRevision: params.expectedRevision + 1,
    };
  }

  async withTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction((tx) => run(tx));
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
