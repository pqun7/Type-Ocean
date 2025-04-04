"use client";
import { useEffect } from "react";
import { useMotionValue, useTransform, animate, motion } from "framer-motion";
export const NumberAnimation = ({
  value,
  unit,
  color = "rgba(160,220,255,1)",
  delay = 0,
}: {
  value: number;
  unit?: string;
  color?: string;
  delay?: number;
}) => {
  const motionValue = useMotionValue(0);
  const animatedValue = useTransform(motionValue, Math.round);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 1.2,
      delay: 0.3 + delay,
      ease: "easeOut",
    });

    return () => controls.stop();
  }, [value, delay, motionValue]);

  return (
    <motion.span
      className="font-medium"
      style={{ color: color }}
    >
      <motion.span>{animatedValue}</motion.span>
      {unit && <span> {unit}</span>}
    </motion.span>
  );
};