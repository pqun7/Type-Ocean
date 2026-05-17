"use client";

import { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock3, Crown, Loader2, LogOut, Shield, Users, Check,
  Copy, CheckCircle2, Zap, Sword, Flag, Settings2, MessageCircle, Send,
  Wifi, ChevronDown, Eye, Trophy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePvpSocket } from "@/features/pvp/client/usePvpSocket";
import { usePvpErrorAlert } from "@/features/pvp/client/pvp-error-utils";

// ──────────────────────────────────────────────────────────────────────────────
// 1. Premium Design System & Hand‑Drawn Accents
// ──────────────────────────────────────────────────────────────────────────────

const HandDrawnSquiggle = ({ className = "" }: { className?: string }) => (
  <svg
    className={`pointer-events-none absolute ${className}`}
    width="120" height="30" viewBox="0 0 120 30" fill="none"
    style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))" }}
  >
    <path
      d="M5,15 Q20,5 35,15 T65,15 T95,15 T115,12"
      className="stroke-white/40 stroke-[1.5] fill-none"
      strokeLinecap="round"
      strokeDasharray="3 2"
    />
  </svg>
);

const HandDrawnCircle = ({ className = "" }: { className?: string }) => (
  <svg
    className={`pointer-events-none absolute ${className}`}
    width="40" height="40" viewBox="0 0 40 40" fill="none"
    style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))" }}
  >
    <circle
      cx="20" cy="20" r="16"
      className="stroke-white/40 stroke-[1.5] fill-none"
      strokeDasharray="4 3"
    />
  </svg>
);

// ──────────────────────────────────────────────────────────────────────────────
// 2. Premium Glass Card (مستوحى من المرجع)
// ──────────────────────────────────────────────────────────────────────────────

