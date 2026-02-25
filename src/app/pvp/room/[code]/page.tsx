import PvpRoomLobbyClient from "@/components/pvp/PvpRoomLobbyClient";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PvpRoomLobbyClient code={code.toUpperCase()} />;
}
