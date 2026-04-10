"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

export type RuleItemData = {
  icon: LucideIcon;
  text: string;
};

export interface RuleItemProps extends RuleItemData {
  index?: number;
}

export default function RuleItem({
  icon: Icon,
  text,
  index = 0,
}: RuleItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.li
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="group relative flex items-start gap-2 overflow-hidden rounded-md px-1 py-1 transition-all duration-200 hover:bg-white/5"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
        <span
          className={`absolute inset-0 rounded-full bg-cyan-400/20 blur-sm transition-opacity duration-200 ${
            isHovered ? "opacity-100" : "opacity-0"
          }`}
        />
        <Icon className="relative h-2.5 w-2.5 text-cyan-400/70 transition-all duration-200 group-hover:scale-110 group-hover:text-cyan-300" />
      </span>
      <span className="relative text-[9px] leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
        {text}
      </span>
      <span
        className={`pointer-events-none absolute inset-0 rounded-md bg-gradient-to-r from-cyan-500/10 to-transparent transition-opacity duration-200 ${
          isHovered ? "opacity-100" : "opacity-0"
        }`}
      />
    </motion.li>
  );
}