const GlassCard = ({
  children,
  className = "",
  glowColor = "cyan",
  depth = "default",
}: {
  children: React.ReactNode;
  className?: string;
  glowColor?: "cyan" | "purple" | "amber";
  depth?: "default" | "elevated";
}) => {
  const glowMap = {
    cyan: "from-cyan-500/5 via-cyan-400/5 to-transparent",
    purple: "from-purple-500/5 via-purple-400/5 to-transparent",
    amber: "from-amber-500/5 via-amber-400/5 to-transparent",
  };
  const depthClass =
    depth === "elevated"
      ? "shadow-[0_20px_40px_-12px_rgba(0,0,0,0.4),0_8px_20px_-8px_rgba(0,0,0,0.3)]"
      : "shadow-[0_12px_24px_-8px_rgba(0,0,0,0.3),0_4px_12px_-4px_rgba(0,0,0,0.2)]";

  return (
    <div
      className={`
        group relative rounded-3xl border border-white/[0.06] bg-black/15 backdrop-blur-md
        transition-all duration-700 ease-out hover:border-white/[0.12]
        ${depthClass} ${className}
      `}
    >
      <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
        <div
          className={`
            absolute inset-0 z-0 bg-gradient-to-r ${glowMap[glowColor]}
            opacity-0 blur-2xl transition-opacity duration-1000 group-hover:opacity-100
          `}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// 3. (Button is imported from @/components/ui/button)
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// 4. Fluid Select (للإعدادات)
// ──────────────────────────────────────────────────────────────────────────────

const FluidSelect = ({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (val: number) => void;
  options: number[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 rounded-xl border border-white/20 bg-black/30 px-5 py-2 text-sm font-medium text-white backdrop-blur-md transition-all hover:border-cyan-400/50"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <Users className="h-4 w-4 text-cyan-400" />
        <span className="tabular-nums">{value}</span>
        <span className="text-white/50">Players</span>
        <ChevronDown className={`h-3.5 w-3.5 text-white/60 transition-transform duration-500 ${isOpen ? "rotate-180" : ""}`} />
      </motion.button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="absolute left-0 top-full z-20 mt-3 w-44 overflow-hidden rounded-2xl border border-white/20 bg-black/80 backdrop-blur-2xl shadow-2xl"
          >
            <div className="py-1">
              {options.map((opt) => (
                <motion.button
                  key={opt}
                  onClick={() => { onChange(opt); setIsOpen(false); }}
                  className={`flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition-all hover:bg-white/10 ${
                    value === opt ? "text-cyan-300 bg-cyan-500/10" : "text-white/70"
                  }`}
                  whileHover={{ x: 6, backgroundColor: "rgba(6,182,212,0.15)" }}
                >
                  <Users className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{opt}</span>
                  <span>Players</span>
                  {value === opt && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-cyan-400" />}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// 5. Ambient Oracle (نصائح متحركة)
// ──────────────────────────────────────────────────────────────────────────────

const AmbientOracle = () => {
  const [messageIndex, setMessageIndex] = useState(0);
  const tips = [
    { icon: Sword, text: "Host decides when the battle begins." },
    { icon: Shield, text: "Kick players or lock the lobby anytime." },
    { icon: Eye, text: "Spectate matches while you wait." },
    { icon: Wifi, text: "Low‑latency dedicated servers." },
    { icon: Trophy, text: "Wins here don’t affect public rank." },
  ];
  useEffect(() => {
    const interval = setInterval(() => setMessageIndex((prev) => (prev + 1) % tips.length), 6000);
    return () => clearInterval(interval);
  }, [tips.length]);
  const CurrentIcon = tips[messageIndex].icon;
  return (
    <div className="inline-flex items-stretch rounded-2xl border border-white/10 bg-black/20 backdrop-blur-md overflow-hidden">
      <div className="flex items-center gap-2 bg-gradient-to-r from-amber-500/20 to-amber-600/10 px-4 py-2 border-r border-white/10">
        <Crown className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">Host Privileges</span>
      </div>
      <div className="flex items-center px-4 py-2 min-w-[240px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={messageIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2"
          >
            <CurrentIcon className="h-3.5 w-3.5 text-white/60" />
            <span className="text-xs font-light tracking-wide text-white/70">{tips[messageIndex].text}</span>
          </motion.div>
        </AnimatePresence>
        <div className="ml-3 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// 6. Settings Modal (زجاجي ومتطور)
// ──────────────────────────────────────────────────────────────────────────────

interface SettingsModalProps {
  currentMax: number;
  onSave: (maxPlayers: number) => void;
  onClose: () => void;
}

const SettingsModal = ({ currentMax, onSave, onClose }: SettingsModalProps) => {
  const [maxPlayers, setMaxPlayers] = useState(currentMax);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        className="relative z-10 w-full max-w-sm rounded-t-2xl border border-white/10 bg-[#0d1220]/90 p-6 shadow-2xl backdrop-blur-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <HandDrawnSquiggle className="-top-2 right-4 opacity-40" />
        <h2 className="mb-1 text-xl font-bold text-white">Room Settings</h2>
        <p className="mb-6 text-xs text-white/40">Host‑only configuration</p>
        <div className="mb-6">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/60">Max Players</label>
          <FluidSelect value={maxPlayers} onChange={setMaxPlayers} options={[2,3,4,5,6]} />
        </div>
        <div className="mb-6 opacity-50">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-white/60">Game Mode</label>
          <div className="flex gap-2">
            <button disabled className="flex-1 cursor-not-allowed rounded-lg bg-white/5 py-2 text-xs font-bold text-white/30">Standard</button>
            <button disabled className="relative flex-1 cursor-not-allowed rounded-lg bg-white/5 py-2 text-xs font-bold text-white/30">
              Speed Run
              <span className="absolute -right-1 -top-1 rounded-full bg-amber-500/80 px-1 text-[8px] text-white">Soon</span>
            </button>
          </div>
        </div>
        <div className="flex gap-3">
          <Button onClick={onClose} variant="outline" className="flex-1">Cancel</Button>
          <Button onClick={() => { onSave(maxPlayers); onClose(); }} className="btn-main flex-1">Save</Button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// 7. Member Card Premium (مستوحى من PlayerCard في 1v1)
// ──────────────────────────────────────────────────────────────────────────────

const RANK_COLORS: Record<string, string> = {
  Prime:     "text-slate-400 border-slate-500/50",
  Silver:    "text-gray-300 border-gray-400/50",
  Gold:      "text-amber-400 border-amber-500/50",
  Platinum:  "text-cyan-300 border-cyan-500/50",
  Diamond:   "text-blue-300 border-blue-500/50",
  Legendary: "text-fuchsia-400 border-fuchsia-500/50",
};

const AVATAR_GRADIENTS = [
  "from-cyan-500/30 to-blue-600/30",
  "from-purple-500/30 to-indigo-600/30",
  "from-rose-500/30 to-pink-600/30",
  "from-emerald-500/30 to-teal-600/30",
  "from-amber-500/30 to-orange-600/30",
  "from-sky-500/30 to-cyan-600/30",
];

const avatarGradient = (userId: string) => {
  const hash = userId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
};

const MEMBER_SKELETON_KEYS = [0, 1, 2];
const MAX_CHAT_MESSAGES = 100;

const appendChatMessage = (messages: ChatMsg[], message: ChatMsg): ChatMsg[] => {
  if (messages.length < MAX_CHAT_MESSAGES) {
    return [...messages, message];
  }

  return [...messages.slice(1), message];
};

interface MemberCardProps {
  member: RoomMember;
  isHost: boolean;
  currentUserId?: string;
  onKick: (userId: string) => void;
  canKick: boolean;
  justReady: boolean;
}

const MemberCard = memo(({ member, isHost, currentUserId, onKick, canKick, justReady }: MemberCardProps) => {
  const isCurrentUser = member.userId === currentUserId;
  const [confirmKick, setConfirmKick] = useState(false);
  const rankStyle = member.rankTier ? RANK_COLORS[member.rankTier] ?? "text-white/40 border-white/20" : null;
  const gradientClass = useMemo(() => avatarGradient(member.userId), [member.userId]);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={`group relative rounded-xl border transition-all duration-500 ${
        justReady
          ? "scale-[1.02] border-emerald-400/60 shadow-[0_0_18px_rgba(52,211,153,0.25)]"
          : member.ready
            ? "border-emerald-500/40 bg-gradient-to-r from-emerald-500/10 to-transparent"
            : "border-white/10 bg-white/5 hover:border-white/20"
      }`}
    >
      <div className="flex items-center justify-between p-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white ring-2 ${
              gradientClass
            } ${member.ready ? "ring-emerald-500/50" : "ring-white/10"}`}>
              {member.username?.charAt(0).toUpperCase() ?? "?"}
            </div>
            {member.ready && (
              <div className="absolute -right-0.5 -top-0.5 rounded-full bg-emerald-500 p-0.5">
                <Check className="h-2.5 w-2.5 text-white" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-semibold text-white">{member.username}</span>
              {isHost && <Crown className="h-3 w-3 shrink-0 text-amber-400" />}
              {isCurrentUser && (
                <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-white/60">YOU</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/40">
              {rankStyle && (
                <span className={`rounded-full border px-1.5 py-0.5 font-semibold uppercase ${rankStyle}`}>
                  {member.rankTier}
                </span>
              )}
              {member.averageWpm != null && <span>{member.averageWpm} WPM</span>}
              {member.ready && <span className="text-emerald-400">● READY</span>}
            </div>
          </div>
        </div>

        {canKick && !isCurrentUser && (
          confirmKick ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => { onKick(member.userId); setConfirmKick(false); }}
                className="rounded-lg bg-rose-600/90 px-2 py-1 text-[10px] font-bold text-white hover:bg-rose-600"
              >Confirm</button>
              <button
                onClick={() => setConfirmKick(false)}
                className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-white/70 hover:bg-white/20"
              >Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmKick(true)}
              className="shrink-0 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-400 opacity-0 transition-all hover:bg-rose-500/20 group-hover:opacity-100"
            >Kick</button>
          )
        )}
      </div>
    </motion.div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.isHost === nextProps.isHost &&
    prevProps.currentUserId === nextProps.currentUserId &&
    prevProps.canKick === nextProps.canKick &&
    prevProps.justReady === nextProps.justReady &&
    prevProps.onKick === nextProps.onKick &&
    prevProps.member.userId === nextProps.member.userId &&
    prevProps.member.username === nextProps.member.username &&
    prevProps.member.avatar === nextProps.member.avatar &&
    prevProps.member.slot === nextProps.member.slot &&
    prevProps.member.ready === nextProps.member.ready &&
    prevProps.member.rating === nextProps.member.rating &&
    prevProps.member.rankTier === nextProps.member.rankTier &&
    prevProps.member.averageWpm === nextProps.member.averageWpm
  );
});

MemberCard.displayName = "MemberCard";

const MemberSkeleton = () => (
  <div className="animate-pulse rounded-xl border border-white/10 bg-white/5 p-3">
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-full bg-white/10" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-24 rounded bg-white/10" />
        <div className="h-2 w-16 rounded bg-white/10" />
      </div>
    </div>
  </div>
);

// ──────────────────────────────────────────────────────────────────────────────
// 8. Types & Audio Hook (كما في المرجع)
// ──────────────────────────────────────────────────────────────────────────────

interface RoomMember {
  userId: string;
  username: string;
  avatar: string | null;
  slot: number;
  ready: boolean;
  rating?: number | null;
  rankTier?: string | null;
  averageWpm?: number | null;
}

interface ChatMsg {
  id: string;
  userId: string;
  username: string;
  text: string;
  ts: number;
}

function useLobbyAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!ctxRef.current) {
      try { ctxRef.current = new AudioContext(); } catch { return null; }
    }
    return ctxRef.current;
  }, []);
  const resumeAudio = useCallback(() => {
    const audioContext = getCtx();
    if (!audioContext || audioContext.state !== "suspended") return;
    void audioContext.resume();
  }, [getCtx]);
  const playJoin = useCallback(() => {
    const ac = getCtx(); if (!ac) return;
    const osc = ac.createOscillator(); const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.frequency.setValueAtTime(440, ac.currentTime);
    osc.frequency.linearRampToValueAtTime(880, ac.currentTime + 0.15);
    gain.gain.setValueAtTime(0.12, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.3);
    osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.3);
  }, [getCtx]);
  const playReady = useCallback(() => {
    const ac = getCtx(); if (!ac) return;
    [0, 0.1].forEach((delay, i) => {
      const osc = ac.createOscillator(); const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.frequency.value = i === 0 ? 523 : 660;
      gain.gain.setValueAtTime(0.1, ac.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + 0.2);
      osc.start(ac.currentTime + delay); osc.stop(ac.currentTime + delay + 0.25);
    });
  }, [getCtx]);
  const playTick = useCallback(() => {
    const ac = getCtx(); if (!ac) return;
    const osc = ac.createOscillator(); const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.07, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.05);
    osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.05);
  }, [getCtx]);
  useEffect(() => {
    return () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);
  return { playJoin, playReady, playTick, resumeAudio };
}

// ──────────────────────────────────────────────────────────────────────────────
// 9. Main Component – PvpRoomLobbyClient (Premium)
// ──────────────────────────────────────────────────────────────────────────────

export default function PvpRoomLobbyClient({ code }: { code: string }) {
  const router = useRouter();
  const { status, error, user, send, addListener } = usePvpSocket();
  usePvpErrorAlert(error);
  const { playJoin, playReady, playTick, resumeAudio } = useLobbyAudio();

  const [room, setRoom] = useState<{
    code: string;
    status: string;
    minPlayers?: number;
    maxPlayers: number;
    hostUserId?: string | null;
    expiresAt?: string | null;
    members: RoomMember[];
  } | null>(null);
  const [pendingMatch, setPendingMatch] = useState<{ matchId: string; serverStartAt: string } | null>(null);
  const [matchCountdown, setMatchCountdown] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [roomLoading, setRoomLoading] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [justReadyIds, setJustReadyIds] = useState<Set<string>>(new Set());

  const prevMemberCountRef = useRef(0);
  const prevReadyIdsRef = useRef<Set<string>>(new Set());
  const justReadyTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const matchCountdownRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestChatInputRef = useRef(chatInput);

  // ── Socket listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    return addListener((message) => {
      if (message.type === "ROOM_STATE") {
        const nextRoom = message.payload.room;
        if (nextRoom.members.length > prevMemberCountRef.current) playJoin();
        prevMemberCountRef.current = nextRoom.members.length;

        const newlyReady = nextRoom.members.filter(
          (m: RoomMember) => m.ready && !prevReadyIdsRef.current.has(m.userId)
        );
        if (newlyReady.length > 0) {
          playReady();
          setJustReadyIds((prev) => {
            const next = new Set(prev);
            newlyReady.forEach((m: RoomMember) => next.add(m.userId));
            return next;
          });
          newlyReady.forEach((m: RoomMember) => {
            const existing = justReadyTimers.current.get(m.userId);
            if (existing) clearTimeout(existing);
            const timer = setTimeout(() => {
              setJustReadyIds((prev) => {
                const next = new Set(prev);
                next.delete(m.userId);
                return next;
              });
              justReadyTimers.current.delete(m.userId);
            }, 600);
            justReadyTimers.current.set(m.userId, timer);
          });
        }
        prevReadyIdsRef.current = new Set(nextRoom.members.filter((m: RoomMember) => m.ready).map((m) => m.userId));
        setRoom(nextRoom);
        setRoomLoading(false);
      }
      if (message.type === "MATCH_FOUND") {
        setPendingMatch({ matchId: message.payload.matchId, serverStartAt: message.payload.serverStartAt });
      }
      if (message.type === "LOBBY_CHAT") {
        const p = message.payload;
        setChatMessages((prev) => appendChatMessage(prev, {
          id: `${p.userId}-${p.ts}`,
          userId: p.userId,
          username: p.username,
          text: p.text,
          ts: p.ts,
        }));
      }
    });
  }, [addListener, playJoin, playReady]);

  useEffect(() => {
    const clearTimers = () => {
      justReadyTimers.current.forEach((timer) => clearTimeout(timer));
      justReadyTimers.current.clear();
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };

    return clearTimers;
  }, []);

  useEffect(() => {
    const handleUserGesture = () => {
      resumeAudio();
    };

    window.addEventListener("pointerdown", handleUserGesture, { passive: true });
    window.addEventListener("keydown", handleUserGesture);

    return () => {
      window.removeEventListener("pointerdown", handleUserGesture);
      window.removeEventListener("keydown", handleUserGesture);
    };
  }, [resumeAudio]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);
  useEffect(() => { if (status === "ready") send({ type: "ROOM_JOIN", payload: { code } }); }, [status, send, code]);
  useEffect(() => {
    if (!pendingMatch) {
      matchCountdownRef.current = null;
      setMatchCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const diffMs = new Date(pendingMatch.serverStartAt).getTime() - Date.now();
      const nextCountdown = Math.max(0, Math.ceil(diffMs / 1000));

      if (nextCountdown === matchCountdownRef.current) {
        return;
      }

      matchCountdownRef.current = nextCountdown;
      setMatchCountdown(nextCountdown);
    };

    updateCountdown();
    const id = setInterval(updateCountdown, 1000);
    return () => clearInterval(id);
  }, [pendingMatch]);

  useEffect(() => {
    if (matchCountdown == null || matchCountdown > 10 || matchCountdown <= 0) return;
    if (lastTickRef.current !== matchCountdown) {
      lastTickRef.current = matchCountdown;
      playTick();
    }
  }, [matchCountdown, playTick]);

  useEffect(() => {
    if (!pendingMatch) return;
    const delayMs = new Date(pendingMatch.serverStartAt).getTime() - Date.now();
    if (delayMs <= 0) { router.push(`/pvp/match/${pendingMatch.matchId}`); return; }
    const id = setTimeout(() => router.push(`/pvp/match/${pendingMatch.matchId}`), delayMs);
    return () => clearTimeout(id);
  }, [pendingMatch, router]);

  const members = useMemo(() => room?.members ?? [], [room]);
  const readyCount = useMemo(() => members.filter((m) => m.ready).length, [members]);
  const memberCount = members.length;
  const hostUserId = room?.hostUserId ?? null;
  const isHost = user?.userId != null && user.userId === hostUserId;
  const minimumPlayers = room?.minPlayers ?? 2;
  const currentMember = useMemo(() => members.find((m) => m.userId === user?.userId), [members, user]);
  const isReady = currentMember?.ready ?? false;
  const canStart = isHost && status === "ready" && !pendingMatch && readyCount === memberCount && readyCount >= minimumPlayers;
  const expiresInMinutes = useMemo(() => {
    if (!room?.expiresAt) return null;
    return Math.max(0, Math.ceil((new Date(room.expiresAt).getTime() - Date.now()) / 60_000));
  }, [room?.expiresAt]);

  const leaveRoom = useCallback(() => {
    send({ type: "ROOM_LEAVE", payload: { roomCode: code } });
    router.push("/pvp/room");
  }, [send, code, router]);
  const handleKick = useCallback((userId: string) => send({ type: "ROOM_KICK", payload: { roomCode: code, userId } }), [send, code]);
  const handleRoomUpdate = useCallback((maxPlayers: number) => send({ type: "ROOM_UPDATE", payload: { roomCode: code, maxPlayers } }), [send, code]);
  const copyRoomCode = useCallback(() => {
    resumeAudio();
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = setTimeout(() => {
      setCopiedCode(false);
      copyResetTimerRef.current = null;
    }, 2000);
  }, [code, resumeAudio]);
  const sendChat = useCallback(() => {
    const text = latestChatInputRef.current.trim();
    if (!text || status !== "ready") return;
    send({ type: "LOBBY_CHAT", payload: { roomCode: code, text } });
    setChatInput("");
    latestChatInputRef.current = "";
  }, [status, send, code]);
  const handleChatInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    latestChatInputRef.current = nextValue;
    setChatInput(nextValue);
  }, []);
  const handleChatInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    sendChat();
  }, [sendChat]);
  const handleReadyClick = useCallback(() => {
    resumeAudio();
    send({ type: "READY", payload: { roomCode: code } });
  }, [code, resumeAudio, send]);
  const handleStartClick = useCallback(() => {
    resumeAudio();
    send({ type: "ROOM_START", payload: { roomCode: code } });
  }, [code, resumeAudio, send]);
  const handleRejoinClick = useCallback(() => {
    resumeAudio();
    send({ type: "ROOM_JOIN", payload: { code } });
  }, [code, resumeAudio, send]);

  return (
    <>
      <style jsx global>{`
        @keyframes countdownPulse { 0%,100% { transform: scale(1); opacity:1; } 50% { transform: scale(1.05); opacity:0.8; } }
        @keyframes borderRotate { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        .countdown-pulse { animation: countdownPulse 1s ease-in-out infinite; }
        .border-rotate { background: linear-gradient(90deg, #00d4ff, #a78bfa, #f87171, #00d4ff); background-size: 300% 100%; animation: borderRotate 4s linear infinite; }
      `}</style>

      <AnimatePresence>
        {showSettings && room && (
          <SettingsModal currentMax={room.maxPlayers} onSave={handleRoomUpdate} onClose={() => setShowSettings(false)} />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mx-auto max-w-6xl px-4 py-8 pb-28 pt-[6rem] sm:pb-8 lg:pt-[7rem]"
      >
        <HandDrawnCircle className="absolute left-4 top-20 hidden lg:block opacity-30" />
        <HandDrawnSquiggle className="absolute right-8 top-32 hidden lg:block opacity-30" />

        {/* Reconnecting / error banner */}
        {status !== "ready" && status !== "idle" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4 flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300 backdrop-blur-sm">
            <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><span>{status === "error" ? "Connection lost." : "Reconnecting…"}</span></div>
            {status === "error" && <button onClick={handleRejoinClick} className="rounded-lg bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-200 hover:bg-amber-500/30">Rejoin</button>}
          </motion.div>
        )}

        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-cyan-400">
              <Sword className="h-3 w-3" /> Private Lobby
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black tracking-tight text-white">Room {code}</h1>
              <button onClick={copyRoomCode} className="group flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-white/60 transition-all hover:border-cyan-500/50 hover:text-cyan-300">
                {copiedCode ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copiedCode ? "Copied" : "Copy Code"}
              </button>
            </div>
            <p className="mt-1 text-sm text-white/40">Share the code — everyone must ready up before the host starts.</p>
          </div>
          <div className="flex items-center gap-2">
            {isHost && (
              <button onClick={() => setShowSettings(true)} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 transition-all hover:border-white/20 hover:text-white">
                <Settings2 className="h-3.5 w-3.5" /> Settings
              </button>
            )}
            <Button onClick={leaveRoom} variant="default" size="sm" className="rounded-full gap-1.5 px-4 btn-danger">
              <LogOut className="h-3.5 w-3.5" /> Leave Room
            </Button>
          </div>
        </div>

        {/* Ambient Oracle */}
        <div className="mb-6 flex justify-center"><AmbientOracle /></div>

        {/* Status Cards (Glass) */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <GlassCard glowColor="cyan">
            <div className="p-4"><div className="flex items-center gap-3"><Users className="h-5 w-5 text-cyan-400" /><div><div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Players</div><div className="text-2xl font-bold text-white">{memberCount} / {room?.maxPlayers ?? "—"}</div><div className="text-[10px] text-emerald-400">{readyCount} ready</div></div></div></div>
          </GlassCard>
          <GlassCard glowColor="purple">
            <div className="p-4"><div className="flex items-center gap-3"><Shield className="h-5 w-5 text-purple-400" /><div><div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Status</div><div className="text-xl font-bold capitalize text-white">{room?.status ?? "Loading"}</div><div className="text-[10px] text-white/40">Socket: {status}</div></div></div></div>
          </GlassCard>
          <GlassCard glowColor="amber">
            <div className="p-4"><div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-amber-400" /><div><div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Timer</div><div className="text-xl font-bold text-white">{pendingMatch ? `${matchCountdown ?? 0}s` : `${expiresInMinutes ?? 0}m`}</div><div className="text-[10px] text-white/40">{pendingMatch ? "Match starting" : expiresInMinutes != null ? "Expires soon" : "Active"}</div></div></div></div>
          </GlassCard>
        </div>

        {/* Match Found Countdown (Premium) */}
        {pendingMatch && (
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative mb-6 overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 p-5 backdrop-blur-sm">
            <div className="border-rotate absolute inset-0 opacity-30" />
            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/20"><Zap className="h-6 w-6 animate-pulse text-cyan-400" /></div><div><div className="text-xs font-bold uppercase tracking-wider text-cyan-300">Match Found!</div><div className="text-lg font-bold text-white">Launching Arena</div><div className="text-xs text-white/50">Get ready — everyone is being teleported.</div></div></div>
              <div className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin text-cyan-400" /><span className="countdown-pulse font-mono text-4xl font-black text-white">{matchCountdown ?? 0}</span></div>
            </div>
          </motion.div>
        )}

        {/* Main content: Players + Chat */}
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Players Card */}
          <GlassCard glowColor="cyan" depth="elevated" className="overflow-hidden">
            <div className="p-5">
              <div className="mb-4 flex items-center gap-2"><Users className="h-5 w-5 text-cyan-400" /><h2 className="text-xl font-bold text-white">Players</h2><span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-normal text-white/60">{memberCount}</span></div>
              {roomLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">{MEMBER_SKELETON_KEYS.map((key) => <MemberSkeleton key={key} />)}</div>
              ) : members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center"><div className="mb-3 rounded-full bg-white/5 p-4"><Users className="h-8 w-8 text-white/20" /></div><p className="text-sm text-white/30">Waiting for players to join…</p><p className="text-xs text-white/20">Share the room code to invite friends.</p></div>
              ) : (
                <AnimatePresence mode="popLayout">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {members.map((member) => (
                      <MemberCard key={member.userId} member={member} isHost={member.userId === hostUserId} currentUserId={user?.userId} onKick={handleKick} canKick={isHost && !pendingMatch} justReady={justReadyIds.has(member.userId)} />
                    ))}
                  </div>
                </AnimatePresence>
              )}
            </div>
            {/* Action buttons inside Players card footer */}
            <div className="hidden sm:flex items-center gap-3 border-t border-white/[0.06] px-5 py-4">
              <Button
                onClick={handleReadyClick}
                disabled={status !== "ready" || !!pendingMatch}
                variant="default"
                size="lg"
                className={`flex-1 rounded-full font-semibold ${isReady ? "btn-danger" : "btn-green"}`}
              >
                {isReady ? "Cancel Ready" : "Ready"}
              </Button>
              {isHost && (
                <Button
                  onClick={handleStartClick}
                  disabled={!canStart}
                  size="lg"
                  className={`flex-1 rounded-full font-semibold ${canStart ? "btn-main" : ""}`}
                  variant={canStart ? "default" : "outline"}
                >
                  <Sword className="h-4 w-4" />
                  {readyCount < minimumPlayers ? `Need ${minimumPlayers - readyCount} more` : readyCount !== memberCount ? "Waiting for all" : "Start Match"}
                </Button>
              )}
            </div>
          </GlassCard>

          {/* Chat Card */}
          <GlassCard glowColor="purple" className="flex flex-col overflow-hidden">
            <div className="p-4 flex-1 flex flex-col">
              <div className="mb-3 flex items-center gap-2"><MessageCircle className="h-4 w-4 text-purple-400" /><h3 className="font-bold text-white">Lobby Chat</h3></div>
              <div className="max-h-[320px] min-h-[200px] flex-1 space-y-2 overflow-y-auto pr-1">
                {chatMessages.length === 0 ? <p className="py-8 text-center text-xs text-white/20">No messages yet.</p> : chatMessages.map((msg) => (
                  <div key={msg.id} className={`flex flex-col ${msg.userId === user?.userId ? "items-end" : "items-start"}`}>
                    <span className="mb-0.5 text-[9px] font-semibold text-white/40">{msg.username}</span>
                    <div className={`font-user-content max-w-[90%] rounded-xl px-3 py-1.5 text-xs text-white/90 ${msg.userId === user?.userId ? "rounded-tr-none bg-cyan-500/20" : "rounded-tl-none bg-white/10"}`}>{msg.text}</div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="mt-3 flex gap-2">
                                <input type="text" value={chatInput} onChange={handleChatInputChange} onKeyDown={handleChatInputKeyDown} maxLength={400} placeholder="Type a message…" disabled={status !== "ready"} className="font-user-content flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/20 outline-none focus:border-cyan-500/50 disabled:opacity-40" />
                <button onClick={sendChat} disabled={status !== "ready" || !chatInput.trim()} className="rounded-lg bg-cyan-500/20 p-2 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-30"><Send className="h-4 w-4" /></button>
              </div>
            </div>
          </GlassCard>
        </div>

        {error && <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300 backdrop-blur-sm">Connection issue: {error || "Please try reconnecting"}</div>}
      </motion.div>

      {/* Mobile sticky bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-white/10 bg-[#0a0f1a]/95 px-4 py-3 backdrop-blur-lg sm:hidden">
        <Button
          onClick={handleReadyClick}
          disabled={status !== "ready" || !!pendingMatch}
          variant="default"
          size="lg"
          className={`flex-1 rounded-full font-semibold ${isReady ? "btn-danger" : "btn-green"}`}
        >
          <Flag className="h-4 w-4" />
          {isReady ? "Cancel Ready" : "Ready"}
        </Button>
        {isHost && (
          <Button
            onClick={handleStartClick}
            disabled={!canStart}
            size="lg"
            variant={canStart ? "default" : "outline"}
            className={`flex-1 rounded-full font-semibold ${canStart ? "btn-main" : ""}`}
          >
            <Sword className="h-4 w-4" />Start
          </Button>
        )}
      </div>
    </>
  );
}