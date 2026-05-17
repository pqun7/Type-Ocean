
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
Loader2,
WifiOff,
Target,
Zap,
Trophy,
Flame,
ShieldCheck,
Skull,
Crown,
} from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { ArenaButton, RuleItem, type RuleItemData } from "@/components/pvp/ui";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import { usePvpErrorAlert } from "@/features/pvp/client/pvp-error-utils";
import { getConnectionBannerMessage } from "@/features/pvp/client/connection-state-machine";
import { useUserAvatar } from "@/features/auth/hooks/useUserAvatar";
import { resolveAvatarUrl } from "@/features/auth/avatar";
import {
getRankMeta,
RankBadge,
RankProgression,
PvpAvatar,
} from "@/components/pvp/rank";

// ─── Types ────────────────────────────────────────────────────────────────────

type PendingMatch = {
matchId: string;
opponent: {
  userId: string;
  username: string;
  avatar: string | null;
  rankTier?: string;
  rating?: number;
  averageWpm?: number | null;
  bestWpm?: number | null;
  avgAcc?: number | null;
} | null;
};

/** Phased UX state for the match-found flow — no dialogs, inline reveal. */
type MatchPhase =
| "idle"
| "searching"
| "opponent_revealed"
| "preparing"
| "entering";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCooldown(ms: number): string {
const totalSecs = Math.ceil(ms / 1_000);
const mins = Math.floor(totalSecs / 60);
const secs = totalSecs % 60;
return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTimeAgo(epochMs: number): string {
const diffMins = Math.floor((Date.now() - epochMs) / 60_000);
if (diffMins < 1) return "just now";
if (diffMins === 1) return "1 minute ago";
return `${diffMins} minutes ago`;
}

const arenaRules: RuleItemData[] = [
{ icon: Zap, text: "Ranked ladder: Every win or loss shifts your standing" },
{ icon: ShieldCheck, text: "Anti-cheat monitors every keystroke for fair play" },
{ icon: Skull, text: "Leaving mid-match results in rating penalty" },
{ icon: Crown, text: "Challenge yourself and dominate the leaderboard" },
];

// ─── Optimistic streak cache hook ─────────────────────────────────────────────
// 1. Shows localStorage value immediately (no flash)
// 2. Cross-tab sync via storage event (not polling)
// Server value from /api/pvp/me is always authoritative; this just gives instant UI.
const STREAK_STALE_MS = 86_400_000; // 24 h

function useLocalStreak(userId: string | undefined): [number, (streak: number) => void] {
const [localStreak, setLocalStreak] = useState<number>(0);

// Read localStorage after hydration (localStorage is unavailable during SSR)
useEffect(() => {
  if (!userId) return;
  try {
    const raw = localStorage.getItem(`pvp:streak:${userId}`);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { streak?: unknown; ts?: unknown };
    if (typeof parsed.streak !== "number") return;
    if (typeof parsed.ts === "number" && Date.now() - parsed.ts > STREAK_STALE_MS) return;
    setLocalStreak(parsed.streak);
  } catch {
    // localStorage unavailable or corrupt — silent
  }
}, [userId]);

// Cross-tab sync: uses storage event, never polling
useEffect(() => {
  if (!userId) return;
  const key = `pvp:streak:${userId}`;
  const handler = (e: StorageEvent) => {
    if (e.key !== key || e.newValue === null) return;
    try {
      const parsed = JSON.parse(e.newValue) as { streak?: unknown };
      if (typeof parsed.streak === "number") setLocalStreak(parsed.streak);
    } catch {
      // ignore
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}, [userId]);

return [localStreak, setLocalStreak];
}


// ─── VS Visualization with Micro-interactions ───────────────────────────────

type AnimatedVSProps = {
active: boolean;
};

function AnimatedVS({ active }: AnimatedVSProps) {
return (
  <div
    className="relative flex flex-col items-center justify-center"
  >
    <div
      className="absolute inset-0 rounded-full blur-2xl transition-all duration-500"
      style={{
        background: active ? "radial-gradient(circle, rgba(255,80,80,0.3) 0%, transparent 70%)" : "transparent",
        scale: active ? 1.5 : 1,
      }}
    />
    <div className="h-4 w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.2), transparent)" }} />
    <div className="relative">
      <span
        className="select-none text-[8px] font-black tracking-[0.24em] transition-all duration-300"
        style={{
          color: active ? "#FF6B6B" : "rgba(255,255,255,0.25)",
          textShadow: active ? "0 0 8px rgba(255,107,107,0.6)" : "none",
          writingMode: "vertical-rl",
          transform: active ? "scale(1.05)" : "scale(1)",
        }}
      >
        VS
      </span>
      {active && (
        <div className="absolute inset-0 animate-ping rounded-full" style={{ background: "rgba(255,107,107,0.3)" }} />
      )}
    </div>
    <div className="h-4 w-px" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.2), transparent)" }} />
  </div>
);
}

