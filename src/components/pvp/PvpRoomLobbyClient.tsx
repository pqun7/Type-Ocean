"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import { usePvpErrorAlert } from "@/features/pvp/client/pvp-error-utils";

export default function PvpRoomLobbyClient({ code }: { code: string }) {
  const router = useRouter();
  const { status, error, user, send, addListener } = usePvpSocket();
  usePvpErrorAlert(error);

  const [room, setRoom] = useState<{
    code: string;
    status: string;
    visibility?: "PRIVATE" | "PUBLIC";
    minPlayers?: number;
    maxPlayers: number;
    hostUserId?: string | null;
    autoStartAt?: string | null;
    expiresAt?: string | null;
    members: Array<{ userId: string; username: string; avatar: string | null; slot: number; ready: boolean }>;
  } | null>(null);
  const [pendingMatch, setPendingMatch] = useState<{ matchId: string; serverStartAt: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    return addListener((message) => {
      if (message.type === "ROOM_STATE") {
        setRoom(message.payload.room);
      }
      if (message.type === "MATCH_FOUND") {
        setPendingMatch({ matchId: message.payload.matchId, serverStartAt: message.payload.serverStartAt });
      }
    });
  }, [addListener]);

  useEffect(() => {
    if (status !== "ready") return;
    send({ type: "ROOM_JOIN", payload: { code } });
  }, [status, send, code]);

  useEffect(() => {
    if (!pendingMatch && !room?.autoStartAt) return;

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [pendingMatch, room?.autoStartAt]);

  useEffect(() => {
    if (!pendingMatch) return;

    const delayMs = new Date(pendingMatch.serverStartAt).getTime() - Date.now();
    if (delayMs <= 0) {
      router.push(`/pvp/match/${pendingMatch.matchId}`);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      router.push(`/pvp/match/${pendingMatch.matchId}`);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [pendingMatch, router]);

  const members = useMemo(() => room?.members ?? [], [room]);
  const readyCount = useMemo(() => members.filter((m) => m.ready).length, [members]);
  const memberCount = members.length;
  const hostUserId = room?.hostUserId ?? null;
  const isHost = user?.userId != null && user.userId === hostUserId;
  const isPublicRoom = room?.visibility === "PUBLIC";
  const minimumPlayers = room?.minPlayers ?? 2;
  const expiresInMinutes = useMemo(() => {
    if (!room?.expiresAt) return null;
    const deltaMs = new Date(room.expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(deltaMs / 60_000));
  }, [room?.expiresAt]);
  const publicAutoStartSec = room?.autoStartAt ? Math.max(0, Math.ceil((new Date(room.autoStartAt).getTime() - nowMs) / 1000)) : null;
  const matchCountdown = pendingMatch ? Math.max(0, Math.ceil((new Date(pendingMatch.serverStartAt).getTime() - nowMs) / 1000)) : null;

  function leaveRoom() {
    send({ type: "ROOM_LEAVE", payload: { roomCode: code } });
    router.push("/pvp/room");
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Card className="overflow-hidden border border-[rgba(140,221,255,0.18)] bg-[radial-gradient(circle_at_top,_rgba(24,73,110,0.9),_rgba(8,22,40,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <CardHeader className="border-b border-[rgba(160,220,255,0.12)] pb-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">{room?.visibility === "PUBLIC" ? "Public Room" : "Private Room"}</div>
              <CardTitle className="mt-2 text-3xl text-[#F2F7FF]">Room {code}</CardTitle>
              <p className="mt-2 text-sm text-[#B5CAE2]">
                {isPublicRoom
                  ? "Ready up and the room will launch automatically when everyone is ready, the lobby fills, or the timer reaches zero with enough players."
                  : "Private rooms use host-managed starts. Everyone must be ready before the host launches the match."}
              </p>
            </div>
            <Button variant="secondary" onClick={leaveRoom}>
              Leave Room
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 p-6 text-[#E0E7FF]/90">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[rgba(160,220,255,0.12)] bg-[rgba(7,18,34,0.45)] p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#91D7F6]">
                <Users className="h-4 w-4" /> Players
              </div>
              <div className="mt-3 text-3xl font-semibold text-white">{memberCount}/{room?.maxPlayers ?? 0}</div>
              <div className="mt-2 text-sm text-[#A9C0D6]">Ready: {readyCount}/{memberCount}</div>
            </div>

            <div className="rounded-2xl border border-[rgba(160,220,255,0.12)] bg-[rgba(7,18,34,0.45)] p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-[#91D7F6]">Lobby status</div>
              <div className="mt-3 text-2xl font-semibold text-white">{room?.status ?? "Loading"}</div>
              <div className="mt-2 text-sm text-[#A9C0D6]">Socket: {status}</div>
            </div>

            <div className="rounded-2xl border border-[rgba(160,220,255,0.12)] bg-[rgba(7,18,34,0.45)] p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-[#91D7F6]">
                <Clock3 className="h-4 w-4" /> Timer
              </div>
              <div className="mt-3 text-2xl font-semibold text-white">
                {pendingMatch ? `${matchCountdown ?? 0}s` : isPublicRoom && publicAutoStartSec != null ? `${publicAutoStartSec}s` : `${expiresInMinutes ?? 0}m`}
              </div>
              <div className="mt-2 text-sm text-[#A9C0D6]">
                {pendingMatch
                  ? "Match starting"
                  : isPublicRoom
                    ? memberCount >= minimumPlayers
                      ? "Auto-start window"
                      : `Waiting for ${minimumPlayers} players`
                    : expiresInMinutes != null
                      ? `Room expires in ${expiresInMinutes}m`
                      : "Private lobby"}
              </div>
            </div>
          </div>

          {error ? <div className="text-sm text-amber-300">A room connection issue occurred. Please try again.</div> : null}

          {pendingMatch ? (
            <div className="flex items-center justify-between gap-4 rounded-[28px] border border-[rgba(130,214,255,0.18)] bg-[linear-gradient(135deg,rgba(17,45,72,0.95),rgba(10,22,38,0.95))] p-5">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">Match Found</div>
                <div className="mt-2 text-2xl font-semibold text-white">Launching room match</div>
                <div className="mt-2 text-sm text-[#A9C0D6]">Full-page room text is locked in. Everyone starts together.</div>
              </div>
              <div className="flex items-center gap-3 text-white">
                <Loader2 className="h-5 w-5 animate-spin text-[#B8E6FF]" />
                <span className="text-4xl font-semibold">{matchCountdown ?? 0}</span>
              </div>
            </div>
          ) : null}

          {isPublicRoom && !pendingMatch ? (
            <div className="rounded-2xl border border-[rgba(160,220,255,0.12)] bg-[rgba(255,255,255,0.04)] p-4 text-sm text-[#B5CAE2]">
              {memberCount < minimumPlayers
                ? `Public rooms need at least ${minimumPlayers} players before the 50 second timer can turn into a live match.`
                : readyCount === memberCount
                  ? "Everyone is ready. The room should start immediately."
                  : memberCount >= (room?.maxPlayers ?? 6)
                    ? "Room is full. Match should start immediately."
                    : `Auto-start in ${publicAutoStartSec ?? 0}s unless the room starts sooner.`}
            </div>
          ) : null}

          <div className="space-y-3 rounded-[28px] border border-[rgba(160,220,255,0.12)] bg-[rgba(7,18,34,0.5)] p-5">
            {members.map((member) => (
              <div key={member.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(160,220,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-white">
                    {member.username}
                    {member.userId === hostUserId ? " (Host)" : ""}
                  </div>
                  <div className="mt-1 text-xs text-[#8A8FB5]">Slot {member.slot + 1}</div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={member.ready ? "text-green-300" : "text-[#8A8FB5]"}>{member.ready ? "READY" : "WAITING"}</span>
                  {!isPublicRoom && isHost && member.userId !== user?.userId ? (
                    <Button size="sm" variant="secondary" onClick={() => send({ type: "ROOM_KICK", payload: { roomCode: code, userId: member.userId } })}>
                      Kick
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {!members.length ? <div className="text-sm text-[#8A8FB5]">Waiting for players...</div> : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={status !== "ready" || !!pendingMatch} onClick={() => send({ type: "READY", payload: { roomCode: code } })}>
              I&apos;m Ready
            </Button>
            {!isPublicRoom && isHost ? (
              <Button
                variant="secondary"
                disabled={status !== "ready" || !!pendingMatch || readyCount < minimumPlayers || readyCount !== memberCount}
                onClick={() => send({ type: "ROOM_START", payload: { roomCode: code } })}
              >
                Start Match
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
