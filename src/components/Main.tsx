"use client";
import { Button2 } from "@/components/ui/Buttons";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";

import { motion, MotionValue } from "framer-motion";
import { useRef } from "react";
import { useOptimizedScrollTransform } from "@/components/hooks/scrollHooks";
import { useRouter } from "next/navigation";
import HeaderGame from "@/components/Typing";

const HeroHeading = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const h1Y = useOptimizedScrollTransform(containerRef, [200, -200]);
  const h1Opacity = useOptimizedScrollTransform(containerRef, [0, 1.6]);
  const h1Scale = useOptimizedScrollTransform(containerRef, [0.8, 1.4]);
  const pScale = useOptimizedScrollTransform(containerRef, [0.8, 1.1]);
  const buttonTransform = useOptimizedScrollTransform(
    containerRef,
    [-160, 130]
  );
  const router = useRouter();

  return (
    <motion.div
      ref={containerRef}
      className="relative z-1 max-w-[62rem] mx-auto text-center text-[min(10vw,70px)] lg:mt-20"
      initial="hidden"
      viewport={{ once: true }}
    >

      <motion.h1
        style={{
          y: h1Y,
          opacity: h1Opacity,
          scale: h1Scale,
          willChange: "transform, opacity",
        }}
        className="mb-6 h1 mt-10 px-7"
      >
        Turn<span className="opacity-60 text-purple-200/50"> Your </span>Fingers
        <span className="opacity-60 text-purple-200/50"> into </span>Speed
        Machines!
      </motion.h1>

      <motion.p
        style={{
          scale: pScale,
          opacity: h1Opacity,
          willChange: "transform, opacity",
        }}
        className="max-w-3xl mx-auto mb-6 font-light body-1 text-n-2 lg:mb-8"
      >
        Type like a pro with easy, step-by-step training that helps you improve
        your speed and accuracy, no matter your starting level!
      </motion.p>

      <motion.div
        style={{ y: buttonTransform, willChange: "transform" }}
        whileTap={{ scale: 0.95 }}
        transition={{ duration: 0.2 }}
      >
        <HoverBorderGradient
          containerClassName="rounded-full"
          className="text-sm bg-white/5 backdrop-blur-sm hover:bg-white/10 h-9 "
          onClick={() => router.push("/home")}
        >
          Start Now
        </HoverBorderGradient>
      </motion.div>
    </motion.div>
  );
};

const STATIC_TEXT = [
  // "Let your fingers move fast and easy on the keyboard! Click 'Start Now' and Enjoy a smooth and easy typing experience!",
  "Test",
];

const HeroCard = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardTransform = useOptimizedScrollTransform(containerRef, [65, -125]);
  const cardScale = useOptimizedScrollTransform(containerRef, [1, 1.2]);

  return (
    <motion.div
      ref={containerRef}
      className="mt-8 lg:mt-5 relative max-w-[90%] md:max-w-[60%] xl:max-w-[50%] mx-auto xl:mb-12"
      initial="hidden"
      viewport={{ once: true, margin: "5%" }}
    >
      <div className="relative z-10 flex justify-center items-center">
        <motion.div
          style={{
            y: cardTransform,
            scale: cardScale,
            willChange: "transform",
            backgroundColor: "rgba(16, 26, 42, 0.95)",
            border: "1px solid rgba(120, 110, 230, 0.15)",
          }}
          className="rounded-[2.5rem] "
        >
          <HeaderGame
            texts={STATIC_TEXT}
            HomePage={true}
            className="max-w-5xl mx-auto"
            fontSize="text-base md:text-xl"
          />
        </motion.div>
      </div>
    </motion.div>
  );
};

const Rings = () => {
  return (
    <div className="absolute inset-0 flex justify-center items-center">
      <motion.div className="absolute w-[65.875rem] top-1/2 left-1/2 aspect-square border border-n-2/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <motion.div className="absolute w-[51.375rem] top-1/2 left-1/2 aspect-square border border-n-2/20 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <motion.div className="absolute top-1/2 left-1/2 w-[36.125rem] aspect-square border border-n-2/30 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <motion.div className="absolute top-1/2 left-1/2 w-[23.125rem] aspect-square border border-n-2/40 rounded-full -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
};

const Main: React.FC = () => {
  return (
    <div className="container relative">
      <HeroHeading />
      <HeroCard />
      <Rings />
    </div>
  );
};

export default Main;
