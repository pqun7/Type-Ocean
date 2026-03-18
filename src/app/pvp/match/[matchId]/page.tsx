import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";

import PvpMatchClient from "@/components/pvp/PvpMatchClient";
import { auth } from "@/features/auth/lib/auth";
import { db } from "@/db";
import { canOpenPvpMatchPage } from "@/features/pvp/server/match-access";
import { isDatabaseTemporarilyUnavailableError } from "@/lib/db-error-utils";

export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth?form=login");
  }

  let participant: {
    userId: string;
    match: {
      status: string;
    };
  } | null = null;

  try {
    const result = await db.execute<{ userId: string; status: string }>(sql`
      SELECT p."userId", m."status"
      FROM "pvp_participant" p
      INNER JOIN "pvp_match" m ON m."id" = p."matchId"
      WHERE p."matchId" = ${matchId}
        AND p."userId" = ${session.user.id}
      LIMIT 1
    `);

    const row = (result.rows?.[0] as { userId: string; status: string } | undefined) ?? null;
    participant = row
      ? {
          userId: row.userId,
          match: { status: row.status },
        }
      : null;
  } catch (error) {
    const isTemporary = isDatabaseTemporarilyUnavailableError(error);
    console.error("/pvp/match/[matchId] participant query failed", {
      isTemporary,
      error,
    });
    redirect("/pvp/1v1");
  }

  if (!participant || !canOpenPvpMatchPage({ status: participant.match.status, participantExists: true })) {
    redirect("/pvp/1v1");
  }

  return <PvpMatchClient matchId={matchId} />;
}
