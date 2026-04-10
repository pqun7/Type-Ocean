"use client";

import { useActionState, useEffect } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
Card,
CardContent,
CardDescription,
CardHeader,
CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HiOutlineMail } from "react-icons/hi";
import Link from "next/link";
import { resetPassword, PasswordState } from "@/actions/reset-password";
import { Loader } from "@/assets";
import dynamic from "next/dynamic";

import { useAlert } from "@/contexts/alert-context";


const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

export function ForgotPasswordForm() {
const [state, formAction, isPending] = useActionState<
  PasswordState,
  FormData
>(resetPassword, {
  success: false,
  error: null,
});
const { showAlert } = useAlert();

useEffect(() => {
  if (state.error) showAlert(state.error, "error");
  if (state.success)
    showAlert(
      "If the email exists, you will receive a reset link.",
      "success"
    );
}, [state, showAlert]);

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

              <CardTitle className="text-xl text-[#E0E7FF]">
                Reset your password
              </CardTitle>
              <CardDescription className="text-[#8A8FB5]">
                {state.success
                  ? "A reset link has been sent to your email"
                  : "Enter your email to receive a reset link"}
              </CardDescription>
            </motion.div>
          </CardHeader>

          {!state.success && (
            <CardContent>
              <form action={formAction}>
                <div className="grid gap-6">
                  <motion.div
                    layout
                    className="grid gap-2"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Label htmlFor="email" className="text-[#E0E7FF]">
                      Email
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="m@example.com"
                      className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                      required
                    />
                  </motion.div>

                  {/* {state.error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3 }}
                      className="text-sm text-red-400 text-center p-2 rounded-md bg-red-500/10 border border-red-400/20"
                    >
                      <span role="alert">{state.error}</span>
                    </motion.div>
                  )} */}

                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.1 }}
                  >
                    <SubmitButton isPending={isPending} />
                  </motion.div>
                </div>
              </form>
            </CardContent>
          )}
        </LayoutGroup>
      </Card>

      <motion.div
        className="text-center text-sm text-[#8A8FB5]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        Remember your password?{" "}
        <Link
          href="/auth?login"
          className="text-[#69d0ff] hover:text-[#8A6BFF] underline underline-offset-4"
        >
          Back to Login
        </Link>
      </motion.div>
    </div>
  </div>
);
}

function SubmitButton({ isPending }: { isPending: boolean }) {
const pending = isPending;

return (
  <Button type="submit" className="py-5 btn-main" disabled={pending}>
    {pending ? (
      <Lottie animationData={Loader} loop className="w-6 h-6" />
    ) : (
      "Reset Password"
    )}
  </Button>
);
}
