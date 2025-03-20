"use client";
import { Button2 } from "@/components/ui/Buttons";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import TypingTest from "@/components/typing-test/TypingTest";
import { useRef } from "react";
import { useOptimizedScrollTransform} from "@/components/hooks/scrollHooks";

// Static configuration
// const SCROLL_CONFIG = {
//   target: undefined,
//   offset: ["start end", "end start"] as ["start end", "end start"],
// };

// const TRANSFORM_SETTINGS = {
//   damping: 18,
//   stiffness: 150,
//   mass: 0.2,
// };

// // Optimized scroll handler
// const useOptimizedScrollTransform = (
//   ref: React.RefObject<HTMLElement | null>,
//   output: number[]
// ) => {
//   const { scrollYProgress } = useScroll({ ...SCROLL_CONFIG, target: ref });
//   return useTransform(scrollYProgress, [0, 1], output);
// };

const HeroHeading = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Directly call hooks for each transform
  const h1Y = useOptimizedScrollTransform(containerRef, [200, -200]);
  const h1Opacity = useOptimizedScrollTransform(containerRef, [0, 1.6]);
  const h1Scale = useOptimizedScrollTransform(containerRef, [0.8, 1.4]);

  const pScale = useOptimizedScrollTransform(containerRef, [0.8, 1.1]);

  const buttonTransform = useOptimizedScrollTransform(containerRef, [-160, 130]);

  return (
    <motion.div
      ref={containerRef}
      className="relative z-1 max-w-[62rem] mx-auto text-center text-[min(10vw,70px)] lg:mt-20"
      initial="hidden"
      viewport={{ once: true, margin: "5%" }}
    >
<motion.h1 
        style={{ y: h1Y, opacity: h1Opacity, scale: h1Scale }}
        className="mb-6 h1 mt-10 px-7"
      >        Turn<span className="opacity-60 text-purple-200/50"> Your </span>Fingers
        <span className="opacity-60 text-purple-200/50"> into </span>Speed
        Machines!
      </motion.h1>

      <motion.p
        style={{ scale: pScale, opacity: h1Opacity }}
        className="max-w-3xl mx-auto mb-6 font-light body-1 text-n-2 lg:mb-8"
      >
        Type like a pro with easy, step-by-step training that helps you improve
        your speed and accuracy, no matter your starting level!
      </motion.p>

      <motion.div style={{ y: buttonTransform }} whileTap={{ scale: 0.95 }}>
        <Button2>Start Now</Button2>
      </motion.div>
    </motion.div>
  );
};

const STATIC_TEXT = [
  "Let your fingers move fast and easy on the keyboard! Click 'Start Now' and Enjoy a smooth and easy typing experience!",
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
          style={{ y: cardTransform, scale: cardScale }}
          className="relative w-full bg-gradient-to-br from-slate-800/90 to-slate-900/80 backdrop-blur-[6px] rounded-[2.5rem] border border-slate-600/20 shadow-2xl hover:shadow-3xl transition-all duration-300 overflow-hidden p-8 md:p-10 lg:p-12 transform-gpu will-change-transform"
        >
          <div className="relative flex flex-col items-center justify-center space-y-6 text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-blue-300">
              Try for yourself!
              <div className="mt-2 h-[2px] w-64 bg-purple-400/10 rounded-full mx-auto" />
            </h2>

            <div className="w-full max-w-xl">
              <TypingTest
                texts={STATIC_TEXT}
                fontSize="text-base md:text-lg"
                caretHeight="h-5"
                font="font-fira"
              />
            </div>
          </div>
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
