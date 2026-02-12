"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { google, Loader } from "@/assets"; // تأكد من أن Loader مُصدر من "@/assets"
import dynamic from "next/dynamic";
import { useState } from "react";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

type GoogleAuthProps = {
  isLogin?: boolean;
};

const GoogleAuth = ({ isLogin = true }: GoogleAuthProps) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      await signIn("google");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      type="button"
      onClick={handleGoogleSignIn}
      className="font-medium rounded-lg py-5 w-full border-[#69d0ff] hover:bg-[#69d0ff]/20 text-[#60a5fa] hover:text-[#93c5fd] transition-colors duration-300 group"
      disabled={isLoading}
    >
      <div className="flex items-center justify-center">
        {isLoading ? (
          <Lottie 
            animationData={Loader} 
            loop 
            className="w-6 h-6"
          />
        ) : (
          <>
            <Image
              src={google}
              alt={`${isLogin ? "Login" : "Sign up"} with Google`}
              width={20}
              height={20}
              className="mr-2 group-hover:scale-110 transition-transform"
            />
            <span>{isLogin ? "Login" : "Sign up"} with Google</span>
          </>
        )}
      </div>
    </Button>
  );
};

export { GoogleAuth };