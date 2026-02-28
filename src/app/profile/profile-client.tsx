// src/app/api/profile/page-client.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  X,
  TrendingUp,
  Clock,
  Target,
  Award,
  BarChart3,
  TrendingUpIcon,
  Activity,
  Lock,
  Zap,
  Flame,
  Shield,
  Star,
  Trophy,
  Swords,
  Cpu,
} from "lucide-react";
import { ACHIEVEMENTS } from "@/features/level/constants/level";
import { HiOutlineMail, HiOutlineUser } from "react-icons/hi";
import { motion, LayoutGroup } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HeatmapCalendar, HeatmapDatum, HeatmapCell } from "@/components/ui/heatmap-calendar";
import { useAlert } from "@/contexts/alert-context";
import { VerifyEmailOtpDialog } from "@/components/auth/verification/verify-email-otp-dialog";
import AccountStatsChart from "./account-stats-chart";
import { DeleteAccountButton } from "./delete-account-button";
import { SignOut } from "@/components/auth/sign-out";
import { computeDailyActivityStrength } from "@/features/typing/utils/activity-strength";
import { NumberAnimation } from "@/components/core/number-animation-view";
import { StatTile } from "@/components/ui/stat-tile";
import { cn } from "@/lib/utils"; // أو أي دالة لدمج الكلاسات

type AchievementStateSlim = {
  id: string;
  unlocked: boolean;
  progress?: { current: number; target: number };
};

type ProfileData = {
  level: number;
  xp: number;
  rating: number;
  achievementsCount: number;
  achievements: AchievementStateSlim[];
  avatar: string | null;
  rank: {
    rating: number;
    tier: string;
    division: string;
    progressPct: number;
    nextAtRating: number | null;
  };
};

type UserData = {
  id: string;
  username: string;
  usernameLastChangedAt: string | null;
  email: string;
  pendingEmail: string | null;
  pendingEmailRequestedAt: string | null;
  emailVerifyOtpSentAt: string | null;
  emailVerified: string | null;
  image: string | null;
  hasPassword: boolean;
  createdAt?: string;
};

type LongTermStats = {
  totalSessions: number;
  totalTimeTyped: number;
  totalWordsTyped: number;
  totalCharactersTyped: number;
  totalMistakes: number;
  totalCorrections: number;
  averageWPM: number;
  averageAccuracy: number;
  averageConsistency: number;
  bestWPM: number;
  bestWPMDate: string | null;
  bestAccuracy: number;
  bestAccuracyDate: string | null;
  lastUpdated: string;
};

type DailyTypingActivity = {
  localDate: string;
  sessionsCount: number;
  totalTimeSpentSec: number;
  sumWpm: number;
  sumWpmTime: number;
  sumAccuracy: number;
};

type SessionHistoryEntry = {
  id: string;
  timestamp: string;
  textType?: "SHORT" | "MEDIUM" | "LONG";
  textLength: number;
  wpm?: number;
  accuracy?: number;
  consistency?: number;
  timeSpent?: number;
  mistakes?: number;
  corrections?: number;
  localDate?: string;
};

function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function getInitials(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return "U";
  return trimmed.slice(0, 2).toUpperCase();
}

function AvatarView({ url, username }: { url: string | null; username: string }) {
  if (!url) {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-slate-200">
        {getInitials(username)}
      </div>
    );
  }

  return (
    // Use <img> to avoid next/image remote config requirements
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`${username} avatar`}
      className="h-16 w-16 rounded-full border border-white/10 bg-white/5 object-cover"
      referrerPolicy="no-referrer"
      onError={(e) => {
        // If broken URL, fallback to blank (shows alt)
        (e.currentTarget as HTMLImageElement).src = "";
      }}
    />
  );
}


const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const INPUT_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AVATAR_DIMENSION = 512;
const AVATAR_QUALITY = 0.82;

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocalDateTime(value: Date): string {
  return value.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const fadeInUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4 },
};

// ── Achievement icon + colour map ────────────────────────────────────────────
type AchTier = "common" | "rare" | "epic" | "legendary" | "mythic";

const ACHIEVEMENT_META: Record<string, { icon: React.ReactNode; tier: AchTier }> = {
  velocity:        { icon: <Zap     className="w-4 h-4" />, tier: "common"    },
  consistent_edge: { icon: <Activity className="w-4 h-4" />, tier: "common"    },
  century:         { icon: <Trophy  className="w-4 h-4" />, tier: "common"    },
  speed_demon:     { icon: <Flame   className="w-4 h-4" />, tier: "rare"      },
  perfectionist:   { icon: <Shield  className="w-4 h-4" />, tier: "rare"      },
  velocity_god:    { icon: <Star    className="w-4 h-4" />, tier: "epic"      },
  the_surgeon:     { icon: <Target  className="w-4 h-4" />, tier: "epic"      },
  iron_fingers:    { icon: <Cpu     className="w-4 h-4" />, tier: "legendary" },
  ghost_protocol:  { icon: <Swords  className="w-4 h-4" />, tier: "mythic"    },
};

