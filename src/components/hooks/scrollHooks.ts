// scrollHooks.ts
import { useScroll, useTransform, useSpring } from "framer-motion";
import { RefObject } from "react";

const SCROLL_CONFIG = {
  offset: ["start end", "end start"] as ["start end", "end start"],
};
const SPRING_SETTINGS = {
  damping: 20,    // زيادة التخميد قليلاً لتقليل التذبذب
  stiffness: 100, // تقليل الصلابة لتقليل التحديثات
  mass: 0.5,      // زيادة الكتلة لجعل الحركة أبطأ وأقل استهلاكاً للموارد
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