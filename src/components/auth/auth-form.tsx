// components/auth/auth-form.tsx
"use client";

// Import core React and animation libraries
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";

import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

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
  const formRef = useRef<HTMLFormElement>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isTransitioning) {
      const timer = setTimeout(() => {
        setIsTransitioning(false);
      }, 5000); // تغيير الوقت إلى 500 مللي ثانية
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
        setSuccessMessage("Account created successfully.");
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
      return;
    }

    try {
      if (isLogin && formData.get("username") && formData.get("password")) {
        const res = await signIn("credentials", {
          redirect: false,
          username: formData.get("username"),
          password: formData.get("password"),
        });
  
        console.log("SIGN IN RESPONSE:", res);
  
        if (res?.error) {
          switch (res.error) {
            case "USER_NOT_FOUND":
            case "INCORRECT_PASSWORD":
              setError("Invalid username or password.");
              break;
            case "NO_PASSWORD_SET":
              setError("This account does not have a password. Try signing in with GitHub or Google.");
              break;
            default:
              setError("Login failed");
          }
          console.error("[AuthForm] Login error:", res.error);
        } else {
          console.log("Login successful, redirecting...");
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
                  {/* {isLogin
                    ? "Enter your credentials to login"
                    : "Create a new account"} */}
                  {successMessage && (
                    <p className="text-green-400 text-sm mt-2">
                      {successMessage}
                    </p>
                  )}

                  {error && (
                    <p className="text-red-400 text-sm mt-2">{error}</p>
                  )}
                </CardDescription>
              </motion.div>
            </CardHeader>
            <CardContent>
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
                          {fieldErrors.confirmPassword?.map((msg, i) => (
                            <p key={i} className="text-red-400 text-sm mt-1">
                              {msg}
                            </p>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <motion.div layout>
                      <Button
                        disabled={isSubmitting}
                        className="font-medium rounded-lg py-5 w-full border-2 border-[#69d0ff]/60 hover:border-[#69d0ff] bg-[#69d0ff]/10 hover:bg-[#69d0ff]/20 text-[#69d0ff] hover:text-[#b3e9ff] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#69d0ff] focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a0a1f]/50"
                      >
                        {isSubmitting ? (
                          <Lottie
                            animationData={Loader}
                            loop
                            className="w-15 h-15"
                          />
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