const TIER_STYLES: Record<AchTier, { border: string; glow: string; icon: string; bg: string; label: string; badge: string }> = {
  common:    { border: "border-cyan-400/25",    glow: "hover:border-cyan-400/55",    icon: "text-cyan-300",    bg: "bg-cyan-400/10",    label: "text-cyan-200",   badge: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"         },
  rare:      { border: "border-violet-400/25",  glow: "hover:border-violet-400/55",  icon: "text-violet-300",  bg: "bg-violet-400/10",  label: "text-violet-200", badge: "border-violet-400/30 bg-violet-400/10 text-violet-300"   },
  epic:      { border: "border-amber-400/25",   glow: "hover:border-amber-400/55",   icon: "text-amber-300",   bg: "bg-amber-400/10",   label: "text-amber-200",  badge: "border-amber-400/30 bg-amber-400/10 text-amber-300"       },
  legendary: { border: "border-rose-400/30",    glow: "hover:border-rose-400/60",    icon: "text-rose-300",    bg: "bg-rose-400/10",    label: "text-rose-200",   badge: "border-rose-400/30 bg-rose-400/10 text-rose-300"           },
  mythic:    { border: "border-fuchsia-500/40", glow: "hover:border-fuchsia-500/70", icon: "text-fuchsia-300", bg: "bg-fuchsia-500/10", label: "text-fuchsia-200", badge: "border-fuchsia-500/35 bg-fuchsia-500/15 text-fuchsia-200" },
};

const ACH_HINT: Record<string, string> = {
  velocity:        "Break 80. Speed awaits.",
  consistent_edge: "10 steady sessions. No chaos.",
  century:         "100 sessions. Dedication speaks.",
  speed_demon:     "Triple digits. 100 WPM.",
  perfectionist:   "5 flawless runs. Zero errors.",
  velocity_god:    "120 WPM. Elite tier.",
  the_surgeon:     "20 sessions, each ≥99%.",
  iron_fingers:    "100K keys pressed.",
  ghost_protocol:  "5 perfect games. No trace.",
};
/** Compact square card for the achievements grid. */
function AchCard({
  ach, state,
}: {
  ach: (typeof ACHIEVEMENTS)[number];
  state: AchievementStateSlim | undefined;
}) {
  const unlocked = state?.unlocked ?? false;
  const meta     = ACHIEVEMENT_META[ach.id];
  const tier     = (meta?.tier ?? "common") as AchTier;
  const styles   = TIER_STYLES[tier];

  // XP colour by tier
  const xpColor =
    tier === "mythic"    ? "text-fuchsia-300"
    : tier === "legendary" ? "text-rose-300"
    : tier === "epic"      ? "text-amber-300"
    : tier === "rare"      ? "text-violet-300"
    :                         "text-cyan-300";

  const hint = ACH_HINT[ach.id] ?? ach.description;

  return (
    <div
      title={`${ach.name}\n${ach.description}\n+${ach.xpReward.toLocaleString()} XP`}
      className={[
        "relative aspect-square flex flex-col justify-between rounded-xl border p-3 transition-all duration-200 cursor-default select-none",
        unlocked
          ? `${styles.border} ${styles.glow} bg-[rgba(10,15,35,0.65)] backdrop-blur-sm`
          : "border-white/6 bg-[rgba(10,15,35,0.3)] opacity-50 grayscale-[35%]",
      ].join(" ")}
    >
      {/* Top section */}
      <div className="flex flex-col gap-2">
        {/* Icon + XP row */}
        <div className="flex items-center justify-between">
          <div
            className={[
              "flex items-center justify-center w-9 h-9 rounded-lg shrink-0",
              unlocked ? `${styles.bg} ${styles.icon}` : "bg-white/5 text-white/25",
            ].join(" ")}
          >
            {unlocked ? (meta?.icon ?? <Award className="w-4 h-4" />) : <Lock className="w-3.5 h-3.5" />}
          </div>
          <span className={["text-[11px] font-bold font-mono", unlocked ? xpColor : "text-white/18"].join(" ")}>
            +{ach.xpReward.toLocaleString()}
          </span>
        </div>

        {/* Name */}
        <p className={[
          "text-[11px] font-bold leading-tight truncate font-mono",
          unlocked ? styles.label : "text-white/30",
        ].join(" ")}>
          {ach.name}
        </p>
      </div>

      {/* Bottom section */}
      <div className="flex flex-col gap-1.5">
        {/* Tier badge */}
        <div className="h-4">
          {unlocked && (
            <span
              className={[
                "inline-block text-[8px] font-bold uppercase tracking-widest rounded-full px-1.5 py-0.5 border font-mono",
                styles.badge,
              ].join(" ")}
            >
              {tier}
            </span>
          )}
        </div>

        {/* Hint */}
        <p className="text-[9px] text-white/50 leading-snug line-clamp-2 font-mono">
          {hint}
        </p>
      </div>
    </div>
  );
}

function AchievementsPanel({ achievements }: { achievements: AchievementStateSlim[] }) {
  const stateMap     = new Map(achievements.map((a) => [a.id, a]));
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 px-0.5">
        <Trophy className="w-4 h-4 text-amber-300 shrink-0" />
        <span className="text-sm font-semibold text-[#E0E7FF] uppercase tracking-wider">Achievements</span>
        <span className="ml-auto text-xs text-[#8A8FB5] font-mono">
          {unlockedCount} / {ACHIEVEMENTS.length}
        </span>
      </div>

      {/* Responsive grid: 3 columns - equal square cards */}
      <div className="grid grid-cols-3 gap-3">
        {ACHIEVEMENTS.map((ach) => (
          <AchCard key={ach.id} ach={ach} state={stateMap.get(ach.id)} />
        ))}
      </div>
    </div>
  );
}


const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

export default function ProfileClient(props: {
  user: UserData;
  profile: ProfileData;
  stats: LongTermStats;
  dailyActivity: DailyTypingActivity[];
  sessionHistory: SessionHistoryEntry[];
}) {
  const router = useRouter();
  const { showAlert } = useAlert();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const usernameInputRef = useRef<HTMLInputElement | null>(null);

  const avatarUrl = props.profile.avatar ?? props.user.image;

  const [username, setUsername] = useState(props.user.username);
  const [editingUsername, setEditingUsername] = useState(false);

  const [emailDraft, setEmailDraft] = useState(props.user.email);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");

  const [editingPassword, setEditingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  const passwordCurrentValueRef = useRef("");
  const newPasswordValueRef = useRef("");
  const confirmNewPasswordValueRef = useRef("");
  const passwordCurrentInputRef = useRef<HTMLInputElement | null>(null);
  const newPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const confirmNewPasswordInputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState<null | "username" | "avatar" | "email" | "password">(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    setUsername(props.user.username);
  }, [props.user.username]);

  useEffect(() => {
    if (editingEmail) return;
    setEmailDraft(props.user.email);
  }, [props.user.email, editingEmail]);

  useEffect(() => {
    if (!editingUsername) return;
    usernameInputRef.current?.focus();
  }, [editingUsername]);

  const usernameIsDirty = useMemo(() => {
    return username.trim().toLowerCase() !== props.user.username.trim().toLowerCase();
  }, [username, props.user.username]);

  const emailIsDirty = useMemo(() => {
    return emailDraft.trim().toLowerCase() !== props.user.email.trim().toLowerCase();
  }, [emailDraft, props.user.email]);

  const isEmailVerified = !!props.user.emailVerified;
  const emailVerifiedAt = useMemo(() => safeDate(props.user.emailVerified), [props.user.emailVerified]);

  const hasPendingEmail = !!props.user.pendingEmail;
  const otpDestinationEmail = (props.user.pendingEmail ?? props.user.email).trim();
  const otpInitialSentAt = props.user.emailVerifyOtpSentAt;

  const otpDialogOpenedForChangeRef = useRef(false);
  const otpDialogJustVerifiedRef = useRef(false);

  const handleOtpVerified = useCallback(() => {
    otpDialogJustVerifiedRef.current = true;
    router.refresh();
  }, [router]);

  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpDialogDestinationEmail, setOtpDialogDestinationEmail] = useState(otpDestinationEmail);
  const [otpDialogInitialSentAt, setOtpDialogInitialSentAt] = useState<string | null>(otpInitialSentAt);

  useEffect(() => {
    setOtpDialogDestinationEmail(otpDestinationEmail);
    setOtpDialogInitialSentAt(otpInitialSentAt);
  }, [otpDestinationEmail, otpInitialSentAt]);

