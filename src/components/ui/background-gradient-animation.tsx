"use client";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import ClientOnly from "./ClientOnly";

export const BackgroundGradientAnimation = ({
  gradientBackgroundStart = "rgb(30, 70, 100)",
  gradientBackgroundEnd = "rgb(10, 30, 50)",
  firstColor = "80, 60, 190",
  secondColor = "140, 200, 240",
  pointerColor = "120, 110, 230",
  largeCircleColor = "200, 240, 255",
  size = "60%",
  blendingValue = "soft-light",
  children,
  className,
  interactive = true,
}: {
  gradientBackgroundStart?: string;
  gradientBackgroundEnd?: string;
  firstColor?: string;
  secondColor?: string;
  pointerColor?: string;
  largeCircleColor?: string;
  size?: string;
  blendingValue?: string;
  children?: React.ReactNode;
  className?: string;
  interactive?: boolean;
  containerClassName?: string;
}) => {
  const interactiveRef = useRef<HTMLDivElement>(null);
  const largeCircleRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Only set CSS variables after mount to prevent hydration mismatch
    if (typeof window !== "undefined") {
      document.body.style.setProperty(
        "--gradient-background-start",
        gradientBackgroundStart
      );
      document.body.style.setProperty(
        "--gradient-background-end",
        gradientBackgroundEnd
      );
      document.body.style.setProperty("--first-color", firstColor);
      document.body.style.setProperty("--second-color", secondColor);
      document.body.style.setProperty("--pointer-color", pointerColor);
      document.body.style.setProperty("--large-circle-color", largeCircleColor);
      document.body.style.setProperty("--size", size);
      document.body.style.setProperty("--blending-value", blendingValue);
    }
  }, [
    gradientBackgroundStart,
    gradientBackgroundEnd,
    firstColor,
    secondColor,
    pointerColor,
    largeCircleColor,
    size,
    blendingValue,
  ]);

  // Function to move the large circle based on mouse movement
  const handleMouseMove = (event: MouseEvent) => {
    if (!mounted || !interactive) return;

    const largeCircle = largeCircleRef.current;
    if (largeCircle) {
      const rect = largeCircle.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      largeCircle.style.transform = `translate(${x}px, ${y}px)`;
    }
  };

  useEffect(() => {
    if (!mounted || !interactive) return;

    const interactiveElement = interactiveRef.current;
    if (interactiveElement) {
      interactiveElement.addEventListener("mousemove", handleMouseMove);
      return () => {
        interactiveElement.removeEventListener("mousemove", handleMouseMove);
      };
    }
  }, [interactive, mounted]);

  return (
    <ClientOnly>
      <div
        className={cn(
          "h-screen w-screen relative overflow-hidden top-0 left-0",
          className
        )}
        ref={interactiveRef}
      >
        <svg className="hidden">
          <defs>
            <filter id="blurMe">
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="10"
                result="blur"
              />
              <feColorMatrix
                in="blur"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
                result="goo"
              />
              <feBlend in="SourceGraphic" in2="goo" />
            </filter>
          </defs>
        </svg>
        <div className="gradients-container h-full w-full blur-lg">
          <div
            className={cn(
              `absolute [background:radial-gradient(circle_at_center,_var(--first-color)_0,_var(--first-color)_50%)_no-repeat]`,
              `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] left-[calc(50%-var(--size)/2)]`,
              `[transform-origin:center_center]`,
              `animate-first`,
              `opacity-100`
            )}
          ></div>
          <div
            className={cn(
              `absolute [background:radial-gradient(circle_at_center,_rgba(var(--second-color),_0.8)_0,_rgba(var(--second-color),_0)_50%)_no-repeat]`,
              `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] left-[calc(50%-var(--size)/2)]`,
              `[transform-origin:calc(50%-400px)]`,
              `animate-second`,
              `opacity-100`
            )}
          ></div>
          <div
            className={cn(
              `absolute [background:radial-gradient(circle_at_center,_rgba(var(--third-color),_0.8)_0,_rgba(var(--third-color),_0)_50%)_no-repeat]`,
              `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] left-[calc(50%-var(--size)/2)]`,
              `[transform-origin:calc(50%+400px)]`,
              `animate-third`,
              `opacity-100`
            )}
          ></div>
          <div
            className={cn(
              `absolute [background:radial-gradient(circle_at_center,_rgba(var(--fourth-color),_0.8)_0,_rgba(var(--fourth-color),_0)_50%)_no-repeat]`,
              `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] left-[calc(50%-var(--size)/2)]`,
              `[transform-origin:calc(50%-200px)]`,
              `animate-fourth`,
              `opacity-70`
            )}
          ></div>
          <div
            className={cn(
              `absolute [background:radial-gradient(circle_at_center,_rgba(var(--fifth-color),_0.8)_0,_rgba(var(--fifth-color),_0)_50%)_no-repeat]`,
              `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] left-[calc(50%-var(--size)/2)]`,
              `[transform-origin:calc(50%-800px)_calc(50%+800px)]`,
              `animate-fifth`,
              `opacity-100`
            )}
          ></div>

          {interactive && (
            <div
              ref={largeCircleRef}
              className={cn(
                `absolute [background:radial-gradient(circle_at_center,_rgba(var(--pointer-color),_0.8)_0,_rgba(var(--pointer-color),_0)_50%)_no-repeat]`,
                `[mix-blend-mode:var(--blending-value)] w-full h-full -top-1/2 -left-1/2`,
                `opacity-70`
              )}
            ></div>
          )}
        </div>
        {children}
      </div>
    </ClientOnly>
  );
};
