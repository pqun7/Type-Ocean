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
        <Card className="bg-[#0a0a1f]/50 backdrop-blur-lg border border-[#ffffff15] shadow-xl relative overflow-hidden">
          <LayoutGroup>
            <CardHeader className="text-center">
              <motion.div
                layout
                className="flex flex-col items-center gap-4"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <div className="p-4 rounded-full bg-primary/10 backdrop-blur-sm scale-90">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <HiOutlineMail
                      className="text-primary w-12 h-12 drop-shadow-glow"
                      style={{
                        filter: "drop-shadow(0 0 8px rgba(105, 208, 255, 0.4))",
                      }}
                    />
                  </motion.div>
                </div>

                <CardTitle className="text-xl text-[#E0E7FF]">Verify your email</CardTitle>
                <CardDescription className="text-[#8A8FB5]">
                  Enter the 6-digit code sent to {maskEmail(props.destinationEmail)}
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
                  className="font-medium rounded-lg py-5 w-full border-[#fb923c] hover:bg-[#fb923c]/20 text-[#fb923c] hover:text-[#fed7aa] transition-colors duration-300"
                >
                  {isSending ? "Sending..." : cooldownRemaining > 0 ? `Resend in ${cooldownRemaining}s` : "Send / Resend Code"}
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
                        Verification Code
                      </Label>
                      <Input
                        id="code"
                        name="code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="123456"
                        className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff] tracking-widest text-center"
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
    <Button type="submit" className="py-5 btn-main" disabled={isPending}>
      {isPending ? <Lottie animationData={Loader} loop className="w-6 h-6" /> : "Verify"}
    </Button>
  );
}
