// components/github-button.tsx
"use client";

import { Button } from "@/components/ui/button";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { github } from "@/assets";
import dynamic from "next/dynamic";
import { AuthButton } from "@/components/ui/Buttons";

const GithubAuth = ({ isLogin = true }: { isLogin?: boolean }) => {
  const handleGithubSignIn = async () => {
    await signIn("github");
  };

  return (
    <AuthButton variant="github">
      {isLogin ? "Login" : "Sign up"} with GitHub
    </AuthButton>
    // <Button
    //   variant="outline"
    //   type="button"
    //   onClick={handleGithubSignIn}
    //   className="font-medium rounded-lg py-5 w-full border-[#8A6BFF] hover:bg-[#8A6BFF]/20 text-[#818cf8] hover:text-[#a5b4fc] transition-colors duration-300 group"
    // >
    //   <div className="flex items-center justify-center">
    //     <Image
    //       src={github}
    //       alt={`${isLogin ? "Login" : "Sign up"} with GitHub`}
    //       width={20}
    //       height={20}
    //       className="mr-2 group-hover:scale-110 transition-transform"
    //     />
    //     <span>{isLogin ? "Login" : "Sign up"} with GitHub</span>
    //   </div>
    // </Button>
  );
};

export { GithubAuth };
