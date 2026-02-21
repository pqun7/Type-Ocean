// auth/verification/verify-email-otp-dialog (improved)
"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";

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
import { HiOutlineMail } from "react-icons/hi";
import { Loader } from "@/assets";

import { useAlert } from "@/contexts/alert-context";
import { requestEmailVerificationOtp } from "@/actions/email-verification-otp";
import { verifyEmailOtp } from "@/actions/verify-email-otp";
import { emailOtpErrorToMessage, maskEmail } from "@/components/auth/verification/email-otp-ui";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

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
      <AnimatePresence>
        {props.open && (
          <DialogContent
            className="border border-[#ffffff15] bg-[#0a0a1f]/90 text-[#E0E7FF] backdrop-blur-lg sm:max-w-md"
            forceMount
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <DialogHeader>
                <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 backdrop-blur-sm">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <HiOutlineMail
                      className="h-10 w-10 text-primary drop-shadow-glow"
                      style={{
                        filter: "drop-shadow(0 0 8px rgba(105, 208, 255, 0.4))",
                      }}
                    />
                  </motion.div>
                </div>
                <DialogTitle className="text-center text-xl text-[#E0E7FF]">
                  Verify your email
                </DialogTitle>
                <DialogDescription className="text-center text-[#8A8FB5]">
                  Enter the 6-digit code sent to <span className="font-medium text-[#69d0ff]">{destinationMasked}</span>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <Button
                  type="button"
                  onClick={handleSend}
                  disabled={resendDisabled}
                  variant="outline"
                  className="w-full rounded-lg border-[#fb923c] py-5 text-[#fb923c] transition-colors duration-300 hover:bg-[#fb923c]/20 hover:text-[#fed7aa] disabled:opacity-50"
                >
                  {isSending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Lottie animationData={Loader} loop className="h-5 w-5" />
                      Sending...
                    </span>
                  ) : cooldownRemaining > 0 ? (
                    `Resend in ${cooldownRemaining}s`
                  ) : (
                    "Resend code"
                  )}
                </Button>

                <form action={formAction} className="space-y-4">
                  <input type="hidden" name="redirect" value="false" />

                  <div className="grid gap-2">
                    <Label htmlFor="otp-code" className="text-[#E0E7FF]">
                      Verification code
                    </Label>
                    <Input
                      id="otp-code"
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="123456"
                      className="border-[#3A3A5F] bg-[#1D2B3A]/30 text-center tracking-widest text-[#E0E7FF] focus:border-[#69d0ff]"
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.value = el.value.replace(/\D/g, "").slice(0, 6);
                      }}
                      required
                    />
                  </div>

                  <Button type="submit" className="btn-main w-full py-5" disabled={isPending}>
                    {isPending ? (
                      <Lottie animationData={Loader} loop className="h-6 w-6" />
                    ) : (
                      "Verify"
                    )}
                  </Button>
                </form>
              </div>
            </motion.div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  );
}