// auth/verification/verify-email-otp-form (improved)
"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { motion, LayoutGroup } from "framer-motion";
import dynamic from "next/dynamic";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export function VerifyEmailOtpForm(props: { destinationEmail: string; initialSentAt?: string | null }) {
  const { showAlert } = useAlert();
  const [isSending, startSending] = useTransition();

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

  useEffect(() => {
    if (state.error) showAlert(emailOtpErrorToMessage(state.error), "error");
  }, [state.error, state.success, showAlert]);

  useEffect(() => {
    if (!cooldownEndAtMs) {
      setCooldownRemaining(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownEndAtMs - Date.now()) / 1000));
      setCooldownRemaining(remaining);
      if (remaining <= 0) setCooldownEndAtMs(null);
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [cooldownEndAtMs]);

  const resendDisabled = useMemo(() => isSending || cooldownRemaining > 0, [isSending, cooldownRemaining]);

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
      } else {
        if (result.error === "OTP_COOLDOWN" && "retryAfterSeconds" in result) {
          startCooldown(result.retryAfterSeconds);
          showAlert(`Please wait ${result.retryAfterSeconds}s before requesting a new code.`, "error");
          return;
        }

        showAlert(emailOtpErrorToMessage(result.error), "error");
      }
    });
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card className="relative overflow-hidden border border-[#ffffff15] bg-[#0a0a1f]/50 text-[#E0E7FF] shadow-xl backdrop-blur-lg">
          <LayoutGroup>
            <CardHeader className="text-center">
              <motion.div
                layout
                className="flex flex-col items-center gap-4"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <div className="scale-90 rounded-full bg-primary/10 p-4 backdrop-blur-sm">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <HiOutlineMail
                      className="h-12 w-12 text-primary drop-shadow-glow"
                      style={{
                        filter: "drop-shadow(0 0 8px rgba(105, 208, 255, 0.4))",
                      }}
                    />
                  </motion.div>
                </div>

                <CardTitle className="text-xl text-[#E0E7FF]">Verify your email</CardTitle>
                <CardDescription className="text-[#8A8FB5]">
                  Enter the 6-digit code sent to{" "}
                  <span className="font-medium text-[#69d0ff]">{maskEmail(props.destinationEmail)}</span>
                </CardDescription>
              </motion.div>
            </CardHeader>

            <CardContent>
              <div className="grid gap-4">
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
                    "Send / Resend code"
                  )}
                </Button>

                <form action={formAction}>
                  <div className="grid gap-6">
                    <motion.div
                      layout
                      className="grid gap-2"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Label htmlFor="code" className="text-[#E0E7FF]">
                        Verification code
                      </Label>
                      <Input
                        id="code"
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
                    </motion.div>

                    <SubmitButton isPending={isPending} />
                  </div>
                </form>
              </div>
            </CardContent>
          </LayoutGroup>
        </Card>
      </div>
    </div>
  );
}

function SubmitButton({ isPending }: { isPending: boolean }) {
  return (
    <Button type="submit" className="btn-main w-full py-5" disabled={isPending}>
      {isPending ? <Lottie animationData={Loader} loop className="h-6 w-6" /> : "Verify"}
    </Button>
  );
}