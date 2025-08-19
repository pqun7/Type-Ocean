"use client";

import { Button } from "@/components/ui/button";
import Image from "next/image";
import { google } from "@/assets";
import { useState } from "react";
import ClientOnly from "@/components/ui/ClientOnly";
import dynamic from "next/dynamic";

// Dynamically import Lottie with no SSR to prevent hydration issues
const Lottie = dynamic(
  () => import("lottie-react"),
  {
    ssr: false,
    loading: () => (
      <div className="w-6 h-6 animate-spin border-2 border-blue-500 border-t-transparent rounded-full" />
    ),
  }
);

type GoogleButtonProps = {
  isLogin: boolean;
};

export const GoogleAuth = ({ isLogin }: GoogleButtonProps) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    // setIsLoading(true);
    // try {
    //   await signIn("google");
    // } finally {
    //   setIsLoading(false);
    // }
  };

  return (
    <Button
      variant="outline"
      type="button"
      onClick={handleGoogleSignIn}
      className="font-medium rounded-lg py-5 w-full border-[#69d0ff] hover:bg-[#69d0ff]/20 text-[#60a5fa] hover:text-[#93c5fd] transition-colors duration-300"
      disabled={isLoading}
    >
      {isLoading ? (
        <ClientOnly
          fallback={
            <div className="w-6 h-6 animate-spin border-2 border-blue-500 border-t-transparent rounded-full" />
          }
        >
          <Lottie
            animationData={require("@/assets/animated-icon/Loader-dot-opacity.json")}
            loop
            className="w-6 h-6"
          />
        </ClientOnly>
      ) : (
        <>
          <Image
            src={google}
            alt={`${isLogin ? "Login" : "Sign up"} with Google`}
            width={20}
            height={20}
            className="filter saturate-150"
          />
          <span className="ml-2">
            {isLogin ? "Login" : "Sign up"} with Google
          </span>
        </>
      )}
    </Button>
  );
};