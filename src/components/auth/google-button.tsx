"use client";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { google } from "@/assets";
import dynamic from "next/dynamic";
import { Loader } from "@/assets";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

type GoogleButtonProps = {
  isLogin: boolean;
  isSubmitting: boolean; // إضافة النوع
};

export const GoogleAuth = ({ 
  isLogin, 
  isSubmitting 
}: GoogleButtonProps) => {
  const handleGoogleSignIn = () => {
    // signIn("google"); // تفعيل الدالة
    
  };

  return (
    <Button
      variant="outline"
      type="button"
      onClick={handleGoogleSignIn}
      className="font-medium rounded-lg py-5 w-full border-[#69d0ff] hover:bg-[#69d0ff]/20 text-[#60a5fa] hover:text-[#93c5fd] transition-colors duration-300"
      disabled={isSubmitting} // تعطيل الزر أثناء التحميل
    >
      {isSubmitting ? (
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