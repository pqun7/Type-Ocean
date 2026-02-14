// components/auth/reset-password-form.tsx
"use client";

import { motion, LayoutGroup } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { updatePassword, PasswordState } from "@/actions/reset-password";
import { Loader } from "@/assets";
import dynamic from "next/dynamic";
import { useEffect, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { HiOutlineLockClosed } from "react-icons/hi";
import { useAlert } from "@/contexts/alert-context";
import { Eye, EyeOff } from "lucide-react";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { showAlert } = useAlert();

  const [state, formAction, isPending] = useActionState<PasswordState, FormData>(
    updatePassword,
    {
      success: false,
      error: null,
    }
  );
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (state.success) {
      setTimeout(() => {
        router.push("/auth?login");
      }, 3000);
    }
  }, [state.success]);

  if (!token) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 text-red-500">
        <Card className="bg-[#0a0a1f]/50 backdrop-blur-lg border border-[#ffffff15] shadow-xl">
          <CardHeader className="text-center">
            Invalid reset link. Please request a new password reset.
          </CardHeader>
        </Card>
      </div>
    );
  }

  useEffect(() => {
    if (state.error) showAlert(state.error, "error");
    if (state.success) showAlert("Password updated successfully", "success");
  }, [state]);

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
                    <HiOutlineLockClosed
                      className="text-primary w-12 h-12 drop-shadow-glow"
                      style={{
                        filter: "drop-shadow(0 0 8px rgba(105, 208, 255, 0.4))",
                      }}
                    />
                  </motion.div>
                </div>

                <CardTitle className="text-xl text-[#E0E7FF]">
                  Set New Password
                </CardTitle>
                <CardDescription className="text-[#8A8FB5]">
                  {state.success
                    ? "Password updated successfully!"
                    : "Please enter your new password"}
                </CardDescription>
              </motion.div>
            </CardHeader>

            {!state.success && (
              <CardContent>
                <form action={formAction}>
                  <div className="grid gap-6">
                    <input
                      type="hidden"
                      name="token"
                      value={encodeURIComponent(token)}
                    />

                    <motion.div
                      layout
                      className="grid gap-2"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Label htmlFor="password" className="text-[#E0E7FF]">
                        New Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          required
                          minLength={8}
                          className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff] pr-10"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#E0E7FF]/70 hover:text-[#69d0ff] transition-colors"
                        >
                          {showPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                    </motion.div>

                    <motion.div
                      layout
                      className="grid gap-2"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: 0.1 }}
                    >
                      <Label
                        htmlFor="confirmPassword"
                        className="text-[#E0E7FF]"
                      >
                        Confirm Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="confirmPassword"
                          name="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          required
                          minLength={8}
                          className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff] pr-10"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowConfirmPassword(!showConfirmPassword)
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#E0E7FF]/70 hover:text-[#69d0ff] transition-colors"
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>
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
                      transition={{ duration: 0.2, delay: 0.2 }}
                    >
                      <SubmitButton isPending={isPending} />
                      </motion.div>
                  </div>
                </form>
              </CardContent>
            )}

            {state.success && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="pb-6"
              >
                <Button asChild className="w-full mx-4 btn-main">
                  <Link href="/auth">Log in Now</Link>
                </Button>
              </motion.div>
            )}
          </LayoutGroup>
        </Card>
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
