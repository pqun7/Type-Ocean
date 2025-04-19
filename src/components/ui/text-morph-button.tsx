"use client";
import { TextMorph } from "@/components/core/text-morph";
import { motion, useAnimate } from "framer-motion";
import { useState } from "react";
export function TextMorphButton({
  from,
  to,
  className,
  disableMorph,
}: {
  from: string;
  to: string;
  className?: string;
  disableMorph?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [scope, animate] = useAnimate();

  const handleTap = () => {
    animate(scope.current, {
      scale: 0.95,
      transition: { duration: 0.1 },
    });
  };

  return (
    <motion.button
      ref={scope}
      onHoverStart={() => !disableMorph && setIsHovered(true)}
      onHoverEnd={() => !disableMorph && setIsHovered(false)}
      onTap={handleTap}
      className={`${className} relative h-12 overflow-hidden rounded-full`}
      type="submit"
    >
      <div className="absolute inset-0 flex h-full items-center justify-center ">
        <TextMorph>
          {disableMorph ? from : (isHovered ? to : from)}
        </TextMorph>
      </div>
    </motion.button>
  );
}