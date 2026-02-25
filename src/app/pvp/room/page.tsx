"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function Page() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4 | 5 | 6>(6);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function createRoom() {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/pvp/rooms/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPlayers }),
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

  function joinRoom() {
    const c = code.trim().toUpperCase();
    if (!c) return;
    router.push(`/pvp/room/${c}`);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl">
        <CardHeader>
          <CardTitle className="text-[#E0E7FF]">Private Room</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-[#E0E7FF]/90">
          {error ? <div className="text-sm text-red-400">{error}</div> : null}

          <div className="space-y-2">
            <div className="text-sm text-[#8A8FB5]">Create</div>
            <div className="flex items-center gap-2">
              <Input
                value={String(maxPlayers)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if ([2, 3, 4, 5, 6].includes(n)) setMaxPlayers(n as any);
                }}
                className="max-w-[120px]"
                inputMode="numeric"
              />
              <Button onClick={createRoom} disabled={isCreating}>
                Create Room
              </Button>
            </div>
            <div className="text-xs text-[#8A8FB5]">Max players: 2–6</div>
          </div>

          <div className="space-y-2">
            <div className="text-sm text-[#8A8FB5]">Join</div>
            <div className="flex items-center gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ROOMCODE" />
              <Button variant="secondary" onClick={joinRoom}>
                Join
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
