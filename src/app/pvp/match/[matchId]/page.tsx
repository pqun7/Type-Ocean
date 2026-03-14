import { redirect } from "next/navigation";

import PvpMatchClient from "@/components/pvp/PvpMatchClient";
import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
import { canOpenPvpMatchPage } from "@/features/pvp/server/match-access";
import { isPrismaTemporarilyUnavailableError } from "@/lib/prisma-error-utils";

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
    participant = await prisma.pvpParticipant.findUnique({
      where: {
        matchId_userId: {
          matchId,
          userId: session.user.id,
        },
      },
      select: {
        userId: true,
        match: {
          select: {
            status: true,
          },
        },
      },
    });
  } catch (error) {
    const isTemporary = isPrismaTemporarilyUnavailableError(error);
    console.error("/pvp/match/[matchId] prisma.pvpParticipant.findUnique failed", {
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
