"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, Globe2, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Page() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4 | 5 | 6>(6);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoiningPublic, setIsJoiningPublic] = useState(false);

  async function createRoom() {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/pvp/rooms/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPlayers, visibility: "PRIVATE" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to create room");
      router.push(`/pvp/room/${body.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsCreating(false);
    }
  }

  async function joinPublicRoom() {
    setIsJoiningPublic(true);
    setError(null);
    try {
      const res = await fetch("/api/pvp/rooms/public", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to join a public room");
      router.push(`/pvp/room/${body.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsJoiningPublic(false);
    }
  }

  function joinRoom() {
    const c = code.trim().toUpperCase();
    if (!c) return;
    router.push(`/pvp/room/${c}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Card className="overflow-hidden border border-[rgba(140,221,255,0.18)] bg-[radial-gradient(circle_at_top,_rgba(24,73,110,0.9),_rgba(8,22,40,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <CardHeader className="border-b border-[rgba(160,220,255,0.12)] pb-5">
          <CardTitle className="text-3xl text-[#F2F7FF]">PvP Rooms</CardTitle>
          <p className="max-w-3xl text-sm text-[#B5CAE2]">
            Use a private room for coordinated matches, or jump into a public room where ready players auto-start on a 50 second timer.
          </p>
        </CardHeader>

        <CardContent className="space-y-6 p-6 text-[#E0E7FF]/90">
          {error ? <div className="text-sm text-red-400">{error}</div> : null}

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-[28px] border border-[rgba(130,214,255,0.16)] bg-[rgba(7,18,34,0.5)] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-[rgba(160,220,255,0.18)] bg-[rgba(255,255,255,0.04)] p-3 text-[#9DDBFF]">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">Private Room</div>
                  <div className="text-xl font-semibold text-white">Invite-only lobby</div>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <div className="mb-2 text-sm text-[#A9C0D6]">Create</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={String(maxPlayers)}
                      onChange={(e) => {
                        const nextValue = Number(e.target.value);
                        if ([2, 3, 4, 5, 6].includes(nextValue)) {
                          setMaxPlayers(nextValue as 2 | 3 | 4 | 5 | 6);
                        }
                      }}
                      className="max-w-[120px] border-[rgba(160,220,255,0.18)] bg-[rgba(255,255,255,0.04)] text-white"
                      inputMode="numeric"
                    />
                    <Button onClick={createRoom} disabled={isCreating}>
                      {isCreating ? "Creating..." : "Create Room"}
                    </Button>
                  </div>
                  <div className="mt-2 text-xs text-[#8A8FB5]">Set a room size between 2 and 6 players.</div>
                </div>

                <div>
                  <div className="mb-2 text-sm text-[#A9C0D6]">Join by code</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="ROOMCODE"
                      className="border-[rgba(160,220,255,0.18)] bg-[rgba(255,255,255,0.04)] text-white"
                    />
                    <Button variant="secondary" onClick={joinRoom}>
                      <DoorOpen className="mr-2 h-4 w-4" />
                      Join
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-[rgba(130,214,255,0.16)] bg-[linear-gradient(135deg,rgba(17,45,72,0.95),rgba(10,22,38,0.95))] p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-[rgba(160,220,255,0.18)] bg-[rgba(255,255,255,0.04)] p-3 text-[#9DDBFF]">
                  <Globe2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">Public Room</div>
                  <div className="text-xl font-semibold text-white">Quick-play lobby</div>
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm text-[#B5CAE2]">
                <p>2 to 6 players.</p>
                <p>Starts immediately when everyone is ready or the lobby fills.</p>
                <p>Starts automatically after 50 seconds if at least 2 players remain.</p>
                <p>Uses full-page text for every room match.</p>
              </div>

              <Button className="mt-6 w-full" onClick={joinPublicRoom} disabled={isJoiningPublic}>
                {isJoiningPublic ? "Joining public room..." : "Join Public Room"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
