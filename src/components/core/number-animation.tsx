"use client";
import React, { useEffect } from "react";
import { useMotionValue, useTransform, animate, motion } from "framer-motion";

interface NumberAnimationProps {
  value: number;
  unit?: string;
  color?: string;
  delay?: number;
  className?: string;
  baseDelay?: number; // new optional prop
}

export const NumberAnimation = React.memo(({
  value,
  unit,
  color = "rgba(160,220,255,1)",
  delay = 0,
  className,
  baseDelay = 0.3,
}: NumberAnimationProps) => {
  const motionValue = useMotionValue(0);
  const animatedValue = useTransform(motionValue, Math.round);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 1.2,
      delay: baseDelay + delay,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [value, delay, baseDelay, motionValue]);

  return (
    <span className={className ?? "font-medium"} style={{ color }}>
      <motion.span>{animatedValue}</motion.span>
      {unit && <span> {unit}</span>}
    </span>
  );
});

NumberAnimation.displayName = "NumberAnimation";