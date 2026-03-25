"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Swords, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import { usePvpErrorAlert } from "@/features/pvp/client/pvp-error-utils";
import { getConnectionBannerMessage } from "@/features/pvp/client/connection-state-machine";

/** Format a millisecond duration as "MM:SS" for countdown display. */
function formatCooldown(ms: number): string {
  const totalSecs = Math.ceil(ms / 1_000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Return a human-readable "X minutes ago" string. */
function formatTimeAgo(epochMs: number): string {
  const diffMins = Math.floor((Date.now() - epochMs) / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins === 1) return "1 minute ago";
  return `${diffMins} minutes ago`;
}

type PendingMatch = {
  matchId: string;
  opponent: {
    username: string;
    rankTier?: string;
    rating?: number;
    averageWpm?: number | null;
  } | null;
};

function getQueueStatusLabel(params: { queueStatus: string; pendingMatch: PendingMatch | null }): string {
  if (params.pendingMatch) return "MATCH FOUND";
  return params.queueStatus;
}

export default function Pvp1v1Client() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    status,
    error,
    user,
    send,
    addListener,
    reconnect,
    connectionPhase,
    isOffline,
    circuitBreakerActiveUntil,
  } = usePvpSocket();
  usePvpErrorAlert(error);

  const [queueStatus, setQueueStatus] = useState<string>("IDLE");
  const [searchStartedAtMs, setSearchStartedAtMs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pendingMatch, setPendingMatch] = useState<PendingMatch | null>(null);
  const cancelledReason = searchParams?.get("cancelled");

  /** Remaining circuit-breaker cooldown in ms, or null when inactive. */
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (circuitBreakerActiveUntil === null) {
      setCooldownRemaining(null);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, circuitBreakerActiveUntil - Date.now());
      setCooldownRemaining(remaining > 0 ? remaining : null);
    };

    tick(); // synchronous first tick to avoid flash
    const intervalId = window.setInterval(tick, 1_000);
    return () => window.clearInterval(intervalId);
  }, [circuitBreakerActiveUntil]);

  useEffect(() => {
    if (cancelledReason !== "no_show") return;

    const timer = window.setTimeout(() => {
      router.replace("/pvp/1v1");
    }, 6_000);

    return () => window.clearTimeout(timer);
  }, [cancelledReason, router]);

  useEffect(() => {
    return addListener((message) => {
      if (message.type === "QUEUE_STATUS") {
        setQueueStatus(message.payload.status);
      }

      if (message.type === "MATCH_FOUND") {
        const opponent = message.payload.players.find((player) => player.userId !== user?.userId) ?? message.payload.players[0] ?? null;
        setPendingMatch({
          matchId: message.payload.matchId,
          opponent: opponent
            ? {
                username: opponent.username,
                rankTier: opponent.rankTier,
                rating: opponent.rating,
                averageWpm: opponent.averageWpm,
              }
            : null,
        });
        setQueueStatus("MATCH_FOUND");
      }
    });
  }, [addListener, user?.userId]);

  useEffect(() => {
    if (queueStatus === "SEARCHING") {
      setSearchStartedAtMs((current) => current ?? Date.now());
      return;
    }

    if (!pendingMatch) {
      setSearchStartedAtMs(null);
      setElapsedSec(0);
    }
  }, [pendingMatch, queueStatus]);

  useEffect(() => {
    if (!searchStartedAtMs) return;

    const intervalId = window.setInterval(() => {
      const currentNowMs = Date.now();
      setElapsedSec(Math.max(0, Math.floor((currentNowMs - searchStartedAtMs) / 1000)));
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [searchStartedAtMs]);

  useEffect(() => {
    if (!pendingMatch) return;

    router.push(`/pvp/match/${pendingMatch.matchId}`);
  }, [pendingMatch, router]);

  const bannerMsg = getConnectionBannerMessage(connectionPhase);

  // Keep the reconnecting banner visible while a retry attempt is in progress
  // (phase transitions to "connecting" between attempts, making bannerMsg null).
  // We clear the sticky message only when the connection is healthy or has
  // permanently failed.
  const lastReconnectMsgRef = useRef<string | null>(null);
  if (connectionPhase.kind === "reconnecting") {
    lastReconnectMsgRef.current = bannerMsg;
  } else if (connectionPhase.kind === "ready" || connectionPhase.kind === "idle" || connectionPhase.kind === "permanent_failure") {
    lastReconnectMsgRef.current = null;
  }
  // When connecting and there's a sticky message, show it until success/failure.
  const effectiveBannerMsg =
    bannerMsg ?? (connectionPhase.kind === "connecting" ? lastReconnectMsgRef.current : null);
  const effectiveBannerIsReconnecting =
    connectionPhase.kind === "reconnecting" ||
    (connectionPhase.kind === "connecting" && lastReconnectMsgRef.current !== null);

  const canQueue = connectionPhase.kind === "ready" && (queueStatus === "IDLE" || queueStatus === "CONNECTED") && !pendingMatch;
  const isSearching = queueStatus === "SEARCHING" && !pendingMatch;

  const handleQueueJoin = useCallback(() => {
    if (!canQueue) return;
    send({ type: "QUEUE_JOIN", payload: {} });
  }, [canQueue, send]);

  const autoQueueFiredRef = useRef(false);
  useEffect(() => {
    if (autoQueueFiredRef.current) return;
    if (searchParams?.get("autoQueue") !== "1") return;
    if (!canQueue) return;
    autoQueueFiredRef.current = true;
    handleQueueJoin();
    router.replace("/pvp/1v1");
  }, [canQueue, searchParams, handleQueueJoin, router]);

  const opponentRank = useMemo(() => {
    if (!pendingMatch?.opponent) return "Unranked";
    if (pendingMatch.opponent.rankTier && pendingMatch.opponent.rating != null) {
      return `${pendingMatch.opponent.rankTier} · ${pendingMatch.opponent.rating}`;
    }
    return pendingMatch.opponent.rankTier ?? (pendingMatch.opponent.rating != null ? `Rating ${pendingMatch.opponent.rating}` : "Rank pending");
  }, [pendingMatch]);

  const queueStatusLabel = getQueueStatusLabel({ queueStatus, pendingMatch });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Card className="overflow-hidden border border-[rgba(140,221,255,0.18)] bg-[radial-gradient(circle_at_top,_rgba(24,73,110,0.9),_rgba(8,22,40,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <CardHeader className="border-b border-[rgba(160,220,255,0.12)] pb-5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.28em] text-[#8DCBEB]">PvP Ranked Queue</div>
              <CardTitle className="text-3xl text-[#F2F7FF]">Ranked 1v1</CardTitle>
              <p className="max-w-2xl text-sm text-[#B5CAE2]">
                Every match uses a server-selected ranked text. Players share one queue, then move to the match page where the countdown runs.
              </p>
            </div>
            <div className="rounded-full border border-[rgba(160,220,255,0.16)] bg-[rgba(255,255,255,0.04)] p-3 text-[#9DDBFF]">
              <Swords className="h-6 w-6" />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-6 text-[#E0E7FF]/90">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(160,220,255,0.12)] bg-[rgba(7,18,34,0.42)] px-4 py-3 text-sm text-[#AFC5DA]">
            <div>
              Connection: {status} · Queue: {queueStatusLabel}
              {isSearching ? ` · ${elapsedSec}s` : ""}
            </div>
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin text-[#B8E6FF]" /> : null}
          </div>

          {isOffline ? (
            <div className="flex items-center gap-2 rounded-xl border border-[rgba(251,191,36,0.25)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-sm text-amber-200">
              <WifiOff className="h-4 w-4 shrink-0 text-amber-400" />
              No internet connection detected. Reconnecting when back online&hellip;
            </div>
          ) : effectiveBannerMsg ? (
            effectiveBannerIsReconnecting ? (
              <div className="flex items-center gap-2 rounded-xl border border-[rgba(125,211,252,0.22)] bg-[rgba(56,189,248,0.08)] px-3 py-2 text-sm text-sky-200">
                <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
                {effectiveBannerMsg}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(239,68,68,0.28)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-sm text-red-300">
                <div className="min-w-0 space-y-0.5">
                  <div>{effectiveBannerMsg}</div>
                  {connectionPhase.kind === "permanent_failure" && (
                    <div className="text-xs text-red-400/70">
                      Last attempt failed {formatTimeAgo(connectionPhase.failedAt)}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={reconnect}
                  disabled={cooldownRemaining !== null}
                  className="shrink-0"
                >
                  {cooldownRemaining !== null
                    ? `Try again in ${formatCooldown(cooldownRemaining)}`
                    : "Try again"}
                </Button>
              </div>
            )
          ) : null}

          {cancelledReason === "no_show" ? (
            <div className="rounded-xl border border-[rgba(251,191,36,0.25)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-sm text-amber-200">
              The opponent did not connect in time, so the match was cancelled.
            </div>
          ) : null}

          {pendingMatch ? (
            <div className="grid gap-4 rounded-[28px] border border-[rgba(130,214,255,0.18)] bg-[linear-gradient(135deg,rgba(17,45,72,0.95),rgba(10,22,38,0.95))] p-5 md:grid-cols-[1.3fr_0.7fr]">
              <div className="space-y-4">
                <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">Match found</div>
                <div>
                  <div className="text-3xl font-semibold text-white">{pendingMatch.opponent?.username ?? "Opponent"}</div>
                  <div className="mt-2 text-sm text-[#A9C0D6]">{opponentRank}</div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[rgba(160,220,255,0.12)] bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-[#85C9E8]">Average WPM</div>
                    <div className="mt-2 text-2xl font-semibold text-[#F4FBFF]">{pendingMatch.opponent?.averageWpm ?? "--"}</div>
                  </div>
                  <div className="rounded-2xl border border-[rgba(160,220,255,0.12)] bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-[#85C9E8]">Format</div>
                    <div className="mt-2 text-sm text-[#F4FBFF]">Server-random ranked text</div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center rounded-[24px] border border-[rgba(160,220,255,0.12)] bg-[rgba(255,255,255,0.03)] p-5 text-center">
                <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">Loading arena</div>
                <Loader2 className="mt-3 h-10 w-10 animate-spin text-[#B8E6FF]" />
                <div className="mt-3 text-sm text-[#A9C0D6]">Redirecting to the match page. Countdown begins there only.</div>
              </div>
            </div>
          ) : isSearching ? (
            <div className="rounded-[28px] border border-[rgba(130,214,255,0.18)] bg-[linear-gradient(135deg,rgba(17,45,72,0.95),rgba(10,22,38,0.95))] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">Searching</div>
                  <div className="text-3xl font-semibold text-white">Finding opponent...</div>
                  <div className="text-sm text-[#A9C0D6]">Queue time: {elapsedSec}s</div>
                </div>
                <Button variant="secondary" onClick={() => send({ type: "QUEUE_LEAVE", payload: {} })}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[28px] border border-[rgba(130,214,255,0.14)] bg-[rgba(7,18,34,0.5)] p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">Queue Rules</div>
                <div className="mt-3 space-y-3 text-sm text-[#B5CAE2]">
                  <p>Ranked 1v1 uses one shared matchmaking pool.</p>
                  <p>Text length is chosen by the server for each match.</p>
                  <p>You will see your opponent, rank, and average WPM before the match starts.</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-[rgba(130,214,255,0.14)] bg-[rgba(255,255,255,0.04)] p-5">
                <div className="text-xs uppercase tracking-[0.24em] text-[#91D7F6]">Ready</div>
                <div className="mt-3 text-sm text-[#B5CAE2]">Join the ranked queue when your websocket is connected.</div>
                <Button className="mt-5 w-full" disabled={!canQueue} onClick={handleQueueJoin}>
                  Play Ranked 1v1
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

