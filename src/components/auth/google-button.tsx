"use client";
// components/auth/google-button.tsx
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { google } from "@/assets";

type GoogleButtonProps = {
  isLogin: boolean;
};

export const GoogleAuth = ({ isLogin }: GoogleButtonProps) => {
  const handleGoogleSignIn = () => {
    // إضافة منطق تسجيل الدخول بـ Google هنا
    // signIn('google')
  };

  return (
    <Button
      variant="outline"
      type="button" // Prevent default form submission
      onClick={handleGoogleSignIn}
      className="font-medium rounded-lg py-5 w-full border-[#69d0ff] hover:bg-[#69d0ff]/20 text-[#60a5fa] hover:text-[#93c5fd] transition-colors duration-300"
    >
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
    </Button>
  );
};