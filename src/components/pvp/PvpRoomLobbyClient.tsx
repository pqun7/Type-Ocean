"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";

export default function PvpRoomLobbyClient({ code }: { code: string }) {
  const router = useRouter();
  const { status, error, send, addListener } = usePvpSocket();

  const [room, setRoom] = useState<{
    code: string;
    status: string;
    maxPlayers: number;
    members: Array<{ userId: string; username: string; avatar: string | null; slot: number; ready: boolean }>;
  } | null>(null);

  useEffect(() => {
    return addListener((m) => {
      if (m.type === "ROOM_STATE") setRoom(m.payload.room);
      if (m.type === "MATCH_FOUND") router.push(`/pvp/match/${m.payload.matchId}`);
    });
  }, [addListener, router]);

  useEffect(() => {
    if (status !== "ready") return;
    send({ type: "ROOM_JOIN", payload: { code } });
  }, [status, send, code]);

  const members = room?.members ?? [];
  const readyCount = useMemo(() => members.filter((m) => m.ready).length, [members]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl">
        <CardHeader>
          <CardTitle className="text-[#E0E7FF]">Room {code}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-[#E0E7FF]/90">
          <div className="text-sm text-[#8A8FB5]">Status: {status} · Ready: {readyCount}/{members.length}</div>
          {error ? <div className="text-sm text-red-400">{error}</div> : null}

          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between text-sm">
                <span className="truncate">{m.username}</span>
                <span className={m.ready ? "text-green-300" : "text-[#8A8FB5]"}>{m.ready ? "READY" : "..."}</span>
              </div>
            ))}
            {!members.length ? <div className="text-sm text-[#8A8FB5]">Waiting for players…</div> : null}
          </div>

          <Button disabled={status !== "ready"} onClick={() => send({ type: "READY" })}>
            I’m Ready
          </Button>

          <div className="text-sm text-[#8A8FB5]">When everyone is ready (2–6), the match starts.</div>
        </CardContent>
      </Card>
    </div>
  );
}
