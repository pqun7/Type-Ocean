// components/auth/auth-form.tsx
"use client";

// Import core React and animation libraries
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";

import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ClientOnly from "@/components/ui/ClientOnly";

// Dynamically import Lottie with no SSR to prevent hydration issues
const Lottie = dynamic(() => import("lottie-react"), {
  ssr: false,
  loading: () => (
    <div className="w-6 h-6 animate-spin border-2 border-blue-500 border-t-transparent rounded-full" />
  ),
});

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
import { Loader } from "@/assets";
import { Button } from "@/components/ui/button";

// Import icons and assets
import { GithubAuth } from "@/components/auth/github-button";
import { GoogleAuth } from "@/components/auth/google-button";
import { Eye, EyeOff } from "lucide-react";

// Import server actions
import { signUp } from "@/features/auth/lib/actions";
import { signIn } from "next-auth/react";
import { useAlert } from "@/contexts/alert-context";

/**
 * Authentication form component handling both login and signup states
 * with animated transitions between form states.
 */
export function AuthForm() {
  // State management
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const searchParams = useSearchParams();
  const formParam = searchParams.get("form");
  const [isLogin, setIsLogin] = useState(true); // Default to prevent hydration mismatch
  const [error, setError] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showAlert } = useAlert();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Prevent hydration mismatch by only reading search params after mount
  useEffect(() => {
    setMounted(true);
    if (formParam === "signup") {
      setIsLogin(false);
    }
  }, [formParam]);

  useEffect(() => {
    if (error) showAlert(error, "error");
    if (successMessage) showAlert(successMessage, "success");
  }, [error, successMessage, showAlert]);

  // Handle form submission state
  useEffect(() => {
    if (isTransitioning) {
      const timer = setTimeout(() => {
        setIsTransitioning(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isTransitioning]);

  // Toggle between login/signup views with animation handling
  const handleToggle = () => {
    setIsTransitioning(true);
    setIsLogin(!isLogin);
    setFieldErrors({});
    setError("");
    setSuccessMessage("");
  };

  const handleSignup = async (formData: FormData) => {
    try {
      const result = await signUp(formData);

      if (result?.success) {
        formRef.current?.reset();
        setIsLogin(true);
        setError("");
        // setSuccessMessage("Account created successfully.");
        showAlert(
          "Account created successfully. Please check your email for verification.",
          "success"
        );
        setFieldErrors({});
      } else {
        if (result?.details?.fieldErrors) {
          setFieldErrors(
            result.details.fieldErrors as Record<string, string[]>
          );
          setError("");
        } else {
          setError(result?.error || "An error occurred during signup");
          setFieldErrors({});
        }
      }
    } catch (err) {
      setError("An unexpected error occurred");
      setFieldErrors({});
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    const formData = new FormData(e.currentTarget);

    e.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({}); // Reset field errors on submit
    setError(""); // Reset error message on submit
    setSuccessMessage(""); // Reset success message on submit

    // Validate required fields
    if (!formData.get("username") || !formData.get("password")) {
      setError("Please fill in all fields");
      setIsSubmitting(false);
      return;
    }
    try {
      if (isLogin) {
        const res = await signIn("credentials", {
          redirect: false,
          username: formData.get("username"),
          password: formData.get("password"),
        });

        if (res?.error) {
          // Generic error message to prevent user enumeration
          const errorMessage = "Invalid username or password.";
          setError(errorMessage);
        } else {
          router.push("/auth");
        }
      } else {
        await handleSignup(formData);
      }
    } catch (err) {
      setError("An unexpected error occurred");
      console.error("[AuthForm] Submission error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Animation configuration for exclusive elements (username/confirm password)
  const exclusiveAnim = {
    initial: { opacity: 0, x: -20, scale: 0.95 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: 20, scale: 0.95 },
    transition: { type: "spring", stiffness: 300, damping: 20 },
  };

  // Don't render form content until mounted to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-4 md:p-6">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <Card className="bg-[#0a0a1f]/50 backdrop-blur-lg border border-[#ffffff15] shadow-xl relative overflow-hidden">
            <CardHeader className="text-center">
              <div className="flex flex-col items-center gap-4 animate-pulse">
                <div className="w-16 h-16 bg-gray-700 rounded-full"></div>
                <div className="w-32 h-6 bg-gray-700 rounded"></div>
                <div className="w-48 h-4 bg-gray-700 rounded"></div>
              </div>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

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
                    ? "Please enter your credentials to access your account."
                    : "Fill in your details to create your account and get started."}
                </CardDescription>
              </motion.div>
            </CardHeader>
            <CardContent className="space-y-4">
              <motion.div layout className="flex flex-col gap-4">
                <GithubAuth isLogin={isLogin} />
                <GoogleAuth isLogin={isLogin} />
              </motion.div>
              <motion.div
                layout
                className="relative my-6 text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-[#69d0ff]/30"
              >
                <span className="relative z-10 bg-[#1d1d37] rounded-md px-2 text-blue-200 font-semibold">
                  Or continue with
                </span>
              </motion.div>
              <form ref={formRef} onSubmit={handleSubmit}>
                <div className="grid gap-6">
                  <div className="grid gap-6">
                    <motion.div key="username" className="grid gap-2">
                      <Input
                        id="username"
                        name="username"
                        type="text"
                        placeholder="Username"
                        className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                        required
                        autoComplete="username"
                      />
                      {fieldErrors.username?.map((msg, i) => (
                        <p key={i} className="text-red-400 text-sm mt-1">
                          {msg}
                        </p>
                      ))}
                    </motion.div>
                    {!isLogin && (
                      <AnimatePresence mode="popLayout">
                        <motion.div
                          layout
                          className="grid gap-2"
                          key="email"
                          {...exclusiveAnim}
                        >
                          <Input
                            id="email"
                            name="email"
                            type="email"
                            placeholder="Email"
                            className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                            required
                            autoComplete="email"
                          />
                          {fieldErrors.email?.map((msg, i) => (
                            <p key={i} className="text-red-400 text-sm mt-1">
                              {msg}
                            </p>
                          ))}
                        </motion.div>
                      </AnimatePresence>
                    )}
                    <motion.div layout className="grid gap-2">
                      <div className="flex items-center">
                        {isLogin && (
                          <a
                            href="/forgot-password"
                            className="ml-auto text-sm text-[#69d0ff] hover:text-[#8A6BFF] underline-offset-4"
                          >
                            Forgot password?
                          </a>
                        )}
                      </div>
                      <div className="relative">
                        <Input
                          id="password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff] pr-10"
                          required
                          placeholder="Password"
                          autoComplete={
                            isLogin ? "current-password" : "new-password"
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#E0E7FF]/70 hover:text-[#69d0ff]"
                          aria-label={
                            showPassword ? "Hide password" : "Show password"
                          }
                        >
                          {showPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                      {fieldErrors.password?.map((msg, i) => (
                        <p key={i} className="text-red-400 text-sm mt-1">
                          {msg}
                        </p>
                      ))}
                    </motion.div>

                    <AnimatePresence mode="popLayout">
                      {!isLogin && (
                        <motion.div
                          key="confirmPassword"
                          {...exclusiveAnim}
                          className="grid gap-2"
                        >
                          <div className="relative">
                            <Input
                              id="confirmPassword"
                              name="confirmPassword"
                              placeholder="Confirm Password"
                              type={showConfirmPassword ? "text" : "password"}
                              className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff] pr-10"
                              required
                              autoComplete="new-password"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setShowConfirmPassword(!showConfirmPassword)
                              }
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#E0E7FF]/70 hover:text-[#69d0ff]"
                              aria-label={
                                showConfirmPassword
                                  ? "Hide password"
                                  : "Show password"
                              }
                            >
                              {showConfirmPassword ? (
                                <EyeOff className="h-5 w-5" />
                              ) : (
                                <Eye className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                          {fieldErrors.confirmPassword?.map((msg, i) => (
                            <p key={i} className="text-red-400 text-sm mt-1">
                              {msg}
                            </p>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <motion.div layout>
                      <Button disabled={isSubmitting} className="py-5 btn-main">
                        {isSubmitting ? (
                          <ClientOnly
                            fallback={
                              <div className="w-6 h-6 animate-spin border-2 border-white border-t-transparent rounded-full" />
                            }
                          >
                            <Lottie
                              animationData={Loader}
                              loop
                              className="w-6 h-6"
                            />
                          </ClientOnly>
                        ) : isLogin ? (
                          "Login"
                        ) : (
                          "Sign up"
                        )}
                      </Button>
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
            </CardContent>
          </LayoutGroup>
        </Card>
      </div>
    </div>
  );
}
