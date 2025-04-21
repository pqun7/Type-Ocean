// components/auth/auth-form.tsx
"use client"; // Next.js client component directive

// Import core React and animation libraries
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";

import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";

// Import custom UI components and styles
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Import icons and assets
import { GithubAuth } from "@/components/auth/github-button";
import { GoogleAuth } from "@/components/auth/google-button";

// Import assets and custom components
import { TextMorphButton } from "@/components/ui/text-morph-button";

// Import server actions
import { signUp } from "@/lib/actioins";
import { signIn } from "next-auth/react";

/**
 * Authentication form component handling both login and signup states
 * with animated transitions between form states.
 */
export function AuthForm() {
  // State management
  const router = useRouter();

  const [isTransitioning, setIsTransitioning] = useState(false);
  const searchParams = useSearchParams();
  const formParam = searchParams.get("form");
  const [isLogin, setIsLogin] = useState(formParam === "signup" ? false : true);
  const [error, setError] = useState<string>("");

  // Toggle between login/signup views with animation handling
  const handleToggle = () => {
    setIsTransitioning(true);
    setIsLogin(!isLogin);
  };

  const handleSignup = async (formData: FormData) => {
    try {
      const result = await signUp(formData);
      if (result?.success) {
        setIsLogin(true); // تبديل إلى وضع تسجيل الدخول
        setError("");
      } else {
        setError(result?.error || "error occurred during signup");
      }
    } catch (err) {
      setError("An error occurred ");
    }
  };

  // Animation configuration for exclusive elements (username/confirm password)
  const exclusiveAnim = {
    initial: { opacity: 0, x: -20, scale: 0.95 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: 20, scale: 0.95 },
    transition: { type: "spring", stiffness: 300, damping: 20 },
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card className="bg-[#0a0a1f]/50 backdrop-blur-lg border border-[#ffffff15] shadow-xl relative overflow-hidden">
          <LayoutGroup>
            <CardHeader className="text-center">
              <motion.div layout>
                <CardTitle className="text-xl text-[#E0E7FF]">
                  {isLogin ? "Welcome back" : "Create an account"}
                </CardTitle>
                <CardDescription className="text-[#8A8FB5]">
                  {isLogin
                    ? "Enter your credentials to login"
                    : "Create a new account"}
                </CardDescription>
              </motion.div>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  if (isLogin) {
                    const res = await signIn("credentials", {
                      redirect: false,
                      email: formData.get("email"),
                      password: formData.get("password"),
                    });

                    if (res?.ok) {
                      router.push("/chack-auth"); 
                    } else {
                      console.error("Login failed");
                    }
                  } else {
                    await handleSignup(formData); 
                  }
                }}
                action={
                  isLogin
                    ? undefined
                    : async (formData: FormData) => {
                        await signUp(formData);
                      }
                } // Use server action for signup
              >
                <div className="grid gap-6">
                  <div className="grid gap-6">
                    <AnimatePresence mode="popLayout">
                      {!isLogin && (
                        <motion.div
                          key="username"
                          {...exclusiveAnim}
                          className="grid gap-2"
                        >
                          <Label htmlFor="username" className="text-[#E0E7FF]">
                            Username
                          </Label>
                          <Input
                            id="username"
                            name="username"
                            type="text"
                            placeholder="john_doe"
                            className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                            required
                            autoComplete="username"
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <motion.div layout className="grid gap-2">
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
                        autoComplete="email"
                      />
                    </motion.div>

                    <motion.div layout className="grid gap-2">
                      <div className="flex items-center">
                        <Label htmlFor="password" className="text-[#E0E7FF]">
                          Password
                        </Label>
                        {isLogin && (
                          <a
                            href="/password"
                            className="ml-auto text-sm text-[#69d0ff] hover:text-[#8A6BFF] underline-offset-4"
                          >
                            Forgot password?
                          </a>
                        )}
                      </div>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                        required
                        autoComplete={
                          isLogin ? "current-password" : "new-password"
                        }
                      />
                    </motion.div>

                    <AnimatePresence mode="popLayout">
                      {!isLogin && (
                        <motion.div
                          key="confirmPassword"
                          {...exclusiveAnim}
                          className="grid gap-2"
                        >
                          <Label
                            htmlFor="confirmPassword"
                            className="text-[#E0E7FF]"
                          >
                            Confirm Password
                          </Label>
                          <Input
                            id="confirmPassword"
                            name="confirmPassword"
                            type="password"
                            className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                            required
                            autoComplete="new-password"
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <motion.div layout>
                      <TextMorphButton
                        from={isLogin ? "Login" : "Sign up"}
                        to="Confirm"
                        disableMorph={isTransitioning}
                        className="font-medium rounded-lg py-5 w-full border-2 border-[#69d0ff]/60 hover:border-[#69d0ff] bg-[#69d0ff]/10 hover:bg-[#69d0ff]/20 text-[#69d0ff] hover:text-[#b3e9ff] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#69d0ff] focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a0a1f]/50"
                      />
                    </motion.div>
                  </div>

                  <motion.div
                    layout
                    className="text-center text-sm text-[#8A8FB5]"
                  >
                    {isLogin
                      ? "Don't have an account? "
                      : "Already have an account? "}
                    <button
                      type="button"
                      onClick={() => {
                        handleToggle();
                        setIsTransitioning(false);
                      }}
                      className="text-[#69d0ff] hover:text-[#8A6BFF] underline underline-offset-4 cursor-pointer"
                    >
                      {isLogin ? "Sign up" : "Login"}
                    </button>
                  </motion.div>
                </div>
              </form>

              <motion.div
                layout
                className="relative my-6 text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-[#69d0ff]/30"
              >
                <span className="relative z-10 bg-[#1d1d37] rounded-md px-2 text-blue-200 font-semibold">
                  Or continue with
                </span>
              </motion.div>

              <motion.div layout className="flex flex-col gap-4">
                <GithubAuth isLogin={isLogin} />
                <GoogleAuth isLogin={isLogin} />
              </motion.div>
            </CardContent>
          </LayoutGroup>
        </Card>
      </div>
    </div>
  );
}
