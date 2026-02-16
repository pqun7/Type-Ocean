"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAlert } from "@/contexts/alert-context";
import { VerifyEmailOtpDialog } from "@/components/auth/verification/verify-email-otp-dialog";
import AccountStatsChart from "./account-stats-chart";

type ProfileData = {
  level: number;
  xp: number;
  achievementsCount: number;
  avatar: string | null;
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
  bestWPM: number;
  bestWPMDate: string | null;
  bestAccuracy: number;
  bestAccuracyDate: string | null;
  lastUpdated: string;
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

function StatTile(props: {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-xs text-slate-400">{props.label}</div>
      <div className="text-lg font-semibold text-slate-100">{props.value}</div>
      {props.subValue ? (
        <div className="mt-0.5 text-xs text-slate-400">{props.subValue}</div>
      ) : null}
    </div>
  );
}

export default function ProfileClient(props: {
  user: UserData;
  profile: ProfileData;
  stats: LongTermStats;
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
  const [passwordCurrentPassword, setPasswordCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

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
    setEditingPassword(true);
  }

  function cancelPasswordEdit() {
    setEditingPassword(false);
    setPasswordCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  }

  async function onSavePassword() {
    if (busy !== null) return;

    const next = newPassword;
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

    if (next !== confirmNewPassword) {
      showAlert("Passwords do not match", "error");
      return;
    }

    if (props.user.hasPassword && !passwordCurrentPassword) {
      showAlert("Please enter your current password", "error");
      return;
    }

    setBusy("password");
    try {
      const res = await fetch("/api/user/password", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(props.user.hasPassword ? { currentPassword: passwordCurrentPassword } : {}),
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
    // Prefer createImageBitmap when available.
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
    <div className="space-y-6">
      <Card className="border-white/10 bg-white/5 backdrop-blur">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div
                  className={
                    "rounded-full" +
                    (avatarError ? " ring-2 ring-red-500/50 ring-offset-2 ring-offset-slate-950" : "")
                  }
                >
                  <AvatarView url={avatarUrl} username={props.user.username} />
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy !== null}
                  aria-label="Change avatar"
                  className="absolute bottom-0 left-0 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-900/70 text-slate-100 shadow-sm backdrop-blur transition hover:bg-slate-900 disabled:opacity-60"
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

              </div>
              <div>
                <CardTitle className="text-slate-100">{props.user.username}</CardTitle>
                <CardDescription className="text-slate-300">{props.user.email}</CardDescription>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-300">Level</div>
              <div className="text-lg font-semibold text-slate-100">
                {props.profile.level}
              </div>
              <div className="mt-2 text-sm text-slate-300">Achievements</div>
              <div className="text-lg font-semibold text-slate-100">
                {props.profile.achievementsCount}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label className="text-slate-200" htmlFor="email">
                Email
              </Label>

              {!editingEmail ? (
                <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 sm:px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-100 sm:text-base">
                        {props.user.email}
                      </div>
                      <div className="mt-1 inline-flex flex-wrap items-center gap-2">
                        <span
                          className={
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium " +
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
                          <span className="text-[11px] text-slate-400">Verified {formatLocalDateTime(emailVerifiedAt)}</span>
                        ) : null}
                      </div>
                    </div>

                    <Button
                      type="button"
                      onClick={startEmailEdit}
                      disabled={busy !== null}
                      variant="outline"
                      size="sm"
                      className="border-white/10 bg-slate-900/70 text-slate-100 shadow-sm backdrop-blur hover:bg-slate-900"
                    >
                      Change
                    </Button>
                  </div>

                  {!isEmailVerified || hasPendingEmail ? (
                    <div className="pt-1 space-y-2">
                      <p className="text-xs text-slate-400">
                        Verification helps protect your account and enables secure email changes.
                      </p>
                    </div>
                  ) : null}

                  <VerifyEmailOtpDialog
                    open={otpDialogOpen}
                    onOpenChange={handleOtpDialogOpenChange}
                    destinationEmail={otpDialogDestinationEmail}
                    initialSentAt={otpDialogInitialSentAt}
                    onVerified={handleOtpVerified}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3 sm:p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      id="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      placeholder="name@example.com"
                      autoComplete="email"
                      className="sm:flex-1"
                    />
                    <div className="flex gap-2 sm:flex-none">
                      <Button
                        type="button"
                        onClick={onSaveEmail}
                        disabled={busy !== null || (!emailIsDirty && !hasPendingEmail)}
                        size="sm"
                      >
                        {busy === "email" ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={cancelEmailEdit}
                        disabled={busy !== null}
                        size="sm"
                      >
                        <X className="h-4 w-4" />
                        <span>Cancel</span>
                      </Button>
                    </div>
                  </div>

                  {props.user.hasPassword ? (
                    <div className="space-y-2">
                      <Label className="text-slate-200" htmlFor="currentPassword">
                        Current password
                      </Label>
                      <Input
                        id="currentPassword"
                        type="password"
                        value={emailCurrentPassword}
                        onChange={(e) => setEmailCurrentPassword(e.target.value)}
                        autoComplete="current-password"
                        placeholder="Required for email changes"
                      />
                      <p className="text-xs text-slate-400">
                        For security, we require your password before changing the email on password-based accounts.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-slate-200" htmlFor="username">
                Username
              </Label>
              {!editingUsername ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 sm:px-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-100 sm:text-lg">
                      {props.user.username}
                    </div>
                    <div className="text-xs text-slate-400">
                      Click edit to change your username
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={startUsernameEdit}
                    disabled={!canStartUsernameEdit}
                    variant="outline"
                    size="icon"
                    aria-label="Edit username"
                    className="rounded-full border-white/10 bg-slate-900/70 text-slate-100 shadow-sm backdrop-blur hover:bg-slate-900"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      ref={usernameInputRef}
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="your_username"
                      autoComplete="username"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (canSaveUsername) void onSaveUsername();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelUsernameEdit();
                        }
                      }}
                      className="sm:flex-1"
                    />
                    <div className="flex gap-2 sm:flex-none">
                      <Button
                        type="button"
                        onClick={onSaveUsername}
                        disabled={!canSaveUsername}
                        size="sm"
                      >
                        {busy === "username" ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={cancelUsernameEdit}
                        disabled={busy !== null}
                        size="sm"
                      >
                        <X className="h-4 w-4" />
                        <span>Cancel</span>
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">Letters, numbers, underscore. 3–20 chars. Press Enter to save, Esc to cancel.</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-slate-200" htmlFor="newPassword">
                Password
              </Label>

              {!editingPassword ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 sm:px-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-100 sm:text-lg">
                      {props.user.hasPassword ? "••••••••" : "No password set"}
                    </div>
                    <div className="text-xs text-slate-400">
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
                    className="rounded-full border-white/10 bg-slate-900/70 text-slate-100 shadow-sm backdrop-blur hover:bg-slate-900"
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3 sm:p-4">
                  {props.user.hasPassword ? (
                    <div className="space-y-2">
                      <Label className="text-slate-200" htmlFor="passwordCurrent">
                        Current password
                      </Label>
                      <div className="relative">
                        <Input
                          id="passwordCurrent"
                          type={showCurrentPassword ? "text" : "password"}
                          value={passwordCurrentPassword}
                          onChange={(e) => setPasswordCurrentPassword(e.target.value)}
                          autoComplete="current-password"
                          placeholder="Enter current password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrentPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition-colors hover:text-slate-100"
                          aria-label={showCurrentPassword ? "Hide current password" : "Show current password"}
                        >
                          {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label className="text-slate-200" htmlFor="newPassword">
                      New password
                    </Label>
                    <div className="relative">
                      <Input
                        id="newPassword"
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition-colors hover:text-slate-100"
                        aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                      >
                        {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-200" htmlFor="confirmNewPassword">
                      Confirm new password
                    </Label>
                    <div className="relative">
                      <Input
                        id="confirmNewPassword"
                        type={showConfirmNewPassword ? "text" : "password"}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmNewPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition-colors hover:text-slate-100"
                        aria-label={showConfirmNewPassword ? "Hide confirm password" : "Show confirm password"}
                      >
                        {showConfirmNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <Button
                      type="button"
                      onClick={onSavePassword}
                      disabled={busy !== null}
                      size="sm"
                    >
                      {busy === "password" ? "Saving…" : props.user.hasPassword ? "Update password" : "Set password"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={cancelPasswordEdit}
                      disabled={busy !== null}
                      size="sm"
                    >
                      <X className="h-4 w-4" />
                      <span>Cancel</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

        </CardContent>
      </Card>

      <AccountStatsChart stats={props.stats} />

      <Card className="border-white/10 bg-white/5 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-slate-100">Statistics</CardTitle>
          <CardDescription className="text-slate-300">Your typing performance analysis over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            <StatTile
              label="Time typed"
              value={formatDurationSeconds(props.stats.totalTimeTyped)}
              subValue={lastUpdatedAt ? `Updated ${formatLocalDateTime(lastUpdatedAt)}` : undefined}
            />
            <StatTile
              label="Total sessions"
              value={props.stats.totalSessions.toLocaleString()}
              subValue={props.stats.totalSessions === 0 ? "No sessions recorded yet" : undefined}
            />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <StatTile
              label="Best WPM"
              value={`${Math.round(props.stats.bestWPM)} WPM`}
              subValue={bestWpmAt ? formatLocalDateTime(bestWpmAt) : "—"}
            />
            <StatTile
              label="Best accuracy"
              value={`${Math.round(props.stats.bestAccuracy)}%`}
              subValue={bestAccuracyAt ? formatLocalDateTime(bestAccuracyAt) : "—"}
            />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <StatTile label="Avg WPM" value={`${Math.round(props.stats.averageWPM)} WPM`} />
            <StatTile label="Avg accuracy" value={`${Math.round(props.stats.averageAccuracy)}%`} />
            <StatTile label="Words typed" value={props.stats.totalWordsTyped.toLocaleString()} />
            <StatTile label="Characters typed" value={props.stats.totalCharactersTyped.toLocaleString()} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <StatTile label="Total mistakes" value={props.stats.totalMistakes.toLocaleString()} />
            <StatTile label="Total corrections" value={props.stats.totalCorrections.toLocaleString()} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
