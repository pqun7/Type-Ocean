"use client";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";

export const SpaceBackground = ({
  gradientBackgroundStart = "rgb(5, 5, 15)", // Deep space start color
  gradientBackgroundEnd = "rgb(15, 10, 25)", // Complex gradient end color
  firstColor = "80, 120, 255", // Indigo blue
  secondColor = "180, 80, 255", // Light purple
  thirdColor = "255, 100, 200", // Pink for depth
  pointerColor = "200, 220, 255", // Light blue glow
  largeCircleColor = "200, 220, 255", // Soft glow
  size = "70%",
  blendingValue = "screen",
  children,
  className,
  interactive = true,
  containerClassName,
}: {
  gradientBackgroundStart?: string;
  gradientBackgroundEnd?: string;
  firstColor?: string;
  secondColor?: string;
  thirdColor?: string;
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

  // Set CSS variables
  useEffect(() => {
    document.body.style.setProperty("--gradient-background-start", gradientBackgroundStart);
    document.body.style.setProperty("--gradient-background-end", gradientBackgroundEnd);
    document.body.style.setProperty("--first-color", firstColor);
    document.body.style.setProperty("--second-color", secondColor);
    document.body.style.setProperty("--third-color", thirdColor);
    document.body.style.setProperty("--pointer-color", pointerColor);
    document.body.style.setProperty("--large-circle-color", largeCircleColor);
    document.body.style.setProperty("--size", size);
    document.body.style.setProperty("--blending-value", blendingValue);
  }, []);

  // Create stars
  useEffect(() => {
    const createStars = () => {
      const container = interactiveRef.current;
      if (container) {
        for (let i = 0; i < 150; i++) {
          const star = document.createElement("div");
          star.className = "star";
          star.style.left = `${Math.random() * 100}%`;
          star.style.top = `${Math.random() * 100}%`;
          star.style.animationDelay = `${Math.random() * 2}s`;
          container.appendChild(star);
        }
      }
    };

    createStars();
  }, []);

  // Handle mouse movement for interactivity
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
        "fixed inset-0 bg-[radial-gradient(at_center_20%_30%,_var(--gradient-background-start)_0%,_var(--gradient-background-end)_70%)] z-[-1]",
        "before:absolute before:inset-0 before:bg-[conic-gradient(from_230deg,_#3a2f7d,_#7159a3,_#bd93c6,_#7159a3,_#3a2f7d)] before:opacity-20 before:blur-2xl"
      )}
    >
     

      {/* Background Elements */}
      <div className="gradients-container absolute inset-0 overflow-hidden">
        {/* Stars */}
        <div ref={interactiveRef} className="stars-container absolute inset-0" />

        {/* Radial Glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_70%,_rgba(255,255,255,0.05)_0%,_transparent_40%)]" />

        {/* Animated Circles */}
        <div
          className={cn(
            `absolute [background:radial-gradient(circle_at_center,_rgba(var(--first-color),_transparent_70%)]`,
            `[mix-blend-mode:var(--blending-value)] w-[var(--size)] h-[var(--size)] top-1/4 left-1/4`,
            `animate-rotate-3d opacity-70`
          )}
        ></div>

        {/* Pink Glow */}
        <div
          className={cn(
            `absolute [background:radial-gradient(circle_at_center,_rgba(var(--third-color),_0.5),_transparent_80%)]`,
            `[mix-blend-mode:hard-light] w-[120%] h-[120%] -top-10 -left-10`,
            `animate-pulse-slow opacity-30`
          )}
        ></div>

      </div>

      {/* Global Styles */}
      <style jsx global>{`
        :root {
          --gradient-background-start: ${gradientBackgroundStart};
          --gradient-background-end: ${gradientBackgroundEnd};
          --first-color: ${firstColor};
          --second-color: ${secondColor};
          --third-color: ${thirdColor};
          --pointer-color: ${pointerColor};
          --large-circle-color: ${largeCircleColor};
          --size: ${size};
          --blending-value: ${blendingValue};
        }

        @keyframes glow {
          0%,
          100% {
            text-shadow: 0 0 20px rgba(100, 200, 255, 0.3);
          }
          50% {
            text-shadow: 0 0 40px rgba(100, 220, 255, 0.7);
          }
        }

        @keyframes shooting-star {
          from {
            transform: translateX(0) rotate(-45deg);
          }
          to {
            transform: translateX(100vw) rotate(-45deg);
          }
        }

        .star {
          position: absolute;
          width: 2px;
          height: 2px;
          background: white;
          border-radius: 50%;
          animation: twinkle 1.5s infinite;
        }

        @keyframes twinkle {
          0%,
          100% {
            opacity: 0.3;
          }
          50% {
            opacity: 1;
          }
        }

        .animate-glow {
          animation: glow 4s ease-in-out infinite;
        }

        .animate-shooting-star {
          animation: shooting-star 8s linear infinite;
        }

        .animate-rotate-3d {
          animation: rotate3d 25s linear infinite;
        }

        .animate-pulse-slow {
          animation: pulse-slow 10s ease-in-out infinite;
        }

        @keyframes rotate3d {
          from {
            transform: rotate(0deg) scale(1);
          }
          to {
            transform: rotate(360deg) scale(1.2);
          }
        }

        @keyframes pulse-slow {
          0%,
          100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.1);
          }
        }
      `}</style>
    </div>
  );
};