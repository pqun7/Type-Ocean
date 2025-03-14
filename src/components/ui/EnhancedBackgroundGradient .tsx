"use client";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

export const EnhancedBackgroundGradient = ({
  gradientBackgroundStart = "rgb(30, 70, 100)",
  gradientBackgroundEnd = "rgb(10, 30, 50)",
  firstColor = "80, 60, 190",
  secondColor = "140, 200, 240",
  pointerColor = "120, 110, 230",
  largeCircleColor = "200, 240, 255",
  size = "70%",
  blendingValue = "soft-light",
  children,
  className,
  interactive = true,
  containerClassName,
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
    <div className={cn("relative h-full w-full overflow-hidden", containerClassName)}>
      {/* Mask layer */}
      <div className="absolute inset-0 bg-blue-300 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,white)] z-20" />
      
      {/* Background container */}
      <div className={cn(
        "absolute inset-0 bg-[linear-gradient(40deg,var(--gradient-background-start),var(--gradient-background-end))]",
        "z-10"
      )}>
        <div className={cn("relative z-30", className)}>{children}</div>
        
        <div className="absolute inset-0 gradients-container">
          {/* Enhanced first gradient */}
          <div
            className={cn(
              `absolute [background:radial-gradient(circle_at_center,rgba(var(--first-color),0.8)_0,rgba(var(--first-color),0)_65%)]`,
              `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] left-[calc(50%-var(--size)/2)]`,
              `animate-first opacity-90`
            )}
          />
          
          {/* Enhanced second gradient */}
          <div
            className={cn(
              `absolute [background:radial-gradient(circle_at_center,rgba(var(--second-color),0.8)_0,rgba(var(--second-color),0)_65%)]`,
              `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-[calc(50%-var(--size)/2)] right-[15%]`,
              `animate-fourth opacity-90`
            )}
          />
          
          {interactive && (
            <>
              {/* Enhanced interactive elements */}
              <div
                ref={interactiveRef}
                className={cn(
                  `absolute [background:radial-gradient(circle_at_center,rgba(var(--pointer-color),0.7)_0,rgba(var(--pointer-color),0)_70%)]`,
                  `[mix-blend-mode:var(--blending-value)] w-full h-full -top-1/2 -left-1/2`,
                  `opacity-80`
                )}
              />
              
              <div
                ref={largeCircleRef}
                className={cn(
                  `absolute [background:radial-gradient(circle_at_center,rgba(var(--large-circle-color),0.6)_0,rgba(var(--large-circle-color),0)_70%)]`,
                  `[mix-blend-mode:var(--blending-value)] w-[calc(var(--size)*1.8)] h-[calc(var(--size)*1.8)]`,
                  `opacity-70 blur-[100px] transition-transform duration-200 ease-out`
                )}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};