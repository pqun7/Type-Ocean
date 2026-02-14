"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { github } from "@/assets";
import dynamic from "next/dynamic";
import { Loader } from "@/assets";
import { useState } from "react"; // أضفنا استيراد useState
import { useAlert } from "@/contexts/alert-context";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

interface GithubAuthProps {
  isLogin?: boolean;
}

const GithubAuth = ({ isLogin = true }: GithubAuthProps) => {
  const [isLoading, setIsLoading] = useState(false); // حالة محلية للتحميل
  const { showAlert } = useAlert();

  const handleGithubSignIn = async () => {
    setIsLoading(true);
    try {
      await signIn("github", { callbackUrl: "/home?auth=success&provider=github" });
    } catch (error) {
      console.error("GitHub sign in error:", error);
      showAlert("GitHub sign in failed. Please try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      type="button"
      onClick={handleGithubSignIn}
      className="font-medium rounded-lg py-5 w-full border-[#8A6BFF] hover:bg-[#8A6BFF]/20 text-[#818cf8] hover:text-[#a5b4fc] transition-colors duration-300 group"
      disabled={isLoading} // استخدام الحالة المحلية
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
              src={github}
              alt={`${isLogin ? "Login" : "Sign up"} with GitHub`}
              width={20}
              height={20}
              className="mr-2 group-hover:scale-110 transition-transform"
            />
            <span>{isLogin ? "Login" : "Sign up"} with GitHub</span>
          </>
        )}
      </div>
    </Button>
  );
};

export { GithubAuth };