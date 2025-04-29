// scrollHooks.ts
import { useScroll, useTransform, useSpring } from "framer-motion";
import { RefObject } from "react";

const SCROLL_CONFIG = {
  offset: ["start end", "end start"] as ["start end", "end start"],
};
const SPRING_SETTINGS = {
  damping: 20,  
  stiffness: 100, 
  mass: 0.5,     
};

export const useOptimizedScrollTransform = (
  ref: RefObject<HTMLElement | null>,
  output: number[],
  input: number[] = [0, 1]
) => {
  const { scrollYProgress } = useScroll({ ...SCROLL_CONFIG, target: ref });
  const transformedValue = useTransform(scrollYProgress, input, output);
  return useSpring(transformedValue, SPRING_SETTINGS);
};

export const useDelayedScrollTransform = (
  ref: RefObject<HTMLElement | null>,
  output: number[],
  delay: number = 0
) => {
  return useOptimizedScrollTransform(ref, output, [delay, 1 + delay]);
};