async function cancelEmailChangeRequest() {
    try {
      await patchUser({
        // PATCHing the current email triggers cancelPendingEmail server-side.
        email: props.user.email.trim().toLowerCase(),
      });
      showAlert("Email change canceled.", "warning", { durationMs: 5000 });
    } catch {
      // Keep it quiet; worst case the server kept the request.
    } finally {
      router.refresh();
    }
  }

  const handleOtpDialogOpenChange = useCallback(
    async (open: boolean) => {
      setOtpDialogOpen(open);

      if (!open) {
        const shouldCancel =
          otpDialogOpenedForChangeRef.current && !otpDialogJustVerifiedRef.current;

        otpDialogOpenedForChangeRef.current = false;
        otpDialogJustVerifiedRef.current = false;

        if (shouldCancel) {
          await cancelEmailChangeRequest();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.user.email, router, showAlert]
  );

  const bestWpmAt = useMemo(() => safeDate(props.stats.bestWPMDate), [props.stats.bestWPMDate]);
  const bestAccuracyAt = useMemo(() => safeDate(props.stats.bestAccuracyDate), [props.stats.bestAccuracyDate]);
  const lastUpdatedAt = useMemo(() => safeDate(props.stats.lastUpdated), [props.stats.lastUpdated]);

  const heatmapRange = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const end = new Date(year, 11, 31);
    end.setHours(0, 0, 0, 0);
    const start = new Date(year, 0, 1);
    start.setHours(0, 0, 0, 0);
    const rangeDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    return { endDate: end, rangeDays };
  }, []);

  const heatmapData: HeatmapDatum[] = useMemo(() => {
    const toStrengthDatum = (args: {
      date: string;
      totalMinutes: number;
      sessionsCount: number;
      avgWpm: number;
      avgAccuracy: number;
    }): HeatmapDatum => {
      const strength = computeDailyActivityStrength({
        totalMinutes: args.totalMinutes,
        sessionsCount: args.sessionsCount,
        avgWpm: args.avgWpm,
        avgAccuracy: args.avgAccuracy,
      });

      return {
        date: args.date,
        // Normalized stable strength (0..100) so small values are still visible.
        value: strength.strength100,
        meta: {
          sessionsCount: args.sessionsCount,
          totalMinutes: args.totalMinutes,
          avgWpm: args.avgWpm,
          avgAccuracy: args.avgAccuracy,
          strength100: strength.strength100,
          rawStrengthScore: strength.rawScore,
        },
      };
    };

    return (props.dailyActivity ?? []).map((row) => {
      const totalMinutes = row.totalTimeSpentSec > 0 ? row.totalTimeSpentSec / 60 : 0;
      const sessionsCount = Math.max(0, row.sessionsCount);
      const hasTimeWeightedWpm = row.totalTimeSpentSec > 0 && row.sumWpmTime > 0;
      const avgWpm = hasTimeWeightedWpm
        ? row.sumWpmTime / row.totalTimeSpentSec
        : sessionsCount > 0
          ? row.sumWpm / sessionsCount
          : 0;
      const avgAccuracy = sessionsCount > 0 ? row.sumAccuracy / sessionsCount : 0;

      return toStrengthDatum({
        date: row.localDate,
        totalMinutes,
        sessionsCount,
        avgWpm,
        avgAccuracy,
      });
    });
  }, [props.dailyActivity]);

  const renderHeatmapTooltip = useCallback((cell: HeatmapCell) => {
    if (cell.disabled) return "Outside range";

    const meta = (cell.meta ?? null) as null | {
      sessionsCount: number;
      totalMinutes: number;
      avgWpm: number;
      avgAccuracy: number;
      strength100?: number;
    };

    if (!meta) return null;
    if (meta?.sessionsCount === 0) return null;

    const sessionsLabel = meta.sessionsCount === 1 ? "session" : "sessions";
    const minutesRounded = Math.round(meta.totalMinutes);
    const strengthRounded = Math.round(typeof meta.strength100 === "number" ? meta.strength100 : cell.value);

    return (
      <div className="text-sm font-mono">
        <div className="font-medium">Strength {strengthRounded}/100</div>
        <div className="text-muted-foreground">
          {meta.sessionsCount} {sessionsLabel} · {minutesRounded}m · Avg {Math.round(meta.avgWpm)} WPM · {Math.round(meta.avgAccuracy)}%
        </div>
        <div className="text-muted-foreground">{cell.label}</div>
      </div>
    );
  }, []);

  const accountStatsChartSection = useMemo(
    () => (
      <motion.div variants={fadeInUp}>
        <AccountStatsChart
          stats={props.stats}
          dailyActivity={props.dailyActivity}
          sessionHistory={props.sessionHistory}
        />
      </motion.div>
    ),
    [props.dailyActivity, props.sessionHistory, props.stats]
  );

  const heatmapSection = useMemo(
    () => (
      <motion.div variants={fadeInUp}>
        <HeatmapCalendar
          title="Activity"
          data={heatmapData}
          rangeDays={heatmapRange.rangeDays}
          endDate={heatmapRange.endDate}
          className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all"
          responsive
          cellSize={22}
          cellGap={4}
          levelStrategy="fixedThresholds"
          fixedThresholds={[10, 25, 45, 70]}
          palette={[
            "rgba(255, 255, 255, 0.06)",
            "rgba(120, 200, 255, 0.22)",
            "rgba(120, 200, 255, 0.42)",
            "rgba(120, 200, 255, 0.68)",
            "rgba(120, 200, 255, 0.96)",
          ]}
          axisLabels={{
            show: true,
            showWeekdays: true,
            showMonths: true,
            weekdayIndices: [0, 1, 2, 3, 4, 5, 6],
            monthFormat: "short",
            minWeekSpacing: 1,
          }}
          renderTooltip={renderHeatmapTooltip}
          legend={{
            showText: true,
            showArrow: true,
            lessText: "Low strength",
            moreText: "High strength",
            placement: "bottom",
            direction: "row",
            swatchSize: 10,
            swatchGap: 3,
          }}
        />
      </motion.div>
    ),
    [
      heatmapData,
      heatmapRange.endDate,
      heatmapRange.rangeDays,
      renderHeatmapTooltip,
    ]
  );

  async function patchUser(body: unknown) {
    const res = await fetch("/api/user", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const data: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const msg =
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error: unknown }).error)
          : "Failed to update";
      throw new Error(msg);
    }

    return data;
  }

  async function onSaveEmail() {
    if (busy !== null) return;

    const next = emailDraft.trim().toLowerCase();
    if (!next) {
      showAlert("Please enter an email address", "error");
      return;
    }

    setBusy("email");
    try {
      const result = (await patchUser({
        email: next,
        ...(emailIsDirty && props.user.hasPassword ? { currentPassword: emailCurrentPassword } : {}),
      })) as {
        emailChange?: {
          requested: string;
          sent: boolean;
          retryAfterSeconds?: number;
        };
      };

      const retryAfterSeconds = result.emailChange?.retryAfterSeconds;
      const sent = result.emailChange?.sent;

      if (emailIsDirty && result.emailChange?.requested) {
        setOtpDialogDestinationEmail(result.emailChange.requested);
        if (sent) {
          setOtpDialogInitialSentAt(new Date().toISOString());
        }
        otpDialogOpenedForChangeRef.current = true;
        setOtpDialogOpen(true);
      }

      if (!emailIsDirty) {
        setOtpDialogOpen(false);
      }

      if (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
        showAlert(`Please wait ${retryAfterSeconds}s before requesting a new code.`, "warning", {
          durationMs: 5000,
        });
      } else if (!emailIsDirty) {
        showAlert("Saved. Any in-progress email change was canceled.", "warning", {
          durationMs: 8000,
        });
      }
      setEditingEmail(false);
      setEmailCurrentPassword("");
      // Refresh to pick up pending state and OTP timestamps.
      router.refresh();
    } catch (e) {
      showAlert(e instanceof Error ? e.message : "Failed to update email", "error");
    } finally {
      setBusy(null);
    }
  }

  function startEmailEdit() {
    setEmailDraft(props.user.email);
    setEditingEmail(true);
  }

  function cancelEmailEdit() {
    setEmailDraft(props.user.email);
    setEmailCurrentPassword("");
    setEditingEmail(false);
  }

  function startPasswordEdit() {
    passwordCurrentValueRef.current = "";
    newPasswordValueRef.current = "";
    confirmNewPasswordValueRef.current = "";
    if (passwordCurrentInputRef.current) passwordCurrentInputRef.current.value = "";
    if (newPasswordInputRef.current) newPasswordInputRef.current.value = "";
    if (confirmNewPasswordInputRef.current) confirmNewPasswordInputRef.current.value = "";
    setEditingPassword(true);
  }

  function cancelPasswordEdit() {
    setEditingPassword(false);
    passwordCurrentValueRef.current = "";
    newPasswordValueRef.current = "";
    confirmNewPasswordValueRef.current = "";
    if (passwordCurrentInputRef.current) passwordCurrentInputRef.current.value = "";
    if (newPasswordInputRef.current) newPasswordInputRef.current.value = "";
    if (confirmNewPasswordInputRef.current) confirmNewPasswordInputRef.current.value = "";
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  }

  async function onSavePassword() {
    if (busy !== null) return;

    const { current: next } = newPasswordValueRef;
    const { current: confirm } = confirmNewPasswordValueRef;
    const { current: currentPassword } = passwordCurrentValueRef;
    if (next.trim().length < 8) {
      showAlert("Password must be at least 8 characters", "error");
      return;
    }

    if (!/[A-Z]/.test(next)) {
      showAlert("Password must contain at least one uppercase letter", "error");
      return;
    }

    if (!/\d/.test(next)) {
      showAlert("Password must contain at least one number", "error");
      return;
    }

    if (next !== confirm) {
      showAlert("Passwords do not match", "error");
      return;
    }

    if (props.user.hasPassword && !currentPassword) {
      showAlert("Please enter your current password", "error");
      return;
    }

    setBusy("password");
    try {
      const res = await fetch("/api/user/password", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(props.user.hasPassword ? { currentPassword: currentPassword } : {}),
          newPassword: next,
        }),
      });

      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "Failed to update password";
        throw new Error(msg);
      }

      showAlert(props.user.hasPassword ? "Password updated successfully" : "Password set successfully", "success");
      cancelPasswordEdit();
      router.refresh();
    } catch (e) {
      showAlert(e instanceof Error ? e.message : "Failed to update password", "error");
    } finally {
      setBusy(null);
    }
  }

  async function uploadAvatar(file: File) {
    if (!ALLOWED_INPUT_TYPES.has(file.type)) {
      throw new Error("Unsupported image type");
    }
    if (file.size <= 0 || file.size > INPUT_MAX_BYTES) {
      throw new Error("Image file too large");
    }

    const optimized = await compressAvatarForUpload(file);
    if (optimized.blob.size <= 0 || optimized.blob.size > MAX_AVATAR_BYTES) {
      throw new Error("Avatar is too large after compression");
    }

    const uploadFile = new File([optimized.blob], optimized.filename, { type: optimized.contentType });
    const form = new FormData();
    form.append("file", uploadFile);

    const res = await fetch("/api/user/avatar", {
      method: "POST",
      body: form,
    });

    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error: unknown }).error)
          : "Failed to upload avatar";
      throw new Error(msg);
    }

    // Server already updates DB; keep router.refresh for UI consistency.
    return data;
  }

  function getFriendlyAvatarError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("unsupported image type")) {
      return "Unsupported image type. Please choose a JPG, PNG, WEBP, or GIF image.";
    }
    if (msg.toLowerCase().includes("image file too large")) {
      return "Image is too large. Please choose a smaller file (max 10MB).";
    }
    if (msg.toLowerCase().includes("too large after compression") || msg.toLowerCase().includes("avatar file too large")) {
      return "Avatar is too large. Please choose a smaller image.";
    }
    if (msg.toLowerCase().includes("invalid image") || msg.toLowerCase().includes("image processing failed")) {
      return "That file could not be processed as an image. Please try a different one.";
    }
    return msg || "Failed to upload avatar";
  }

  async function compressAvatarForUpload(
    file: File
  ): Promise<{ blob: Blob; contentType: "image/webp" | "image/jpeg"; filename: string }> {
    const bitmap = await (async () => {
      if (typeof createImageBitmap === "function") {
        try {
          return await createImageBitmap(file);
        } catch {
          return null;
        }
      }
      return null;
    })();

    if (bitmap) {
      const side = Math.min(bitmap.width, bitmap.height);
      const sx = Math.floor((bitmap.width - side) / 2);
      const sy = Math.floor((bitmap.height - side) / 2);

      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_DIMENSION;
      canvas.height = AVATAR_DIMENSION;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image processing failed");

      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_DIMENSION, AVATAR_DIMENSION);
      bitmap.close?.();

      const webp = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", AVATAR_QUALITY)
      );
      if (webp) return { blob: webp, contentType: "image/webp", filename: "avatar.webp" };

      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", AVATAR_QUALITY)
      );
      if (!jpeg) throw new Error("Image processing failed");
      return { blob: jpeg, contentType: "image/jpeg", filename: "avatar.jpg" };
    }

    // Fallback: <img> + canvas
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Invalid image"));
        el.src = url;
      });

      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = Math.floor((img.naturalWidth - side) / 2);
      const sy = Math.floor((img.naturalHeight - side) / 2);

      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_DIMENSION;
      canvas.height = AVATAR_DIMENSION;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image processing failed");
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_DIMENSION, AVATAR_DIMENSION);

      const webp = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", AVATAR_QUALITY)
      );
      if (webp) return { blob: webp, contentType: "image/webp", filename: "avatar.webp" };

      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", AVATAR_QUALITY)
      );
      if (!jpeg) throw new Error("Image processing failed");
      return { blob: jpeg, contentType: "image/jpeg", filename: "avatar.jpg" };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function onSaveUsername() {
    setBusy("username");

    try {
      const next = username.trim();
      await patchUser({ username: next });
      showAlert("Username updated", "success");
      setEditingUsername(false);
      router.refresh();
    } catch (e) {
      showAlert(e instanceof Error ? e.message : "Failed to update username", "error");
    } finally {
      setBusy(null);
    }
  }

  function startUsernameEdit() {
    setUsername(props.user.username);
    setEditingUsername(true);
  }

  function cancelUsernameEdit() {
    setUsername(props.user.username);
    setEditingUsername(false);
  }

  async function onPickAvatarFile(file: File) {
    setBusy("avatar");
    setAvatarError(null);

    try {
      await uploadAvatar(file);
      setAvatarError(null);
      showAlert("Avatar updated", "success");
      router.refresh();
    } catch (e) {
      const friendly = getFriendlyAvatarError(e);
      setAvatarError(friendly);
      showAlert(friendly, "error");
    } finally {
      setBusy(null);
    }
  }

  const canSaveUsername = busy === null && username.trim().length >= 3 && usernameIsDirty;
  const canStartUsernameEdit = busy === null;

  return (
    <LayoutGroup>
      <motion.div
        className="space-y-6"
        initial="initial"
        animate="animate"
        variants={staggerContainer}
      >
        {/* Profile Card */}
        <motion.div variants={fadeInUp}>
          <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl overflow-hidden hover:border-[rgba(160,220,255,0.3)] transition-all">
            <LayoutGroup>
              {/* Two-column grid: Left (header + fields) | Right (achievements) on xl */}
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_480px]">
                {/* Left column */}
                <div>
                  <CardHeader className="pb-4"> {/* pb-2 -> pb-4 */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6"> {/* sm:flex-row -> lg:flex-row, gap-4 -> gap-6 */}
                  <div className="flex flex-wrap items-center gap-5"> {/* gap-4 -> gap-5 */}
                    {/* Avatar */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, delay: 0.1 }}
                      className="relative"
                    >
                      <div
                        className={
                          "rounded-full ring-2 ring-offset-2 ring-offset-slate-950 transition-all duration-300 " +
                          (avatarError
                            ? "ring-red-500/50"
                            : "ring-[rgba(160,220,255,0.3)] hover:ring-[rgba(160,220,255,0.6)]")
                        }
                      >
                        <AvatarView url={avatarUrl} username={props.user.username} />
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy !== null}
                        aria-label="Change avatar"
                        className="absolute bottom-0 left-0 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.8)] text-cyan-300 shadow-sm backdrop-blur transition-all hover:border-[rgba(160,220,255,0.6)] hover:text-cyan-200 disabled:opacity-60"
                      >
                        {busy === "avatar" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Camera className="h-4 w-4" />
                        )}
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.currentTarget.value = "";
                          if (!file) return;
                          await onPickAvatarFile(file);
                        }}
                      />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 }}
                      className="min-w-0"
                    >
                      <CardTitle className="text-xl text-[#E0E7FF]">
                        {props.user.username}
                      </CardTitle>
                      <CardDescription className="text-[#8A8FB5] flex items-center gap-1">
                        <HiOutlineMail className="w-3 h-3" />
                        <span className="truncate max-w-[200px]">{props.user.email}</span>
                      </CardDescription>
                    </motion.div>

                    {/* Level & Rank */}
                    <div className="flex flex-wrap gap-4"> {/* flex gap-3 -> flex-wrap gap-4 */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="text-center px-4 py-2"
                      >
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <TrendingUpIcon className="w-4 h-4 text-cyan-300" />
                          <p className="text-xs text-[rgba(200,240,255,0.8)] uppercase tracking-wider">Level</p>
                        </div>
                        <p className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400 font-mono">
                          <NumberAnimation value={props.profile.level} delay={0.4} />
                        </p>
                      </motion.div>

                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                        className="text-center px-4 py-2"
                      >
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <Target className="w-4 h-4 text-cyan-300" />
                          <p className="text-xs text-[rgba(200,240,255,0.8)] uppercase tracking-wider">Rank</p>
                        </div>
                        <p className="text-sm font-semibold text-[#E0E7FF] leading-tight">
                          {props.profile.rank.tier} {props.profile.rank.division}
                        </p>
                      </motion.div>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-6"> {/* pt-4 -> pt-6 */}
                  {/* Account settings */}
                  <div className="space-y-8"> {/* space-y-6 -> space-y-8 */}

                    {/* Email Section */}
                    <div className="space-y-3"> {/* space-y-2 -> space-y-3 */}
                      <Label className="text-[#E0E7FF] flex items-center gap-2" htmlFor="email">
                        <HiOutlineMail className="w-4 h-4 text-cyan-300" />
                        Email
                      </Label>

                      {!editingEmail ? (
                        <div className="flex flex-col gap-3 rounded-xl border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] px-5 py-4 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.3)]"> {/* px-4 py-3 -> px-5 py-4 */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-[#E0E7FF] sm:text-base">
                                {props.user.email}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2"> {/* mt-1 -> mt-2 */}
                                <span
                                  className={
                                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium " + /* px-2.5 -> px-3 */
                                    (isEmailVerified
                                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                                      : "border-orange-400/20 bg-orange-500/10 text-orange-100")
                                  }
                                >
                                  <span
                                    className={
                                      "inline-flex h-5 w-5 items-center justify-center rounded-full " +
                                      (isEmailVerified
                                        ? "bg-emerald-500/15 text-emerald-200"
                                        : "bg-gradient-to-r from-orange-400 to-yellow-300 text-slate-950")
                                    }
                                    aria-hidden="true"
                                  >
                                    {isEmailVerified ? (
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                    ) : (
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                    )}
                                  </span>
                                  <span>{isEmailVerified ? "Verified" : "Not verified"}</span>
                                </span>

                                {isEmailVerified && emailVerifiedAt ? (
                                  <span className="text-[11px] text-[#8A8FB5]">
                                    Verified {formatLocalDateTime(emailVerifiedAt)}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <Button
                              type="button"
                              onClick={startEmailEdit}
                              disabled={busy !== null}
                              variant="outline"
                              size="sm"
                              className="border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.5)] text-cyan-300 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.6)] hover:bg-[rgba(20,50,80,0.8)]"
                            >
                              Change
                            </Button>
                          </div>

                          {(!isEmailVerified || hasPendingEmail) && (
                            <div className="pt-2 space-y-2"> {/* pt-1 -> pt-2 */}
                              <p className="text-xs text-[#8A8FB5]">
                                Verification helps protect your account and enables secure email changes.
                              </p>
                            </div>
                          )}

                          <VerifyEmailOtpDialog
                            open={otpDialogOpen}
                            onOpenChange={handleOtpDialogOpenChange}
                            destinationEmail={otpDialogDestinationEmail}
                            initialSentAt={otpDialogInitialSentAt}
                            onVerified={handleOtpVerified}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4 rounded-xl border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] p-5 backdrop-blur-sm"> {/* p-4 -> p-5 */}
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center"> {/* gap-2 -> gap-3 */}
                            <Input
                              id="email"
                              value={emailDraft}
                              onChange={(e) => setEmailDraft(e.target.value)}
                              placeholder="name@example.com"
                              autoComplete="email"
                              className="flex-1 border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.3)] text-[#E0E7FF] placeholder:text-[#8A8FB5] focus:border-[rgba(160,220,255,0.6)] backdrop-blur-sm"
                            />
                            <div className="flex gap-2 sm:flex-none">
                              <Button
                                type="button"
                                onClick={onSaveEmail}
                                disabled={busy !== null || (!emailIsDirty && !hasPendingEmail)}
                                size="sm"
                                className="border-[rgba(160,220,255,0.5)] bg-[rgba(20,50,80,0.5)] text-cyan-300 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.8)] hover:bg-[rgba(20,50,80,0.8)]"
                              >
                                {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                                {busy === "email" ? "Saving…" : "Save"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={cancelEmailEdit}
                                disabled={busy !== null}
                                size="sm"
                                className="border-red-400/50 bg-transparent text-red-300 backdrop-blur-sm transition-all hover:border-red-400 hover:bg-red-500/20"
                              >
                                <X className="h-4 w-4 mr-1" />
                                Cancel
                              </Button>
                            </div>
                          </div>

                          {props.user.hasPassword && (
                            <div className="space-y-3"> {/* space-y-2 -> space-y-3 */}
                              <Label className="text-[#E0E7FF]" htmlFor="currentPassword">
                                Current password
                              </Label>
                              <Input
                                id="currentPassword"
                                type="password"
                                value={emailCurrentPassword}
                                onChange={(e) => setEmailCurrentPassword(e.target.value)}
                                autoComplete="current-password"
                                placeholder="Required for email changes"
                                className="border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.3)] text-[#E0E7FF] placeholder:text-[#8A8FB5] focus:border-[rgba(160,220,255,0.6)] backdrop-blur-sm"
                              />
                              <p className="text-xs text-[#8A8FB5]">
                                For security, we require your password before changing the email on password-based accounts.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Username Section */}
                    <div className="space-y-3">
                      <Label className="text-[#E0E7FF] flex items-center gap-2" htmlFor="username">
                        <HiOutlineUser className="w-4 h-4 text-cyan-300" />
                        Username
                      </Label>
                      {!editingUsername ? (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] px-5 py-4 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.3)]">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[#E0E7FF] sm:text-lg">
                              {props.user.username}
                            </div>
                            <div className="text-xs text-[#8A8FB5] mt-1">Click edit to change your username</div>
                          </div>
                          <Button
                            type="button"
                            onClick={startUsernameEdit}
                            disabled={!canStartUsernameEdit}
                            variant="outline"
                            size="icon"
                            aria-label="Edit username"
                            className="rounded-full border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.5)] text-cyan-300 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.6)] hover:bg-[rgba(20,50,80,0.8)]"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 rounded-xl border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] p-5 backdrop-blur-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <Input
                              ref={usernameInputRef}
                              id="username"
                              value={username}
                              onChange={(e) => setUsername(e.target.value)}
                              placeholder="your_username"
                              autoComplete="username"
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && canSaveUsername) void onSaveUsername();
                                if (e.key === "Escape") cancelUsernameEdit();
                              }}
                              className="flex-1 border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.3)] text-[#E0E7FF] placeholder:text-[#8A8FB5] focus:border-[rgba(160,220,255,0.6)] backdrop-blur-sm"
                            />
                            <div className="flex gap-2 sm:flex-none">
                              <Button
                                type="button"
                                onClick={onSaveUsername}
                                disabled={!canSaveUsername}
                                size="sm"
                                className="border-[rgba(160,220,255,0.5)] bg-[rgba(20,50,80,0.5)] text-cyan-300 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.8)] hover:bg-[rgba(20,50,80,0.8)]"
                              >
                                {busy === "username" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                                {busy === "username" ? "Saving…" : "Save"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={cancelUsernameEdit}
                                disabled={busy !== null}
                                size="sm"
                                className="border-red-400/50 bg-transparent text-red-300 backdrop-blur-sm transition-all hover:border-red-400 hover:bg-red-500/20"
                              >
                                <X className="h-4 w-4 mr-1" />
                                Cancel
                              </Button>
                            </div>
                          </div>
                          <p className="text-xs text-[#8A8FB5]">
                            Letters, numbers, underscore. 3–20 chars. Press Enter to save, Esc to cancel.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Password Section */}
                    <div className="space-y-3">
                      <Label className="text-[#E0E7FF] flex items-center gap-2" htmlFor="newPassword">
                        <KeyRound className="w-4 h-4 text-cyan-300" />
                        Password
                      </Label>

                      {!editingPassword ? (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] px-5 py-4 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.3)]">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[#E0E7FF] sm:text-lg">
                              {props.user.hasPassword ? "••••••••" : "No password set"}
                            </div>
                            <div className="text-xs text-[#8A8FB5] mt-1"> {/* added mt-1 */}
                              {props.user.hasPassword
                                ? "Change your password to keep your account secure"
                                : "Set a password to enable password-based sign-in"}
                            </div>
                          </div>
                          <Button
                            type="button"
                            onClick={startPasswordEdit}
                            disabled={busy !== null}
                            variant="outline"
                            size="icon"
                            aria-label={props.user.hasPassword ? "Change password" : "Set password"}
                            className="rounded-full border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.5)] text-cyan-300 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.6)] hover:bg-[rgba(20,50,80,0.8)]"
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4 rounded-xl border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] p-5 backdrop-blur-sm">
                          {props.user.hasPassword && (
                            <div className="space-y-3">
                              <Label className="text-[#E0E7FF]" htmlFor="passwordCurrent">
                                Current password
                              </Label>
                              <div className="relative">
                                <Input
                                  ref={passwordCurrentInputRef}
                                  id="passwordCurrent"
                                  type={showCurrentPassword ? "text" : "password"}
                                  onChange={(e) => {
                                    passwordCurrentValueRef.current = e.target.value;
                                  }}
                                  autoComplete="current-password"
                                  placeholder="Enter current password"
                                  className="border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.3)] pr-10 text-[#E0E7FF] placeholder:text-[#8A8FB5] focus:border-[rgba(160,220,255,0.6)] backdrop-blur-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowCurrentPassword((v) => !v)}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8FB5] transition-colors hover:text-cyan-300"
                                  aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
                                >
                                  {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="space-y-3">
                            <Label className="text-[#E0E7FF]" htmlFor="newPassword">
                              New password
                            </Label>
                            <div className="relative">
                              <Input
                                ref={newPasswordInputRef}
                                id="newPassword"
                                type={showNewPassword ? "text" : "password"}
                                onChange={(e) => {
                                  newPasswordValueRef.current = e.target.value;
                                }}
                                autoComplete="new-password"
                                placeholder="••••••••"
                                className="border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.3)] pr-10 text-[#E0E7FF] placeholder:text-[#8A8FB5] focus:border-[rgba(160,220,255,0.6)] backdrop-blur-sm"
                              />
                              <button
                                type="button"
                                onClick={() => setShowNewPassword((v) => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8FB5] transition-colors hover:text-cyan-300"
                                aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                              >
                                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <Label className="text-[#E0E7FF]" htmlFor="confirmNewPassword">
                              Confirm new password
                            </Label>
                            <div className="relative">
                              <Input
                                ref={confirmNewPasswordInputRef}
                                id="confirmNewPassword"
                                type={showConfirmNewPassword ? "text" : "password"}
                                onChange={(e) => {
                                  confirmNewPasswordValueRef.current = e.target.value;
                                }}
                                autoComplete="new-password"
                                placeholder="••••••••"
                                className="border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.3)] pr-10 text-[#E0E7FF] placeholder:text-[#8A8FB5] focus:border-[rgba(160,220,255,0.6)] backdrop-blur-sm"
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirmNewPassword((v) => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A8FB5] transition-colors hover:text-cyan-300"
                                aria-label={showConfirmNewPassword ? "Hide confirm password" : "Show confirm password"}
                              >
                                {showConfirmNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end pt-3"> {/* pt-2 -> pt-3 */}
                            <Button
                              type="button"
                              onClick={onSavePassword}
                              disabled={busy !== null}
                              size="sm"
                              className="border-[rgba(160,220,255,0.5)] bg-[rgba(20,50,80,0.5)] text-cyan-300 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.8)] hover:bg-[rgba(20,50,80,0.8)]"
                            >
                              {busy === "password" ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                              {busy === "password" ? "Saving…" : props.user.hasPassword ? "Update password" : "Set password"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={cancelPasswordEdit}
                              disabled={busy !== null}
                              size="sm"
                              className="border-red-400/50 bg-transparent text-red-300 backdrop-blur-sm transition-all hover:border-red-400 hover:bg-red-500/20"
                            >
                              <X className="h-4 w-4 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>{/* end password section */}
                  </div>{/* end account settings */}
              </CardContent>
                </div>{/* end left column */}

                {/* ── Right column: Achievements (at card level on xl) ──────────── */}
                <div className="hidden xl:block p-6 pt-20">
                  <AchievementsPanel achievements={props.profile.achievements} />
                </div>
              </div>{/* end outer grid */}

              {/* Achievements for smaller screens - below fields */}
              <div className="xl:hidden px-6 pb-6">
                <AchievementsPanel achievements={props.profile.achievements} />
              </div>
            </LayoutGroup>
          </Card>
        </motion.div>

        {/* AccountStatsChart */}
        {accountStatsChartSection}

        {/* Heatmap Calendar */}
        {heatmapSection}

        {/* Statistics Card (Improved Layout) */}
        <motion.div variants={fadeInUp}>
          <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all">
            <CardHeader>
              <CardTitle className="text-[#E0E7FF]">Statistics</CardTitle>
              <CardDescription className="text-[#8A8FB5]">
                Your typing performance analysis over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Performance Highlights */}
              <div className="mb-6">
                <h4 className="text-sm font-medium bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400 mb-3">
                  Performance Highlights
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  <StatTile
                    label="Best WPM"
                    value={
                      <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent font-meno">
                        <NumberAnimation value={Math.round(props.stats.bestWPM)} unit=" WPM" delay={0.3} />
                      </span>
                    }
                    subValue={bestWpmAt ? formatLocalDateTime(bestWpmAt) : "—"}
                    icon={<TrendingUp className="h-4 w-4 text-cyan-300" />}
                  />
                  <StatTile
                    label="Best accuracy"
                    value={
                      <span className="bg-gradient-to-r from-green-300 to-teal-400 bg-clip-text text-transparent font-mono">
                        <NumberAnimation value={Math.round(props.stats.bestAccuracy)} unit="%" delay={0.4} />
                      </span>
                    }
                    subValue={bestAccuracyAt ? formatLocalDateTime(bestAccuracyAt) : "—"}
                    icon={<Target className="h-4 w-4 text-green-300" />}
                  />
                  <StatTile
                    label="Avg WPM"
                    value={<NumberAnimation value={Math.round(props.stats.averageWPM)} unit=" WPM" delay={0.5} />}
                    icon={<TrendingUp className="h-4 w-4 text-cyan-300" />}
                  />
                  <StatTile
                    label="Avg accuracy"
                    value={<NumberAnimation value={Math.round(props.stats.averageAccuracy)} unit="%" delay={0.6} />}
                    icon={<Target className="h-4 w-4 text-green-300" />}
                  />
                  <StatTile
                    label="Avg consistency"
                    value={
                      Number.isFinite(props.stats.averageConsistency) ? (
                        <NumberAnimation value={props.stats.averageConsistency} unit="%" delay={0.7} />
                      ) : (
                        "—"
                      )
                    }
                    icon={<Activity className="h-4 w-4 text-purple-300" />}
                  />
                </div>
              </div>

              {/* Activity Totals */}
              <div>
                <h4 className="text-sm font-medium bg-clip-text text-transparent bg-gradient-to-r from-amber-300 to-orange-400 mb-3">
                  Activity Totals
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <StatTile
                    label="Time typed"
                    value={formatDurationSeconds(props.stats.totalTimeTyped)}
                    subValue={lastUpdatedAt ? `Updated ${formatLocalDateTime(lastUpdatedAt)}` : undefined}
                    icon={<Clock className="h-4 w-4 text-cyan-300" />}
                  />
                  <StatTile
                    label="Total sessions"
                    value={<NumberAnimation value={props.stats.totalSessions} delay={0.2} />}
                    icon={<BarChart3 className="h-4 w-4 text-green-300" />}
                  />
                  <StatTile
                    label="Words typed"
                    value={<NumberAnimation value={props.stats.totalWordsTyped} delay={0.8} />}
                    icon={<BarChart3 className="h-4 w-4 text-blue-300" />}
                  />
                  <StatTile
                    label="Chars typed"
                    value={<NumberAnimation value={props.stats.totalCharactersTyped} delay={0.9} />}
                    icon={<BarChart3 className="h-4 w-4 text-purple-300" />}
                  />
                  <StatTile
                    label="Total mistakes"
                    value={<NumberAnimation value={props.stats.totalMistakes} delay={1.0} />}
                    icon={<AlertTriangle className="h-4 w-4 text-red-300" />}
                  />
                  <StatTile
                    label="Total corrections"
                    value={<NumberAnimation value={props.stats.totalCorrections} delay={1.1} />}
                    icon={<CheckCircle2 className="h-4 w-4 text-green-300" />}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Account Actions Card */}
        <motion.div variants={fadeInUp}>
          <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all">
            <CardHeader>
              <CardTitle className="text-[#E0E7FF]">Account</CardTitle>
              <CardDescription className="text-[#8A8FB5]">Manage your account.</CardDescription>
            </CardHeader>
            <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <SignOut
                label="Sign out"
                redirectTo="/"
                className="flex-1 font-medium rounded-lg py-5 border border-[#69d0ff] bg-transparent text-[#60a5fa] hover:bg-[#69d0ff]/20 hover:text-[#93c5fd] transition-colors duration-300"
              />
              <DeleteAccountButton className="flex-1" />
            </div>
          </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </LayoutGroup>
  );
}