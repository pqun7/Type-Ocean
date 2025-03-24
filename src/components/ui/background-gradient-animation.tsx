"use client";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

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
  // containerClassName,
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

  useEffect(() => {
    // Set CSS variables for dynamic gradient and colors
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
  }, []);

  // gradientBackgroundStart,
  //   gradientBackgroundEnd,
  //   firstColor,
  //   secondColor,
  //   pointerColor,
  //   largeCircleColor,
  //   size,
  //   blendingValue,

  // Function to move the large circle based on mouse movement
  const handleMouseMove = (event: MouseEvent) => {
    if (largeCircleRef.current) {
      largeCircleRef.current.style.transform = `translate(${
        event.clientX - largeCircleRef.current.offsetWidth / 2
      }px, ${event.clientY - largeCircleRef.current.offsetHeight / 2}px)`;
    }
  };

  useEffect(() => {
    if (interactive) {
      window.addEventListener("mousemove", handleMouseMove);
      return () => window.removeEventListener("mousemove", handleMouseMove);
    }
  }, [interactive]);

  return (
    <div
  className={cn(
    "fixed inset-0 bg-[linear-gradient(40deg,var(--gradient-background-start),var(--gradient-background-end))] z-[-1]"
  )}
>


      <div className={cn("", className)}>{children}</div>
      <div className="w-full h-full gradients-container blur-lg">
        {/* First moving gradient circle */}
        <div
          className={cn(
            `absolute [background:radial-gradient(circle_at_center,_rgba(var(--first-color),_0.6)_0,_rgba(var(--first-color),_0)_50%)_no-repeat]`,
            `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] left-[calc(50%-var(--size)/2)]`,
            `animate-first opacity-80`
          )}
        ></div>
        {/* Second moving gradient circle */}
        <div
          className={cn(
            `absolute [background:radial-gradient(circle_at_center,_rgba(var(--second-color),_0.6)_0,_rgba(var(--second-color),_0)_50%)_no-repeat]`,
            `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] right-[10%]`,
            `animate-fourth opacity-80`
          )}
        ></div>
        {interactive && (
          <>
            {/* Pointer-following small circle */}
            <div
              ref={interactiveRef}
              className={cn(
                `absolute [background:radial-gradient(circle_at_center,_rgba(var(--pointer-color),_0.6)_0,_rgba(var(--pointer-color),_0)_50%)_no-repeat]`,
                `[mix-blend-mode:var(--blending-value)] w-full h-full -top-1/2 -left-1/2`,
                `opacity-60`
              )}
            ></div>
            {/* Large circle that smoothly follows the mouse */}
            <div
              ref={largeCircleRef}
              className={cn(
                `absolute [background:radial-gradient(circle_at_center,_rgba(var(--large-circle-color),_0.5)_0,_rgba(var(--large-circle-color),_0)_50%)_no-repeat]`,
                `[mix-blend-mode:var(--blending-value)] w-[calc(var(--size)*1.5)] h-[calc(var(--size)*1.5)]`,
                `opacity-50 blur-2xl transition-transform ease-out duration-300`
              )}
            ></div>
          </>
        )}
      </div>
      {/* <div className="absolute inset-0 bg-cyan-900/60 [mask-image:radial-gradient(ellipse_at_center,transparent_40%,white)] z-[-5]" /> */}

      
    </div>
  );
};
