import PvpMatchClient from "@/components/pvp/PvpMatchClient";

export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  return <PvpMatchClient matchId={matchId} />;
}
