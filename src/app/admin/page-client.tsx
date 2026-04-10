"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type DashboardResponse = {
  currentAdmin: {
    id: string;
    username: string;
    email: string;
    isPrimaryAdmin: boolean;
  };
  environment: {
    nodeEnv: string | undefined;
    isProduction: boolean;
  };
  overview: {
    totalUsers: number;
    bannedUsers: number;
    adminUsers: number;
    pendingFlags: number;
    sanctionCandidates: number;
    redisHealthy: boolean;
    activePlayers: number;
    openFeedbackCount: number;
    apiMetricCount: number;
    avgResponseTime: number | null;
    successRate: number | null;
    topErrors: Array<[string, number]>;
  };
  warnings: string[];
  notes: string[];
  recentFlags: Array<{
    id: string;
    confidence: number;
    flags: string[];
    reviewed: boolean;
    wouldSanction: boolean;
    createdAt: string;
    user: { id: string; username: string; role: string; banned: boolean };
    match: { id: string; status: string; createdAt: string };
  }>;
  recentUsers: Array<{
    id: string;
    username: string;
    email: string;
    role: string;
    banned: boolean;
    isPrimaryAdmin: boolean;
    createdAt: string;
    updatedAt: string;
    emailVerified: string | null;
  }>;
  recentRooms: Array<{
    id: string;
    code: string;
    status: string;
    visibility: string;
    maxPlayers: number;
    hostUserId: string;
    createdAt: string;
    updatedAt: string;
    expiresAt: string | null;
    _count: { members: number; matches: number };
  }>;
  recentAdminActions: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    targetUserId: string | null;
    summary: string;
    createdAt: string;
    actorUser: { id: string; username: string };
  }>;
  adminAccounts: Array<{
    id: string;
    username: string;
    email: string;
    banned: boolean;
    isPrimaryAdmin: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  activePlayers: Array<{
    id: string;
    username: string;
    email: string;
    role: string;
    banned: boolean;
    isPrimaryAdmin: boolean;
    avatar: string | null;
  }>;
  recentFeedback: Array<{
    id: string;
    category: string;
    status: "OPEN" | "IN_REVIEW" | "REPLIED" | "RESOLVED";
    subject: string;
    body: string;
    rating: number | null;
    imageUrl: string | null;
    adminReplyTitle: string | null;
    adminReplyBody: string | null;
    respondedAt: string | null;
    createdAt: string;
    user: {
      id: string;
      username: string;
      email: string;
    };
    respondedBy: {
      id: string;
      username: string;
    } | null;
  }>;
};

type DiagnosticsResponse = {
  diagnostics: {
    ranAt: string;
    durationMs: number;
    environment: string | undefined;
    databaseOk: boolean;
    redisOk: boolean;
    authSecretConfigured: boolean;
    jwtSecretConfigured: boolean;
    apiMetricCount: number;
    challengeMetricCount: number;
  };
  interactive: boolean;
};

type UserFilter = "all" | "banned" | "admins" | "unverified";
type FlagFilter = "all" | "pending" | "reviewed" | "sanction";
type RoomFilter = "all" | "open" | "closed" | "private";
type FeedbackStatus = "OPEN" | "IN_REVIEW" | "REPLIED" | "RESOLVED";
type FeedbackSeverity = "info" | "warning" | "critical";
type FeedbackFilter = "all" | "open" | "in_review" | "replied" | "resolved" | "needs_reply";

type ConfirmationAction =
  | {
      kind: "user";
      action: "ban" | "unban";
      userId: string;
      title: string;
      description: string;
      confirmLabel: string;
    }
  | {
      kind: "flag";
      flagId: string;
      reviewed: boolean;
      title: string;
      description: string;
      confirmLabel: string;
    }
  | {
      kind: "room";
      roomId: string;
      action: "close" | "reopen";
      title: string;
      description: string;
      confirmLabel: string;
    }
  | {
      kind: "adminAccess";
      userId: string;
      title: string;
      description: string;
      confirmLabel: string;
    };

type FeedbackComposerState = {
  feedbackId: string;
  subject: string;
  originalStatus: FeedbackStatus;
  status: FeedbackStatus;
  replyTitle: string;
  replyBody: string;
  severity: FeedbackSeverity;
};

const statCardClassName = "border-[rgba(120,200,255,0.16)] bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_48%),rgba(15,23,42,0.72)]";

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function matchesSearch(haystack: Array<string | null | undefined>, query: string) {
  if (!query) return true;
  return haystack.some((value) => value?.toLowerCase().includes(query));
}

function formatFeedbackStatus(status: FeedbackStatus) {
  return status.toLowerCase().replaceAll("_", " ");
}

