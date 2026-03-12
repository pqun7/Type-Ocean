import { redirect } from "next/navigation";

import PvpMatchClient from "@/components/pvp/PvpMatchClient";
import { auth } from "@/features/auth/lib/auth";
import prisma from "@/features/auth/lib/db";
import { canOpenPvpMatchPage } from "@/features/pvp/server/match-access";

export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth?form=login");
  }

  const participant = await prisma.pvpParticipant.findUnique({
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

  if (!participant || !canOpenPvpMatchPage({ status: participant.match.status, participantExists: true })) {
    redirect("/pvp/1v1");
  }

  return <PvpMatchClient matchId={matchId} />;
}
