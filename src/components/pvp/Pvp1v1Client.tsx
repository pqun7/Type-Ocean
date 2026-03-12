"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import { usePvpErrorAlert } from "@/features/pvp/client/pvp-error-utils";

export default function Pvp1v1Client() {
  const router = useRouter();
  const { status, error, send, addListener } = usePvpSocket();
  usePvpErrorAlert(error);
  const [queueStatus, setQueueStatus] = useState<string>("IDLE");
  const [searchStartedAtMs, setSearchStartedAtMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    return addListener((m) => {
      if (m.type === "QUEUE_STATUS") setQueueStatus(m.payload.status);
      if (m.type === "MATCH_FOUND") router.push(`/pvp/match/${m.payload.matchId}`);
    });
  }, [addListener, router]);

  const canQueue = status === "ready";

  useEffect(() => {
    if (queueStatus === "SEARCHING") {
      setSearchStartedAtMs((prev) => prev ?? Date.now());
      return;
    }
    setSearchStartedAtMs(null);
    setElapsedSec(0);
  }, [queueStatus]);

  useEffect(() => {
    if (searchStartedAtMs == null) return;
    const id = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - searchStartedAtMs) / 1000)));
    }, 250);
    return () => window.clearInterval(id);
  }, [searchStartedAtMs]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl">
        <CardHeader>
          <CardTitle className="text-[#E0E7FF]">Ranked 1v1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-[#E0E7FF]/90">
          <div className="text-sm text-[#8A8FB5] flex items-center justify-between gap-3">
            <div>
              Status: {status} · Queue: {queueStatus}
              {queueStatus === "SEARCHING" ? ` · ${elapsedSec}s` : ""}
            </div>
            {queueStatus === "SEARCHING" ? <Loader2 className="h-4 w-4 animate-spin text-[#E0E7FF]/70" /> : null}
          </div>
          {error ? <div className="text-sm text-amber-300">A connection issue occurred. Please try again.</div> : null}

          <div className="flex gap-2">
            <Button
              disabled={!canQueue || queueStatus === "SEARCHING"}
              onClick={() => send({ type: "QUEUE_JOIN", payload: {} })}
            >
              Join Queue
            </Button>
            <Button
              variant="secondary"
              disabled={!canQueue}
              onClick={() => send({ type: "QUEUE_LEAVE", payload: {} })}
            >
              Leave
            </Button>
          </div>

          <div className="text-sm text-[#8A8FB5]">Press `Join Queue` to start searching for an opponent. You will be redirected only after a match is found.</div>
        </CardContent>
      </Card>
    </div>
  );
}
