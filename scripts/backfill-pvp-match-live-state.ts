import { sql } from "drizzle-orm";
import { db } from "../src/db";
import type { MatchLiveState } from "../services/pvp-gateway/src/match-live-state";
import { matchStateFromDbStatus } from "../services/pvp-gateway/src/match-live-state";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 200;
  const instanceId =
    process.env.PVP_INSTANCE_ID ??
    process.env.INSTANCE_ID ??
    `backfill-${Date.now()}`;

  const activeResult = await db.execute<{ id: string; status: string }>(sql`
    SELECT id, status
    FROM "pvp_match"
    WHERE status IN ('PENDING', 'COUNTDOWN', 'RUNNING')
      AND "liveState" IS NULL
    ORDER BY "createdAt" ASC
    LIMIT ${Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200}
  `);
  const active = (activeResult.rows ?? []) as Array<{ id: string; status: string }>;

  console.log(`Found ${active.length} active matches without liveState.`);
  if (active.length === 0) return;

  let updated = 0;

  for (const row of active) {
    const participantsResult = await db.execute<{ userId: string; slot: number; username: string | null }>(sql`
      SELECT p."userId" as "userId", p."slot" as "slot", u."username" as "username"
      FROM "pvp_participant" p
      LEFT JOIN "User" u ON u."id" = p."userId"
      WHERE p."matchId" = ${row.id}
      ORDER BY p."slot" ASC
    `);
    const participants = (participantsResult.rows ?? []) as Array<{ userId: string; slot: number; username: string | null }>;

    const liveState: MatchLiveState = {
      state: matchStateFromDbStatus(row.status),
      stateChangedAtMs: Date.now(),
      participants: Object.fromEntries(
        participants.map((participant) => [
          participant.userId,
          {
            userId: participant.userId,
            username: participant.username ?? "user",
            avatar: null,
            slot: participant.slot,
            input: "",
            seq: 0,
            errors: 0,
            wpm: 0,
            accuracy: 100,
            finishedAt: null,
            lastInputAtMs: null,
            inputEvents: [],
          },
        ])
      ),
      forfeitedUserId: null,
      endedReason: null,
      rematchMatchId: null,
      finalizedAtMs: null,
      reconnectUntilByUserId: {},
      deltas: [],
    };

    if (dryRun) {
      console.log(`[DRY] Would backfill match ${row.id}`);
      continue;
    }

    const liveStateJson = JSON.stringify(liveState);
    await db.execute(sql`
      UPDATE "pvp_match"
      SET "liveState" = CAST(${liveStateJson} AS jsonb),
          "revision" = 1,
          "instanceId" = ${instanceId}
      WHERE "id" = ${row.id}
        AND "liveState" IS NULL
    `);

    updated += 1;
  }

  if (!dryRun) {
    console.log(`Backfill complete. Updated ${updated} matches.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
