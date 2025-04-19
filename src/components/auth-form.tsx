"use client";

import { useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { cn } from "@/lib/utils";
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
import Image from "next/image";
import { github, google } from "@/assets";
import { TextMorphButton } from "@/components/ui/text-morph-button";

export function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleToggle = () => {
    setIsTransitioning(true);
    setIsLogin(!isLogin);
    
    setTimeout(() => {
      setIsTransitioning(false);
    }, 500);  // Adjust the timeout to match the animation duration
  };


  const exclusiveAnim = {
    initial: { opacity: 0, x: -20, scale: 0.95 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: 20, scale: 0.95 },
    transition: { type: "spring", stiffness: 300, damping: 20 },
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
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
                    ? "Login with your GitHub or Google account"
                    : "Sign up with your GitHub or Google account"}
                </CardDescription>
              </motion.div>
            </CardHeader>

            <CardContent>
              <form>
                <div className="grid gap-6">
                  <motion.div layout className="flex flex-col gap-4">
                    {["GitHub", "Google"].map((provider, index) => (
                      <Button
                        key={provider}
                        variant="outline"
                        className={cn(
                          "font-medium rounded-lg py-5 w-full",
                          index === 0
                            ? "border-[#8A6BFF] hover:bg-[#8A6BFF]/20 text-[#818cf8] hover:text-[#a5b4fc]"
                            : "border-[#69d0ff] hover:bg-[#69d0ff]/20 text-[#60a5fa] hover:text-[#93c5fd]"
                        )}
                      >
                        <Image
                          src={index === 0 ? github : google}
                          alt={`${
                            isLogin ? "Login" : "Sign up"
                          } with ${provider}`}
                          width={20}
                          height={20}
                        />
                        <span className="ml-2">
                          {isLogin ? "Login" : "Sign up"} with {provider}
                        </span>
                      </Button>
                    ))}
                  </motion.div>

                  <motion.div
                    layout
                    className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-[#69d0ff]/30"
                  >
                    <span className="relative z-10 bg-[#1d1d37] rounded-md px-2 text-blue-200 font-semibold">
                      Or continue with
                    </span>
                  </motion.div>

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
                            type="text"
                            placeholder="john_doe"
                            className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                            required
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
                        type="email"
                        placeholder="m@example.com"
                        className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                        required
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
                        type="password"
                        className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                        required
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
                            type="password"
                            className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                            required
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
                      onClick={handleToggle} 
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