// ─── PlayerCard (Enhanced with Premium Visuals) ─────────────────────────────

type PlayerCardVariant = "local" | "empty" | "scanning" | "opponent";

type PlayerCardProps = {
side: "left" | "right";
label: string;
accentHex: string;
variant: PlayerCardVariant;
username?: string;
avatarUrl?: string | null;
tier?: string;
rating?: number;
averageWpm?: number | null;
bestWpm?: number | null;
avgAcc?: number | null;
elapsedSec?: number;
streak?: number;
level?:number;
};

function PlayerCard({
side,
label,
accentHex,
variant,
avatarUrl,
username,
tier,
averageWpm,
bestWpm,
avgAcc,
elapsedSec = 0,
streak = 0,
level = 1,
}: PlayerCardProps) {
const isActive = variant === "local" || variant === "opponent";
const isScanning = variant === "scanning";
const rankMeta = getRankMeta(tier);
const avatarGlow = variant === "opponent" ? rankMeta.glow : `${accentHex}40`;

return (
  <div
    className={`group relative flex h-full flex-col items-center gap-1.5 overflow-hidden rounded-xl p-2 transition-all duration-500 hover:shadow-xl ${
      isActive ? "backdrop-blur-sm" : ""
    }`}
    style={{
      background:
        variant === "empty"
          ? "rgba(255,255,255,0.012)"
          : `linear-gradient(145deg, ${accentHex}0C 0%, rgba(4,8,18,0.85) 100%)`,
      border:
        variant === "empty"
          ? "1px solid rgba(255,255,255,0.038)"
          : `1px solid ${accentHex}30`,
      boxShadow: isActive ? `0 4px 20px ${rankMeta.glow}10` : "0 4px 20px rgba(0,0,0,0.08)",
      minHeight: 180,
    }}
  >
    {/* Animated gradient border on active cards */}
    {isActive && (
      <div
        className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 30% 20%, ${accentHex}20, transparent 70%)`,
        }}
      />
    )}
    
    {/* Corner accent */}
    <div
      className={`absolute top-0 ${side === "left" ? "left-0" : "right-0"} w-8 h-8 opacity-30`}
      style={{
        background: `radial-gradient(circle at ${side === "left" ? "0%" : "100%"} 0%, ${accentHex}40, transparent 70%)`,
      }}
    />
    
    {/* Vertical accent line */}
    {isActive && (
      <div
        className={`pointer-events-none absolute bottom-0 top-0 w-px ${side === "left" ? "left-0" : "right-0"}`}
        style={{
          background: `linear-gradient(180deg, transparent 0%, ${accentHex}80 50%, transparent 100%)`,
        }}
      />
    )}

    <div className="flex w-full flex-col items-center gap-1.5">
      <div
        className="text-[7px] font-bold uppercase tracking-[0.24em] transition-all duration-300 group-hover:tracking-[0.32em]"
        style={{ color: isActive || isScanning ? `${accentHex}aa` : "rgba(255,255,255,0.1)" }}
      >
        {label}
      </div>

      {variant === "empty" ? (
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-black"
          style={{
            background: "rgba(255,255,255,0.014)",
            border: "2px dashed rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.055)",
          }}
        >
          ?
        </div>
      ) : isScanning ? (
        <div className="relative flex h-14 w-14 items-center justify-center">
          <div
            className="absolute inset-0 animate-spin rounded-full"
            style={{
              border: "2px solid transparent",
              borderTopColor: `${accentHex}99`,
              animationDuration: "1.3s",
            }}
          />
          <div
            className="absolute inset-[5px] animate-spin rounded-full"
            style={{
              border: "1px solid transparent",
              borderTopColor: `${accentHex}44`,
              animationDuration: "2s",
              animationDirection: "reverse",
            }}
          />
          <Loader2 className="h-3.5 w-3.5" style={{ color: `${accentHex}66` }} />
        </div>
      ) : username ? (
        <PvpAvatar
          username={username}
          avatarUrl={avatarUrl}
          size={60}
          accentColor={accentHex}
          glowColor={avatarGlow}
          rankTier={tier}
          level={level}
          streak={streak}
          levelColor={variant === "opponent" ? accentHex : undefined}
        />
      ) : null}

      {isActive && username ? (
        <div className="w-full space-y-1 text-center">
          <div
            className="truncate text-xs font-bold tracking-tight"
            style={{ color: "#F0F4FF" }}
          >
            {username}
          </div>
          <RankBadge tier={tier} variant={variant === "opponent" ? "danger" : "default"} />
          <div className="grid grid-cols-3 gap-0.5 pt-1">
            {[
              { label: "AVG", value: averageWpm ?? "—", unit: "wpm" },
              { label: "BEST", value: bestWpm ?? "—", unit: "wpm" },
              { label: "ACC", value: avgAcc != null ? `${avgAcc}%` : "—", unit: "avg" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col items-center gap-0.5 rounded-md px-0.5 py-0.5 transition-all duration-200 hover:bg-white/5"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {stat.label}
                </span>
                <span className="text-[14px] font-bold tabular-nums leading-none" style={{ color: `${accentHex}cc` }}>
                  {stat.value}
                </span>
                <span className="text-[7px] uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>
                  {stat.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : isScanning ? (
        <div className="text-center">
          <div className="text-[10px] font-medium" style={{ color: `${accentHex}80` }}>
            Scanning arena...
          </div>
          <div className="mt-0.5 text-[8px]" style={{ color: "rgba(255,255,255,0.2)" }}>
            {elapsedSec}s in queue
          </div>
        </div>
      ) : (
        <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.08)" }}>
          Awaiting rival
        </div>
      )}
    </div>
  </div>
);
}

// ─── Main Component ─────────────────────────────────────────────────────────

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
  refreshUserSnapshot,
  connectionPhase,
  isOffline,
  circuitBreakerActiveUntil,
} = usePvpSocket();
usePvpErrorAlert(error);
const { avatarUrl: profileAvatarUrl, username: profileUsername } = useUserAvatar(true);

const [queueStatus, setQueueStatus] = useState<string>("IDLE");
const [matchPhase, setMatchPhase] = useState<MatchPhase>("idle");
const [searchStartedAtMs, setSearchStartedAtMs] = useState<number | null>(null);
const [elapsedSec, setElapsedSec] = useState(0);
const [pendingMatch, setPendingMatch] = useState<PendingMatch | null>(null);
const [preMatchLabel, setPreMatchLabel] = useState("Syncing Players");
const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);
const cancelledReason = searchParams?.get("cancelled");

// Streak: optimistic localStorage cache (instant display) + server correction
const [localStreak, setLocalStreak] = useLocalStreak(user?.userId);
const { data: pvpMeData } = useSWR<{ currentStreak?: number; level?: number }>(
  user?.userId ? "/api/pvp/me" : null,
  (url: string) => fetch(url).then((r) => r.json() as Promise<{ currentStreak?: number; level?: number }>),
  { dedupingInterval: 10_000, revalidateOnFocus: false },
);

// Opponent level + streak: fetch once opponent is known
const [opponentLevel, setOpponentLevel] = useState<number>(1);
const [opponentStreak, setOpponentStreak] = useState<number>(0);
useEffect(() => {
  const oppUserId = pendingMatch?.opponent?.userId;
  if (!oppUserId) { setOpponentLevel(1); setOpponentStreak(0); return; }
  let cancelled = false;
  fetch(`/api/pvp/players/${encodeURIComponent(oppUserId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { level?: number; currentStreak?: number } | null) => {
      if (!cancelled) {
        if (typeof data?.level === "number") setOpponentLevel(data.level);
        if (typeof data?.currentStreak === "number") setOpponentStreak(data.currentStreak);
      }
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
}, [pendingMatch?.opponent?.userId]);
// Sync: once server responds, update localStreak to match (server wins)
useEffect(() => {
  if (pvpMeData?.currentStreak !== undefined && typeof pvpMeData.currentStreak === "number") {
    setLocalStreak(pvpMeData.currentStreak);
  }
}, [pvpMeData?.currentStreak, setLocalStreak]);
const currentStreak = pvpMeData?.currentStreak ?? localStreak;

// Circuit-breaker countdown
useEffect(() => {
  if (circuitBreakerActiveUntil === null) {
    setCooldownRemaining(null);
    return;
  }
  const tick = () => {
    const rem = Math.max(0, circuitBreakerActiveUntil - Date.now());
    setCooldownRemaining(rem > 0 ? rem : null);
  };
  tick();
  const id = window.setInterval(tick, 1_000);
  return () => window.clearInterval(id);
}, [circuitBreakerActiveUntil]);

// Auto-clear cancelled banner
useEffect(() => {
  if (cancelledReason !== "no_show") return;
  const t = window.setTimeout(() => router.replace("/pvp/1v1"), 6_000);
  return () => window.clearTimeout(t);
}, [cancelledReason, router]);

// Incoming server messages
useEffect(() => {
  return addListener((message) => {
    if (message.type === "QUEUE_STATUS") {
      setQueueStatus(message.payload.status);
    }
    if (message.type === "MATCH_FOUND") {
      const opp =
        message.payload.players.find((p) => p.userId !== user?.userId) ??
        message.payload.players[0] ??
        null;
      setPendingMatch({
        matchId: message.payload.matchId,
        opponent: opp
          ? {
              userId: opp.userId,
              username: opp.username,
              avatar: opp.avatar,
              rankTier: opp.rankTier,
              rating: opp.rating,
              averageWpm: opp.averageWpm,
              bestWpm: opp.bestWpm,
              avgAcc: opp.avgAcc,
            }
          : null,
      });
      setQueueStatus("MATCH_FOUND");
    }
  });
}, [addListener, user?.userId]);

// Queue status → match phase
useEffect(() => {
  if (queueStatus === "SEARCHING") {
    setMatchPhase("searching");
    setSearchStartedAtMs((c) => c ?? Date.now());
  } else if (queueStatus === "IDLE" || queueStatus === "CONNECTED") {
    setMatchPhase((prev) => (prev === "searching" ? "idle" : prev));
    setSearchStartedAtMs(null);
    setElapsedSec(0);
  }
}, [queueStatus]);

useEffect(() => {
  if (connectionPhase.kind !== "ready") return;
  void refreshUserSnapshot();
}, [connectionPhase.kind, refreshUserSnapshot]);

useEffect(() => {
  const handleVisible = () => {
    if (document.visibilityState !== "visible") return;
    if (connectionPhase.kind !== "ready") return;
    void refreshUserSnapshot();
  };
  const handleFocus = () => {
    if (connectionPhase.kind !== "ready") return;
    void refreshUserSnapshot();
  };
  document.addEventListener("visibilitychange", handleVisible);
  window.addEventListener("focus", handleFocus);
  return () => {
    document.removeEventListener("visibilitychange", handleVisible);
    window.removeEventListener("focus", handleFocus);
  };
}, [connectionPhase.kind, refreshUserSnapshot]);

// Elapsed timer while searching
useEffect(() => {
  if (!searchStartedAtMs) return;
  const id = window.setInterval(
    () => setElapsedSec(Math.max(0, Math.floor((Date.now() - searchStartedAtMs) / 1_000))),
    500,
  );
  return () => window.clearInterval(id);
}, [searchStartedAtMs]);

// Phased pre-match reveal
useEffect(() => {
  if (!pendingMatch) return;
  setMatchPhase("opponent_revealed");
  setPreMatchLabel("Syncing Players");

  const t1 = window.setTimeout(() => {
    setMatchPhase("preparing");
    setPreMatchLabel("Preparing Match");
  }, 1_400);
  const t2 = window.setTimeout(() => setPreMatchLabel("Lock in — here we go"), 3_100);
  const t3 = window.setTimeout(() => {
    setMatchPhase("entering");
    router.push(`/pvp/match/${pendingMatch.matchId}`);
  }, 4_600);

  return () => {
    window.clearTimeout(t1);
    window.clearTimeout(t2);
    window.clearTimeout(t3);
  };
}, [pendingMatch, router]);

// Connection banner logic
const bannerMsg = getConnectionBannerMessage(connectionPhase);
// Do not reuse stale reconnect text while transitioning through "connecting".
// This avoids showing a misleading reconnect banner when the socket has
// already recovered but HELLO_OK is still in-flight.
const effectiveBannerMsg = bannerMsg;
const effectiveBannerIsReconnecting = connectionPhase.kind === "reconnecting";

const canQueue =
  connectionPhase.kind === "ready" &&
  (queueStatus === "IDLE" || queueStatus === "CONNECTED") &&
  !pendingMatch;
const isConnected = connectionPhase.kind === "ready";
const localUsername = user?.username ?? profileUsername ?? "—";
const localAvatarUrl = resolveAvatarUrl(profileAvatarUrl, user?.avatar);

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

const isLocked =
  matchPhase === "opponent_revealed" || matchPhase === "preparing" || matchPhase === "entering";
const opponentVisible = isLocked;
const rightVariant: PlayerCardVariant = opponentVisible
  ? "opponent"
  : matchPhase === "searching"
    ? "scanning"
    : "empty";

return (
  <>
    <style>{`
      @keyframes opp-enter {
        0% { opacity: 0; transform: translateX(30px) scale(0.92) rotateY(15deg); }
        60% { opacity: 1; transform: translateX(-4px) scale(1.02) rotateY(-2deg); }
        100% { opacity: 1; transform: translateX(0) scale(1) rotateY(0); }
      }
      @keyframes bar-progress {
        from { transform: scaleX(0); }
        to { transform: scaleX(1); }
      }
      @keyframes live-dot {
        0%, 100% { box-shadow: 0 0 0 0 rgba(74,222,128,0.7); }
        50% { box-shadow: 0 0 0 6px rgba(74,222,128,0); }
      }
      @keyframes arena-leave {
        to { opacity: 0; transform: scale(0.98) translateY(-8px); filter: blur(2px); }
      }
      @keyframes glow-pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.7; }
      }
      .live-dot { animation: live-dot 2s ease-in-out infinite; }
      .arena-leave { animation: arena-leave 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
      .glow-pulse { animation: glow-pulse 3s ease-in-out infinite; }
    `}</style>

    <div
      className={`relative mx-auto max-w-6xl px-2 ${
        matchPhase === "entering" ? "arena-leave" : ""
      }`}
    >
      {/* Premium Background Effects */}
      {/* <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0A0F1A] via-[#0A0F1A] to-[#0A0C14]" />
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-blue-500/5 blur-[120px] animate-pulse" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-purple-500/5 blur-[120px] animate-pulse delay-1000" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22grid%22%20width%3D%2260%22%20height%3D%2260%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Cpath%20d%3D%22M%2060%200%20L%200%200%200%2060%22%20fill%3D%22none%22%20stroke%3D%22rgba%28255%2C255%2C255%2C0.02%29%22%20stroke-width%3D%221%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url%28%23grid%29%22/%3E%3C/svg%3E')] opacity-20" />
      </div> */}

      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          {/* <div className="mb-0.5 flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.28em]" style={{ color: "rgba(0,212,255,0.6)" }}>
            <Swords className="h-2 w-2" />
            RANKED ARENA · 1V1
          </div> */}
          <h1 className="text-[clamp(1.4rem,3.5vw,2rem)] font-black leading-none tracking-tight bg-gradient-to-r from-white via-blue-100 to-purple-200 bg-clip-text text-transparent">
            The Arena
          </h1>
        </div>
        <div
          className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wider backdrop-blur-md"
          style={{ color: isConnected ? "#4ADE80" : "rgba(255,255,255,0.4)" }}
        >
          <span className={`h-1 w-1 shrink-0 rounded-full ${isConnected ? "live-dot" : ""}`} style={{ background: isConnected ? "#4ADE80" : "rgba(255,255,255,0.2)" }} />
          {isConnected ? "LIVE" : status}
        </div>
      </div>

      {/* Alert Banners */}
      {isOffline ? (
        <div className="mb-3 flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200/90 backdrop-blur-sm">
          <WifiOff className="h-3 w-3 shrink-0" />
          No signal — reconnecting when you&apos;re back online.
        </div>
      ) : effectiveBannerMsg ? (
        effectiveBannerIsReconnecting ? (
          <div className="mb-3 flex items-center gap-1.5 rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1.5 text-[10px] text-sky-200/90 backdrop-blur-sm">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            {effectiveBannerMsg}
          </div>
        ) : (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 backdrop-blur-sm">
            <div className="min-w-0 space-y-0.5 text-[10px] text-red-200/90">
              <div>{effectiveBannerMsg}</div>
              {connectionPhase.kind === "permanent_failure" && (
                <div className="text-[8px] opacity-60">Last attempt {formatTimeAgo(connectionPhase.failedAt)}</div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={reconnect}
              disabled={cooldownRemaining !== null}
              className="shrink-0 border-red-500/40 bg-transparent text-red-300/90 hover:bg-red-500/20 hover:text-red-200 text-[9px] h-6 px-2"
            >
              {cooldownRemaining !== null ? `Retry in ${formatCooldown(cooldownRemaining)}` : "Reconnect"}
            </Button>
          </div>
        )
      ) : null}

      {cancelledReason === "no_show" && (
        <div className="mb-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200/90 backdrop-blur-sm">
          Opponent ghosted — match cancelled. Queue again when you&apos;re ready.
        </div>
      )}

      {/* Arena Stage */}
      <div className="grid grid-cols-[1fr_28px_1fr] items-stretch gap-1">
        <PlayerCard
          side="left"
          label="CHALLENGER"
          accentHex="#00D4FF"
          variant="local"
          username={localUsername}
          avatarUrl={localAvatarUrl}
          averageWpm={user?.averageWpm}
          bestWpm={user?.bestWpm}
          avgAcc={user?.avgAcc}
          tier={user?.rankTier}
          rating={user?.rating}
          streak={currentStreak}
          level={pvpMeData?.level ?? 1}
        />
        <AnimatedVS active={matchPhase === "searching"} />
        <div
          key={rightVariant}
          className="h-full"
          style={{ animation: rightVariant === "opponent" ? "opp-enter 0.5s cubic-bezier(0.34, 1.2, 0.64, 1) forwards" : undefined }}
        >
          <PlayerCard
            side="right"
            label="RIVAL"
            accentHex={opponentVisible ? "#F87171" : "#A78BFA"}
            variant={rightVariant}
            username={pendingMatch?.opponent?.username}
            avatarUrl={pendingMatch?.opponent?.avatar}
            tier={pendingMatch?.opponent?.rankTier}
            rating={pendingMatch?.opponent?.rating}
            averageWpm={pendingMatch?.opponent?.averageWpm}
            bestWpm={pendingMatch?.opponent?.bestWpm}
            avgAcc={pendingMatch?.opponent?.avgAcc}
            elapsedSec={elapsedSec}
            level={opponentLevel}
            streak={opponentStreak}
          />
        </div>
      </div>

      {/* XP & Rank Progression Section */}
      {user && !isLocked && (
        <div className="mt-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-2 backdrop-blur-sm transition-all hover:border-white/20">
            <div className="flex items-center gap-1 mb-1">
              <Trophy className="h-2.5 w-2.5" style={{ color: "#F59E0B" }} />
              <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>
                RANK LADDER
              </span>
            </div>
            <RankProgression currentTier={user.rankTier} rating={user.rating} streak={currentStreak} />
          </div>
        </div>
      )}

      {/* Pre-match Status Bar */}
      {isLocked && (
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10 backdrop-blur-sm" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div
            className="h-px origin-left"
            style={{
              background: "linear-gradient(90deg, #00D4FF, #A78BFA, #F87171)",
              animation: "bar-progress 4.6s linear forwards",
            }}
          />
          <div className="flex items-center gap-1.5 px-3 py-2">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" style={{ color: "#60A5FA" }} />
            <span className="text-[10px] font-medium tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>
              {preMatchLabel}
            </span>
          </div>
        </div>
      )}

      {/* Action Area */}
      {!isLocked && (
        <div className="mt-3">
          {matchPhase === "searching" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-500/10 to-purple-500/10 px-3 py-2 backdrop-blur-sm">
              <div>
                <div className="mb-0.5 flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.24em]" style={{ color: "rgba(167,139,250,0.7)" }}>
                  <Zap className="h-2 w-2" />
                  IN QUEUE
                </div>
                <div className="text-[10px] font-semibold" style={{ color: "#C4B5FD" }}>
                  Hunting for a worthy rival...
                </div>
                <div className="mt-0.5 text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                  {elapsedSec}s elapsed · Ranked Matchmaking
                </div>
              </div>
              <ArenaButton
                onClick={() => { send({ type: "QUEUE_LEAVE", payload: {} }); }}
                variant="danger"
                size="compact"
                fullWidth={false}
                label="Leave Queue"
                loadingLabel="Leaving..."
              />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-[1.4fr_0.6fr]">
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur-sm transition-all hover:border-white/20">
                <div className="mb-2 flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.24em]" style={{ color: "rgba(0,212,255,0.6)" }}>
                  <Target className="h-2 w-2" />
                  ARENA CODE
                </div>
                <ul className="space-y-1">
                  {arenaRules.map((rule, index) => (
                    <RuleItem key={rule.text} icon={rule.icon} text={rule.text} index={index} />
                  ))}
                </ul>
              </div>
              <div className="flex flex-col justify-between rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-transparent p-3 backdrop-blur-sm">
                <div>
                  <div className="mb-0.5 flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.24em]" style={{ color: "rgba(0,212,255,0.6)" }}>
                    <Flame className="h-2 w-2" />
                    {canQueue ? "READY" : "OFFLINE"}
                  </div>
                  <p className="text-[9px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {canQueue
                      ? "Step into the arena and prove your skills."
                      : connectionPhase.kind === "connecting" || connectionPhase.kind === "reconnecting"
                        ? "Establishing connection..."
                        : "Arena unreachable."}
                  </p>
                </div>
                <ArenaButton
                  disabled={!canQueue}
                  onClick={handleQueueJoin}
                  pulseOnReady={canQueue}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  </>
);
}