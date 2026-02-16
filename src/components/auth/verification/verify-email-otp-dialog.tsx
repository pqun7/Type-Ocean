"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { useAlert } from "@/contexts/alert-context";
import { requestEmailVerificationOtp } from "@/actions/email-verification-otp";
import { verifyEmailOtp } from "@/actions/verify-email-otp";
import { emailOtpErrorToMessage, maskEmail } from "@/components/auth/verification/email-otp-ui";

type VerifyState = { success: boolean; error: string | null };

const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyEmailOtpDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinationEmail: string;
  initialSentAt?: string | null;
  onVerified?: () => void;
}) {
  const { showAlert } = useAlert();
  const [isSending, startSending] = useTransition();

  const destinationMasked = useMemo(
    () => maskEmail(props.destinationEmail),
    [props.destinationEmail]
  );

  const [cooldownEndAtMs, setCooldownEndAtMs] = useState<number | null>(() => {
    if (!props.initialSentAt) return null;
    const sentAt = new Date(props.initialSentAt);
    const sentMs = sentAt.getTime();
    if (Number.isNaN(sentMs)) return null;
    return sentMs + RESEND_COOLDOWN_SECONDS * 1000;
  });

  const [cooldownRemaining, setCooldownRemaining] = useState<number>(() => {
    if (!cooldownEndAtMs) return 0;
    return Math.max(0, Math.ceil((cooldownEndAtMs - Date.now()) / 1000));
  });

  const [state, formAction, isPending] = useActionState<VerifyState, FormData>(
    verifyEmailOtp,
    { success: false, error: null }
  );

  const handledSuccessRef = useRef(false);

  useEffect(() => {
    if (!props.open) {
      handledSuccessRef.current = false;
    }
  }, [props.open]);

  useEffect(() => {
    if (state.error) {
      showAlert(emailOtpErrorToMessage(state.error), "error");
    }

    if (state.success && !handledSuccessRef.current) {
      handledSuccessRef.current = true;
      showAlert("Email updated successfully.", "success");
      props.onVerified?.();
      props.onOpenChange(false);
    }
  }, [state.error, state.success, showAlert, props.onOpenChange, props.onVerified]);

  useEffect(() => {
    if (!cooldownEndAtMs) {
      setCooldownRemaining(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((cooldownEndAtMs - Date.now()) / 1000)
      );
      setCooldownRemaining(remaining);
      if (remaining <= 0) setCooldownEndAtMs(null);
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [cooldownEndAtMs]);

  const resendDisabled = useMemo(
    () => isSending || cooldownRemaining > 0,
    [isSending, cooldownRemaining]
  );

  function startCooldown(seconds: number) {
    const s = Math.max(1, Math.floor(seconds));
    const end = Date.now() + s * 1000;
    setCooldownEndAtMs(end);
    setCooldownRemaining(s);
  }

  const handleSend = () => {
    startSending(async () => {
      const result = await requestEmailVerificationOtp();
      if (result.success) {
        showAlert("Verification code sent.", "success");
        startCooldown(RESEND_COOLDOWN_SECONDS);
        return;
      }

      if (result.error === "OTP_COOLDOWN" && "retryAfterSeconds" in result) {
        startCooldown(result.retryAfterSeconds);
        showAlert(
          `Please wait ${result.retryAfterSeconds}s before requesting a new code.`,
          "warning",
          { durationMs: 5000 }
        );
        return;
      }

      showAlert(emailOtpErrorToMessage(result.error), "error");
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="border-white/10 bg-slate-950/90 text-slate-100 backdrop-blur">
        <DialogHeader>
          <DialogTitle>Verify email</DialogTitle>
          <DialogDescription className="text-slate-300">
            Enter the 6-digit code sent to {destinationMasked}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button
            type="button"
            onClick={handleSend}
            disabled={resendDisabled}
            variant="outline"
            className="w-full border-white/10 bg-slate-900/70 text-slate-100 shadow-sm backdrop-blur hover:bg-slate-900"
          >
            {isSending
              ? "Sending…"
              : cooldownRemaining > 0
                ? `Resend in ${cooldownRemaining}s`
                : "Send / Resend code"}
          </Button>

          <form action={formAction} className="space-y-3">
            <input type="hidden" name="redirect" value="false" />

            <div className="grid gap-2">
              <Label htmlFor="otp-code" className="text-slate-200">
                Verification code
              </Label>
              <Input
                id="otp-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="tracking-widest text-center"
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.value = el.value.replace(/\D/g, "").slice(0, 6);
                }}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Verifying…" : "Verify"}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