function FilterPill<T extends string>(params: {
  value: T;
  current: T;
  onClick: (value: T) => void;
  children: string;
}) {
  const active = params.value === params.current;

  return (
    <button
      type="button"
      onClick={() => params.onClick(params.value)}
      className={active
        ? "rounded-full border border-cyan-300/30 bg-cyan-400/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-100"
        : "rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300 transition hover:border-cyan-300/20 hover:text-cyan-100"}
    >
      {params.children}
    </button>
  );
}

export function AdminDashboardClient({ isProduction }: { isProduction: boolean }) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [noticeTargetUserId, setNoticeTargetUserId] = useState("");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeBody, setNoticeBody] = useState("");
  const [roomStatusMessage, setRoomStatusMessage] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<UserFilter>("all");
  const [flagSearch, setFlagSearch] = useState("");
  const [flagFilter, setFlagFilter] = useState<FlagFilter>("pending");
  const [roomSearch, setRoomSearch] = useState("");
  const [roomFilter, setRoomFilter] = useState<RoomFilter>("all");
  const [feedbackSearch, setFeedbackSearch] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>("needs_reply");
  const [feedbackComposer, setFeedbackComposer] = useState<FeedbackComposerState | null>(null);
  const [auditSearch, setAuditSearch] = useState("");
  const [confirmationAction, setConfirmationAction] = useState<ConfirmationAction | null>(null);

  const loadDashboard = async () => {
    setIsLoading(true);
    try {
      const [dashboardResponse, diagnosticsResponse] = await Promise.all([
        fetch("/api/admin/dashboard", { credentials: "include", cache: "no-store" }),
        fetch("/api/admin/diagnostics", { credentials: "include", cache: "no-store" }),
      ]);

      if (!dashboardResponse.ok) {
        throw new Error(`Dashboard request failed with ${dashboardResponse.status}`);
      }

      const dashboardPayload = (await dashboardResponse.json()) as DashboardResponse;
      setDashboard(dashboardPayload);

      if (diagnosticsResponse.ok) {
        setDiagnostics((await diagnosticsResponse.json()) as DiagnosticsResponse);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load admin dashboard");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const userSearchQuery = useMemo(() => normalizeSearchValue(userSearch), [userSearch]);
  const flagSearchQuery = useMemo(() => normalizeSearchValue(flagSearch), [flagSearch]);
  const roomSearchQuery = useMemo(() => normalizeSearchValue(roomSearch), [roomSearch]);
  const feedbackSearchQuery = useMemo(() => normalizeSearchValue(feedbackSearch), [feedbackSearch]);
  const auditSearchQuery = useMemo(() => normalizeSearchValue(auditSearch), [auditSearch]);

  const filteredUsers = useMemo(() => {
    if (!dashboard) return [];

    return dashboard.recentUsers.filter((user) => {
      const filterMatch =
        userFilter === "all" ||
        (userFilter === "banned" && user.banned) ||
        (userFilter === "admins" && user.role === "admin") ||
        (userFilter === "unverified" && !user.emailVerified);

      return filterMatch && matchesSearch([user.username, user.email, user.id, user.role], userSearchQuery);
    });
  }, [dashboard, userFilter, userSearchQuery]);

  const filteredFlags = useMemo(() => {
    if (!dashboard) return [];

    return dashboard.recentFlags.filter((flag) => {
      const filterMatch =
        flagFilter === "all" ||
        (flagFilter === "pending" && !flag.reviewed) ||
        (flagFilter === "reviewed" && flag.reviewed) ||
        (flagFilter === "sanction" && flag.wouldSanction);

      return (
        filterMatch &&
        matchesSearch(
          [flag.user.username, flag.user.id, flag.match.id, ...flag.flags],
          flagSearchQuery
        )
      );
    });
  }, [dashboard, flagFilter, flagSearchQuery]);

  const filteredRooms = useMemo(() => {
    if (!dashboard) return [];

    return dashboard.recentRooms.filter((room) => {
      const filterMatch =
        roomFilter === "all" ||
        (roomFilter === "open" && room.status === "OPEN") ||
        (roomFilter === "closed" && room.status !== "OPEN") ||
        (roomFilter === "private" && room.visibility === "PRIVATE");

      return filterMatch && matchesSearch([room.code, room.id, room.hostUserId, room.status, room.visibility], roomSearchQuery);
    });
  }, [dashboard, roomFilter, roomSearchQuery]);

  const filteredFeedback = useMemo(() => {
    if (!dashboard) return [];

    return dashboard.recentFeedback.filter((feedback) => {
      const filterMatch =
        feedbackFilter === "all" ||
        (feedbackFilter === "open" && feedback.status === "OPEN") ||
        (feedbackFilter === "in_review" && feedback.status === "IN_REVIEW") ||
        (feedbackFilter === "replied" && feedback.status === "REPLIED") ||
        (feedbackFilter === "resolved" && feedback.status === "RESOLVED") ||
        (feedbackFilter === "needs_reply" && !feedback.adminReplyBody && feedback.status !== "RESOLVED");

      return (
        filterMatch &&
        matchesSearch(
          [feedback.subject, feedback.body, feedback.user.username, feedback.user.email, feedback.category, feedback.status],
          feedbackSearchQuery
        )
      );
    });
  }, [dashboard, feedbackFilter, feedbackSearchQuery]);

  const filteredAdminActions = useMemo(() => {
    if (!dashboard) return [];

    return dashboard.recentAdminActions.filter((entry) =>
      matchesSearch([entry.summary, entry.actorUser.username, entry.action, entry.entityType, entry.entityId, entry.targetUserId], auditSearchQuery)
    );
  }, [dashboard, auditSearchQuery]);

  const selectedNoticeUser = useMemo(() => {
    if (!dashboard || !noticeTargetUserId) return null;
    return dashboard.recentUsers.find((user) => user.id === noticeTargetUserId) ?? null;
  }, [dashboard, noticeTargetUserId]);

  const runDiagnostics = async () => {
    setIsRunningDiagnostics(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/admin/diagnostics", {
        method: "POST",
        credentials: "include",
      });

      const payload = (await response.json()) as DiagnosticsResponse | { error: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Diagnostics failed");
      }

      setDiagnostics(payload as DiagnosticsResponse);
      setStatusMessage("Diagnostics completed successfully.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Diagnostics failed");
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  const toggleBan = async (userId: string, nextAction: "ban" | "unban") => {
    setStatusMessage(null);
    setPendingActionId(`user:${userId}:${nextAction}`);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action: nextAction }),
      });

      if (!response.ok) {
        setStatusMessage("Failed to update user moderation state.");
        return;
      }

      setStatusMessage(`User ${nextAction === "ban" ? "banned" : "unbanned"} successfully.`);
      await loadDashboard();
    } finally {
      setPendingActionId(null);
    }
  };

  const markFlagReviewed = async (flagId: string, reviewed: boolean) => {
    setStatusMessage(null);
    setPendingActionId(`flag:${flagId}:${reviewed ? "reviewed" : "pending"}`);
    try {
      const response = await fetch("/api/admin/flags", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flagId, reviewed }),
      });

      if (!response.ok) {
        setStatusMessage("Failed to update cheat flag.");
        return;
      }

      setStatusMessage(`Cheat flag marked as ${reviewed ? "reviewed" : "pending"}.`);
      await loadDashboard();
    } finally {
      setPendingActionId(null);
    }
  };

  const removeAdminAccess = async (userId: string) => {
    setStatusMessage(null);
    setPendingActionId(`admin-access:${userId}`);
    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setStatusMessage(payload?.error ?? "Failed to remove admin access.");
        return;
      }

      setStatusMessage("Admin access removed successfully.");
      await loadDashboard();
    } finally {
      setPendingActionId(null);
    }
  };

  const sendNotice = async () => {
    setStatusMessage(null);
    setPendingActionId(`notice:${noticeTargetUserId}`);
    try {
      const response = await fetch("/api/admin/notices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: noticeTargetUserId,
          title: noticeTitle,
          body: noticeBody,
          severity: "warning",
          ttlHours: 48,
        }),
      });

      if (!response.ok) {
        setStatusMessage("Failed to send admin notice.");
        return;
      }

      setNoticeTitle("");
      setNoticeBody("");
      setStatusMessage("Admin notice sent. The next authenticated refresh for that user will show a dialog.");
    } finally {
      setPendingActionId(null);
    }
  };

  const submitFeedbackUpdate = async () => {
    if (!feedbackComposer) return;

    const replyTitle = feedbackComposer.replyTitle.trim();
    const replyBody = feedbackComposer.replyBody.trim();
    const hasReply = replyTitle.length > 0 || replyBody.length > 0;

    if (hasReply && (!replyTitle || !replyBody)) {
      setStatusMessage("Reply title and body must be provided together.");
      return;
    }

    if (!hasReply && feedbackComposer.status === feedbackComposer.originalStatus) {
      setStatusMessage("Choose a new status or write a reply before saving feedback changes.");
      return;
    }

    setStatusMessage(null);
    setPendingActionId(`feedback:${feedbackComposer.feedbackId}`);
    try {
      const payload: {
        feedbackId: string;
        status?: FeedbackStatus;
        replyTitle?: string;
        replyBody?: string;
        severity?: FeedbackSeverity;
      } = {
        feedbackId: feedbackComposer.feedbackId,
      };

      // Only send the fields that changed so the server can distinguish a status-only update from a reply.
      if (feedbackComposer.status !== feedbackComposer.originalStatus || !hasReply) {
        payload.status = feedbackComposer.status;
      }

      if (hasReply) {
        payload.replyTitle = replyTitle;
        payload.replyBody = replyBody;
        payload.severity = feedbackComposer.severity;
      }

      const response = await fetch("/api/admin/feedback", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responsePayload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setStatusMessage(responsePayload?.error ?? "Failed to update feedback.");
        return;
      }

      setFeedbackComposer(null);
      setStatusMessage(hasReply ? "Feedback reply delivered successfully." : "Feedback status updated successfully.");
      await loadDashboard();
    } finally {
      setPendingActionId(null);
    }
  };

  const updateRoom = async (roomId: string, action: "close" | "reopen") => {
    setRoomStatusMessage(null);
    setPendingActionId(`room:${roomId}:${action}`);
    try {
      const response = await fetch("/api/admin/rooms", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, action }),
      });

      if (!response.ok) {
        setRoomStatusMessage("Failed to update room state.");
        return;
      }

      setRoomStatusMessage(`Room ${action.replaceAll("_", " ")} applied successfully.`);
      await loadDashboard();
    } finally {
      setPendingActionId(null);
    }
  };

  const openUserNotice = (userId: string, username: string) => {
    setNoticeTargetUserId(userId);
    setNoticeTitle(`Admin message for ${username}`);
  };

  const openFeedbackComposerFor = (feedback: DashboardResponse["recentFeedback"][number]) => {
    setFeedbackComposer({
      feedbackId: feedback.id,
      subject: feedback.subject,
      originalStatus: feedback.status,
      status: feedback.status,
      replyTitle: feedback.adminReplyTitle ?? "",
      replyBody: feedback.adminReplyBody ?? "",
      severity: "info",
    });
  };

  const runConfirmedAction = async () => {
    if (!confirmationAction) return;

    const currentAction = confirmationAction;
    setConfirmationAction(null);

    if (currentAction.kind === "user") {
      await toggleBan(currentAction.userId, currentAction.action);
      return;
    }

    if (currentAction.kind === "flag") {
      await markFlagReviewed(currentAction.flagId, currentAction.reviewed);
      return;
    }

    if (currentAction.kind === "adminAccess") {
      await removeAdminAccess(currentAction.userId);
      return;
    }

    await updateRoom(currentAction.roomId, currentAction.action);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 pb-20 pt-28 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-[32px] border border-cyan-300/15 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_42%),radial-gradient(circle_at_top_right,rgba(244,114,182,0.12),transparent_28%),rgba(2,6,23,0.76)] p-8 shadow-[0_30px_120px_rgba(15,23,42,0.55)] backdrop-blur-xl">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex w-fit rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-cyan-200">
              Admin Control Room
            </div>
            <h1 className="[font-family:var(--font-sora)] text-3xl font-semibold text-slate-50 sm:text-4xl">
              Moderation, diagnostics, and live system oversight.
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              This page is restricted to admin accounts. It aggregates suspicious players, system warnings, user moderation controls, and targeted admin notices.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button className="bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30" onClick={() => void loadDashboard()}>
              Refresh dashboard
            </Button>
            {!isProduction ? (
              <Button className="bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25" onClick={() => void runDiagnostics()} disabled={isRunningDiagnostics}>
                {isRunningDiagnostics ? "Running checks..." : "Run dev diagnostics"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {statusMessage ? (
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
          {statusMessage}
        </div>
      ) : null}

      {isLoading || !dashboard ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-slate-300">Loading admin dashboard...</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <Card className={statCardClassName}>
              <CardHeader>
                <CardDescription>Total users</CardDescription>
                <CardTitle className="text-3xl text-white">{dashboard.overview.totalUsers}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={statCardClassName}>
              <CardHeader>
                <CardDescription>Pending cheat reviews</CardDescription>
                <CardTitle className="text-3xl text-amber-200">{dashboard.overview.pendingFlags}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={statCardClassName}>
              <CardHeader>
                <CardDescription>Banned users</CardDescription>
                <CardTitle className="text-3xl text-rose-200">{dashboard.overview.bannedUsers}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={statCardClassName}>
              <CardHeader>
                <CardDescription>Open feedback</CardDescription>
                <CardTitle className="text-3xl text-fuchsia-100">{dashboard.overview.openFeedbackCount}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={statCardClassName}>
              <CardHeader>
                <CardDescription>Online players</CardDescription>
                <CardTitle className="text-3xl text-emerald-100">{dashboard.overview.activePlayers}</CardTitle>
              </CardHeader>
            </Card>
            <Card className={statCardClassName}>
              <CardHeader>
                <CardDescription>Redis health</CardDescription>
                <CardTitle className="text-3xl text-white">{dashboard.overview.redisHealthy ? "Healthy" : "Offline"}</CardTitle>
              </CardHeader>
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-50">Warnings and notes</CardTitle>
                <CardDescription>Live signals synthesized from monitoring, moderation, and environment state.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 md:grid-cols-2">
                <div>
                  <div className="mb-3 text-xs uppercase tracking-[0.24em] text-rose-200">Warnings</div>
                  <div className="space-y-3">
                    {dashboard.warnings.length > 0 ? dashboard.warnings.map((warning) => (
                      <div key={warning} className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                        {warning}
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                        No active admin warnings at the moment.
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-3 text-xs uppercase tracking-[0.24em] text-cyan-200">Notes</div>
                  <div className="space-y-3">
                    {dashboard.notes.map((note) => (
                      <div key={note} className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-slate-50">Diagnostics</CardTitle>
                <CardDescription>
                  {isProduction ? "Production exposes read-only diagnostics." : "Development can run interactive system checks from this panel."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-200">
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <span>Database</span>
                  <span>{diagnostics?.diagnostics.databaseOk ? "OK" : "Unavailable"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <span>Redis</span>
                  <span>{diagnostics?.diagnostics.redisOk ? "OK" : "Unavailable"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <span>Auth secret</span>
                  <span>{diagnostics?.diagnostics.authSecretConfigured ? "Configured" : "Missing"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <span>JWT secret</span>
                  <span>{diagnostics?.diagnostics.jwtSecretConfigured ? "Configured" : "Missing"}</span>
                </div>
                <div className="text-xs text-slate-400">
                  Last check: {diagnostics?.diagnostics.ranAt ? new Date(diagnostics.diagnostics.ranAt).toLocaleString() : "Not yet run"}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-50">Feedback inbox</CardTitle>
                <CardDescription>Review incoming reports, update their lifecycle, and deliver a tracked admin reply back to the reporting user.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/20 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <Input
                    value={feedbackSearch}
                    onChange={(event) => setFeedbackSearch(event.target.value)}
                    placeholder="Search by subject, body, player, email, or category"
                    className="max-w-xl"
                  />
                  <div className="flex flex-wrap gap-2">
                    <FilterPill value="needs_reply" current={feedbackFilter} onClick={setFeedbackFilter}>Needs reply</FilterPill>
                    <FilterPill value="open" current={feedbackFilter} onClick={setFeedbackFilter}>Open</FilterPill>
                    <FilterPill value="in_review" current={feedbackFilter} onClick={setFeedbackFilter}>In review</FilterPill>
                    <FilterPill value="replied" current={feedbackFilter} onClick={setFeedbackFilter}>Replied</FilterPill>
                    <FilterPill value="resolved" current={feedbackFilter} onClick={setFeedbackFilter}>Resolved</FilterPill>
                    <FilterPill value="all" current={feedbackFilter} onClick={setFeedbackFilter}>All</FilterPill>
                  </div>
                </div>
                {filteredFeedback.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-300">
                    No feedback items match the current filters.
                  </div>
                ) : filteredFeedback.map((feedback) => (
                  <div key={feedback.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
                          <span className="font-semibold text-white">{feedback.user.username}</span>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300">{feedback.category}</span>
                          <span className="rounded-full border border-cyan-400/20 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-cyan-200">{formatFeedbackStatus(feedback.status)}</span>
                          {feedback.rating ? <span className="rounded-full border border-amber-400/20 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-amber-200">{feedback.rating}/5</span> : null}
                        </div>
                        <div className="text-base font-semibold text-white">{feedback.subject}</div>
                        <div className="text-sm leading-7 text-slate-300">{feedback.body}</div>
                        <div className="text-xs text-slate-400">
                          From {feedback.user.email} • {new Date(feedback.createdAt).toLocaleString()}
                          {feedback.respondedAt ? ` • Replied ${new Date(feedback.respondedAt).toLocaleString()}` : ""}
                          {feedback.respondedBy ? ` by ${feedback.respondedBy.username}` : ""}
                        </div>
                        {feedback.adminReplyBody ? (
                          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                            <div className="font-semibold text-cyan-50">{feedback.adminReplyTitle}</div>
                            <div className="mt-1 whitespace-pre-wrap">{feedback.adminReplyBody}</div>
                          </div>
                        ) : null}
                        {feedback.imageUrl ? (
                          <a className="inline-flex text-xs text-cyan-200 underline-offset-4 hover:underline" href={feedback.imageUrl} rel="noreferrer" target="_blank">
                            Open attached screenshot
                          </a>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                          onClick={() => openFeedbackComposerFor(feedback)}
                        >
                          Reply / update
                        </Button>
                        <Button
                          className="bg-white/10 text-white hover:bg-white/15"
                          onClick={() => {
                            openUserNotice(feedback.user.id, feedback.user.username);
                          }}
                        >
                          Message user
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-50">Admin accounts</CardTitle>
                  <CardDescription>Current elevated accounts ordered from the primary admin downward.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dashboard.adminAccounts.map((adminAccount) => {
                    const canRemoveAdminAccess = dashboard.currentAdmin.isPrimaryAdmin && !adminAccount.isPrimaryAdmin;

                    return (
                      <div key={adminAccount.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-white">{adminAccount.username}</span>
                              <span className="rounded-full border border-cyan-400/20 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-cyan-200">admin</span>
                              {adminAccount.isPrimaryAdmin ? <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-amber-200">primary</span> : null}
                              {adminAccount.banned ? <span className="rounded-full border border-rose-400/30 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-rose-200">banned</span> : null}
                            </div>
                            <div className="mt-1 text-sm text-slate-300">{adminAccount.email}</div>
                          </div>
                          {canRemoveAdminAccess ? (
                            <Button
                              className="bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                              disabled={pendingActionId === `admin-access:${adminAccount.id}`}
                              onClick={() =>
                                setConfirmationAction({
                                  kind: "adminAccess",
                                  userId: adminAccount.id,
                                  title: "Remove admin access",
                                  description: `This will demote ${adminAccount.username} back to a regular user account.`,
                                  confirmLabel: "Remove access",
                                })
                              }
                            >
                              Remove access
                            </Button>
                          ) : (
                            <div className="text-xs text-slate-400">
                              {adminAccount.isPrimaryAdmin ? "Primary admin access is locked." : "Only the primary admin can remove admin access."}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-slate-50">Active players</CardTitle>
                  <CardDescription>Live Redis-backed presence snapshot for the most recent online accounts.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {dashboard.activePlayers.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-300">
                      No active players are currently tracked.
                    </div>
                  ) : dashboard.activePlayers.map((player) => (
                    <div key={player.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">{player.username}</span>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300">{player.role}</span>
                          {player.isPrimaryAdmin ? <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-amber-200">primary admin</span> : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{player.email}</div>
                      </div>
                      <Button
                        className="bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                        onClick={() => {
                          openUserNotice(player.id, player.username);
                        }}
                      >
                        Notify
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-50">Suspected cheating</CardTitle>
                <CardDescription>Recent flags with sanction indicators, local search, and confirmation before review state changes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/20 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <Input
                    value={flagSearch}
                    onChange={(event) => setFlagSearch(event.target.value)}
                    placeholder="Search by user, match id, or flag"
                    className="max-w-xl"
                  />
                  <div className="flex flex-wrap gap-2">
                    <FilterPill value="pending" current={flagFilter} onClick={setFlagFilter}>Pending</FilterPill>
                    <FilterPill value="sanction" current={flagFilter} onClick={setFlagFilter}>Sanction</FilterPill>
                    <FilterPill value="reviewed" current={flagFilter} onClick={setFlagFilter}>Reviewed</FilterPill>
                    <FilterPill value="all" current={flagFilter} onClick={setFlagFilter}>All</FilterPill>
                  </div>
                </div>
                {filteredFlags.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-300">
                    No cheat flags match the current filters.
                  </div>
                ) : filteredFlags.map((flag) => (
                  <div key={flag.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
                          <span className="font-semibold text-white">{flag.user.username}</span>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300">{flag.user.role}</span>
                          {flag.user.banned ? <span className="rounded-full border border-rose-400/30 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-rose-200">banned</span> : null}
                          {flag.wouldSanction ? <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-amber-200">sanction candidate</span> : null}
                        </div>
                        <div className="text-xs text-slate-400">
                          Confidence {Math.round(flag.confidence * 100)}% • Match {flag.match.id.slice(0, 8)} • {new Date(flag.createdAt).toLocaleString()}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {flag.flags.map((item) => (
                            <span key={item} className="rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-2 py-1 text-xs text-fuchsia-100">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                          onClick={() => {
                            openUserNotice(flag.user.id, flag.user.username);
                          }}
                        >
                          Message user
                        </Button>
                        <Button
                          className="bg-white/10 text-white hover:bg-white/15"
                          disabled={pendingActionId === `flag:${flag.id}:${flag.reviewed ? "pending" : "reviewed"}`}
                          onClick={() =>
                            setConfirmationAction({
                              kind: "flag",
                              flagId: flag.id,
                              reviewed: !flag.reviewed,
                              title: flag.reviewed ? "Reopen cheat flag" : "Mark cheat flag reviewed",
                              description: flag.reviewed
                                ? `This will move ${flag.user.username}'s flag back to the pending queue.`
                                : `This will mark ${flag.user.username}'s flag as reviewed and remove it from the pending queue.`,
                              confirmLabel: flag.reviewed ? "Reopen flag" : "Mark reviewed",
                            })
                          }
                        >
                          {flag.reviewed ? "Mark pending" : "Mark reviewed"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-slate-50">Send user notice</CardTitle>
                <CardDescription>This creates a blocking dialog shown to the target user on their next authenticated refresh.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Target user ID</label>
                  <Input value={noticeTargetUserId} onChange={(event) => setNoticeTargetUserId(event.target.value)} placeholder="User id" />
                  {selectedNoticeUser ? (
                    <div className="text-xs text-cyan-200">Recipient: {selectedNoticeUser.username} ({selectedNoticeUser.email})</div>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Title</label>
                  <Input value={noticeTitle} onChange={(event) => setNoticeTitle(event.target.value)} placeholder="Moderation notice" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Body</label>
                  <textarea
                    value={noticeBody}
                    onChange={(event) => setNoticeBody(event.target.value)}
                    rows={6}
                    className="flex w-full rounded-2xl border border-white/10 bg-transparent px-3 py-3 text-sm text-slate-100 shadow-sm outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/40"
                    placeholder="Explain the issue, required action, or moderation decision."
                  />
                </div>
                <Button
                  className="w-full bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30"
                  onClick={() => void sendNotice()}
                  disabled={!noticeTargetUserId || !noticeTitle.trim() || !noticeBody.trim() || pendingActionId === `notice:${noticeTargetUserId}`}
                >
                  Send dialog notice
                </Button>
              </CardContent>
            </Card>
          </section>

          <section>
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-50">Recent users</CardTitle>
                <CardDescription>Direct moderation controls with local search and quick filters.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/20 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <Input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search by username, email, id, or role"
                    className="max-w-xl"
                  />
                  <div className="flex flex-wrap gap-2">
                    <FilterPill value="all" current={userFilter} onClick={setUserFilter}>All</FilterPill>
                    <FilterPill value="banned" current={userFilter} onClick={setUserFilter}>Banned</FilterPill>
                    <FilterPill value="admins" current={userFilter} onClick={setUserFilter}>Admins</FilterPill>
                    <FilterPill value="unverified" current={userFilter} onClick={setUserFilter}>Unverified</FilterPill>
                  </div>
                </div>
                {filteredUsers.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-300">
                    No users match the current filters.
                  </div>
                ) : filteredUsers.map((user) => {
                  const moderationDisabledReason = user.isPrimaryAdmin
                    ? "Primary admin access cannot be moderated from this panel."
                    : user.role === "admin" && !dashboard.currentAdmin.isPrimaryAdmin && user.id !== dashboard.currentAdmin.id
                      ? "Only the primary admin can moderate another admin account."
                      : null;

                  return (
                    <div key={user.id} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/30 p-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">{user.username}</span>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300">{user.role}</span>
                          {user.isPrimaryAdmin ? <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-amber-200">primary admin</span> : null}
                          {user.banned ? <span className="rounded-full border border-rose-400/30 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-rose-200">banned</span> : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">{user.email}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          Created {new Date(user.createdAt).toLocaleString()} • {user.emailVerified ? "Email verified" : "Email unverified"}
                        </div>
                        {moderationDisabledReason ? <div className="mt-2 text-xs text-amber-200">{moderationDisabledReason}</div> : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                          onClick={() => {
                            openUserNotice(user.id, user.username);
                          }}
                        >
                          Prepare message
                        </Button>
                        <Button
                          className={user.banned ? "bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25" : "bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"}
                          disabled={Boolean(moderationDisabledReason) || pendingActionId === `user:${user.id}:${user.banned ? "unban" : "ban"}`}
                          onClick={() =>
                            setConfirmationAction({
                              kind: "user",
                              action: user.banned ? "unban" : "ban",
                              userId: user.id,
                              title: user.banned ? "Unban user" : "Ban user",
                              description: user.banned
                                ? `This will restore access for ${user.username}.`
                                : `This will immediately block ${user.username} from the protected application flows.`,
                              confirmLabel: user.banned ? "Unban" : "Ban",
                            })
                          }
                        >
                          {user.banned ? "Unban" : "Ban"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-slate-50">PvP room control</CardTitle>
                <CardDescription>Inspect active rooms, filter by visibility or status, and confirm state changes before applying them.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {roomStatusMessage ? (
                  <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">{roomStatusMessage}</div>
                ) : null}
                <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/20 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <Input
                    value={roomSearch}
                    onChange={(event) => setRoomSearch(event.target.value)}
                    placeholder="Search by room code, host, id, or state"
                    className="max-w-xl"
                  />
                  <div className="flex flex-wrap gap-2">
                    <FilterPill value="all" current={roomFilter} onClick={setRoomFilter}>All</FilterPill>
                    <FilterPill value="open" current={roomFilter} onClick={setRoomFilter}>Open</FilterPill>
                    <FilterPill value="closed" current={roomFilter} onClick={setRoomFilter}>Closed</FilterPill>
                    <FilterPill value="private" current={roomFilter} onClick={setRoomFilter}>Private</FilterPill>
                  </div>
                </div>
                {filteredRooms.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-300">
                    No rooms match the current filters.
                  </div>
                ) : filteredRooms.map((room) => (
                  <div key={room.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white">Room {room.code}</span>
                          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300">{room.status}</span>
                          <span className="rounded-full border border-cyan-400/20 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-cyan-200">{room.visibility}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Members {room._count.members} / {room.maxPlayers} • Matches {room._count.matches} • Updated {new Date(room.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="bg-white/10 text-white hover:bg-white/15"
                          disabled={pendingActionId === `room:${room.id}:${room.status === "OPEN" ? "close" : "reopen"}`}
                          onClick={() =>
                            setConfirmationAction({
                              kind: "room",
                              roomId: room.id,
                              action: room.status === "OPEN" ? "close" : "reopen",
                              title: room.status === "OPEN" ? "Close room" : "Reopen room",
                              description: room.status === "OPEN"
                                ? `This will close room ${room.code} and stop it from accepting normal activity.`
                                : `This will reopen room ${room.code} and allow it to accept activity again.`,
                              confirmLabel: room.status === "OPEN" ? "Close room" : "Reopen room",
                            })
                          }
                        >
                          {room.status === "OPEN" ? "Close room" : "Reopen room"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-slate-50">Admin audit log</CardTitle>
                <CardDescription>Persistent server-side history of moderation and control actions with local search.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={auditSearch}
                  onChange={(event) => setAuditSearch(event.target.value)}
                  placeholder="Search summary, actor, entity, or action"
                  className="max-w-xl"
                />
                {filteredAdminActions.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-300">
                    No audit log entries match the current search.
                  </div>
                ) : filteredAdminActions.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <div className="text-sm font-semibold text-white">{entry.summary}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.2em] text-cyan-200">
                      {entry.entityType} • {entry.action}
                    </div>
                    <div className="mt-2 text-xs text-slate-400">
                      By {entry.actorUser.username} • {new Date(entry.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        </>
      )}

      <Dialog open={Boolean(confirmationAction)} onOpenChange={(open) => (!open ? setConfirmationAction(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmationAction?.title}</DialogTitle>
            <DialogDescription>{confirmationAction?.description}</DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            This action will be written to the persistent admin audit log.
          </div>
          <DialogFooter>
            <Button className="bg-white/10 text-white hover:bg-white/15" onClick={() => setConfirmationAction(null)}>
              Cancel
            </Button>
            <Button className="bg-rose-500/20 text-rose-100 hover:bg-rose-500/30" onClick={() => void runConfirmedAction()}>
              {confirmationAction?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(feedbackComposer)} onOpenChange={(open) => (!open ? setFeedbackComposer(null) : undefined)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Update feedback</DialogTitle>
            <DialogDescription>{feedbackComposer ? `Review and reply to ${feedbackComposer.subject}.` : "Review a feedback item."}</DialogDescription>
          </DialogHeader>
          {feedbackComposer ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Status</label>
                <select
                  value={feedbackComposer.status}
                  onChange={(event) => setFeedbackComposer((current) => current ? { ...current, status: event.target.value as FeedbackStatus } : current)}
                  className="flex h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                >
                  <option value="OPEN">Open</option>
                  <option value="IN_REVIEW">In review</option>
                  <option value="REPLIED">Replied</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Reply title</label>
                  <Input
                    value={feedbackComposer.replyTitle}
                    onChange={(event) => setFeedbackComposer((current) => current ? { ...current, replyTitle: event.target.value } : current)}
                    placeholder="Thanks for the report"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Notice severity</label>
                  <select
                    value={feedbackComposer.severity}
                    onChange={(event) => setFeedbackComposer((current) => current ? { ...current, severity: event.target.value as FeedbackSeverity } : current)}
                    className="flex h-11 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none transition focus:border-cyan-300/40"
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Reply body</label>
                <textarea
                  value={feedbackComposer.replyBody}
                  onChange={(event) => setFeedbackComposer((current) => current ? { ...current, replyBody: event.target.value } : current)}
                  rows={7}
                  className="flex w-full rounded-2xl border border-white/10 bg-transparent px-3 py-3 text-sm text-slate-100 shadow-sm outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/40"
                  placeholder="Explain what was reviewed, what changed, or what the player should do next."
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button className="bg-white/10 text-white hover:bg-white/15" onClick={() => setFeedbackComposer(null)}>
              Cancel
            </Button>
            <Button
              className="bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30"
              disabled={!feedbackComposer || pendingActionId === `feedback:${feedbackComposer.feedbackId}`}
              onClick={() => void submitFeedbackUpdate()}
            >
              Save feedback update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}