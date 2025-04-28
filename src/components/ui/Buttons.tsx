// components/ui/Button.tsx
"use client";

import { HTMLMotionProps, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { ForwardRefExoticComponent, RefAttributes } from "react";
import { Loader } from "@/assets";

import { Magnetic } from "./magnetic";
import { HoverBorderGradient } from "./hover-border-gradient";
import { brainwaveSymbol } from "@/assets";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { github, google } from "@/assets";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });


export const Button1 = ({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) => {
  const pointerColor = "120, 110, 230";
  const secondColor = "140, 200, 240";

  return (
    <div className={`flex justify-center ${className}`}>
      <button
        onClick={onClick}
        className={`relative overflow-hidden w-full max-w-xs text-lg font-semibold 
          text-white transition-all duration-300 transform rounded-xl 
          backdrop-blur-lg border hover:scale-[1.02] group
          ${
            /* استخدام نفس أنماط الخلفية مثل البطاقات */
            "bg-[rgba(140,200,240,0.15)] border-[rgba(120,110,230,0.2)]"
          }`}
        style={{
          background: `linear-gradient(45deg, rgba(${pointerColor},0.1), rgba(${secondColor},0.1))`,
        }}
      >
        {/* تأثير التوهج عند hover */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div
            className="absolute w-[150%] h-[150%] -top-1/4 -left-1/4 bg-gradient-radial from-[rgba(140,200,240,0.4)] to-transparent"
            style={{ clipPath: "circle(25% at 50% 100%)" }}
          />
        </div>

        <div className="relative flex items-center justify-center space-x-2 z-10 py-3.5 px-6">
          <span className="text-gray-100 group-hover:text-white transition-colors">
            {children}
          </span>
        </div>

        <div className="absolute inset-0 rounded-xl border-[0.5px] border-white/10 pointer-events-none" />
      </button>
    </div>
  );
};

export const Button2 = ({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  customBorder?: string;
  customPaddingX?: number;
  customPaddingY?: number;
  className?: string;
}) => {
  const springOptions = { bounce: 0.1 };
  return (
    <Magnetic
      intensity={0.2}
      springOptions={springOptions}
      actionArea="global"
      range={120}
    >
      <div
        className={`relative inline-flex h-15 overflow-hidden rounded-full p-[2px] transition-all duration-300 ${className}`}
      >
        <HoverBorderGradient
          containerClassName="rounded-full"
          as="button" // This is the interactive button
          onClick={onClick} // Moved onClick here
          className="h-11 flex items-center space-x-2 rounded-full bg-n-7 px-6 py-1 text-sm font-medium text-[rgb(200,240,255)] backdrop-blur-3xl transition-all duration-300 hover:bg-n-6"
        >
          <AceternityLogo />
          <span>{children}</span>
        </HoverBorderGradient>
      </div>
    </Magnetic>
  );
};

const AceternityLogo = () => {
  return (
    <svg
      width="66"
      height="65"
      viewBox="0 0 66 65"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-3 w-3 text-white"
    >
      <path
        d="M8 8.05571C8 8.05571 54.9009 18.1782 57.8687 30.062C60.8365 41.9458 9.05432 57.4696 9.05432 57.4696"
        stroke="currentColor"
        strokeWidth="15"
        strokeMiterlimit="3.86874"
        strokeLinecap="round"
      />
    </svg>
  );
};


type ButtonColor = 
  | 'primary' 
  | 'secondary' 
  | 'accent' 
  | 'success' 
  | 'danger' 
  | 'warning'
  | 'github' 
  | 'google';

type ButtonProps = {
  variant?: "default" | "github" | "google";
  color1?: ButtonColor;
  color2?: ButtonColor;
  isLoading?: boolean;
  children?: React.ReactNode;
} & Omit<React.ComponentProps<typeof Button>, "variant">;

// خريطة الألوان (Color Map)
const colorMap: Record<ButtonColor, { base: string; hover: string }> = {
  primary: { base: 'sky-500', hover: 'sky-400' },
  secondary: { base: 'indigo-500', hover: 'indigo-400' },
  accent: { base: 'violet-500', hover: 'violet-400' },
  success: { base: 'emerald-500', hover: 'emerald-400' },
  danger: { base: 'rose-500', hover: 'rose-400' },
  warning: { base: 'amber-500', hover: 'amber-400' },
  github: { base: 'purple-500', hover: 'purple-400' },
  google: { base: 'blue-500', hover: 'blue-400' }
};

export const AuthButton = ({
  variant = "default",
  color1 = "primary",
  color2 = "primary",
  isLoading = false,
  children,
  ...props
}: ButtonProps) => {
  const baseStyles = `font-medium rounded-lg py-5 w-full border-2 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]`;

  const getVariantStyles = () => {
    switch (variant) {
      case "github":
        return `border-${colorMap.github.base}/60 hover:border-${colorMap.github.base} bg-${colorMap.github.base}/10 hover:bg-${colorMap.github.base}/20 text-${colorMap.github.base} hover:text-${colorMap.github.hover}`;
      case "google":
        return `border-${colorMap.google.base}/60 hover:border-${colorMap.google.base} bg-${colorMap.google.base}/10 hover:bg-${colorMap.google.base}/20 text-${colorMap.google.base} hover:text-${colorMap.google.hover}`;
      default:
        return `border-${colorMap[color1].base}/60 hover:border-${colorMap[color1].base} bg-${colorMap[color1].base}/10 hover:bg-${colorMap[color1].base}/20 text-${colorMap[color1].base} hover:text-${colorMap[color2].hover}`;
    }
  };

  return (
    <motion.div layout>
      <Button
        variant="default"
        {...props}
        className={`${baseStyles} ${getVariantStyles()} ${props.className}`}
      >
        {isLoading ? (
          <Lottie animationData={Loader} loop className="w-15 h-15" />
        ) : (
          <>
            {variant === "github" && (
              <div className="flex items-center justify-center">
                <Image
                  src={github}
                  alt="GitHub"
                  width={20}
                  height={20}
                  className="mr-2 group-hover:scale-110 transition-transform"
                />
                <span>{children}</span>
              </div>
            )}
            
            {variant === "google" && (
              <div className="flex items-center justify-center">
                <Image
                  src={google}
                  alt="Google"
                  width={20}
                  height={20}
                  className="filter saturate-150"
                />
                <span className="ml-2">{children}</span>
              </div>
            )}
            
            {variant === "default" && children}
          </>
        )}
      </Button>
    </motion.div>
  );
};

