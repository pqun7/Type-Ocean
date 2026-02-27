import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { useRef } from "react";

type DockLevel = "SHORT" | "MEDIUM" | "LONG";

interface LevelsDockProps {
  onLevelSelect: (level: DockLevel) => void;
  levels: DockLevel[];
  selectedLevel: DockLevel;
  className?: string;
}

/**
 * LevelsDock – A modern, glass‑morphism dock for selecting typing levels.
 * Design language adapted from the profile and auth pages.
 * Container is transparent; each pill is styled with backdrop blur,
 * subtle borders, and cyan highlights.
 */
const LevelsDock = ({
  onLevelSelect,
  levels,
  selectedLevel,
  className,
}: LevelsDockProps) => {
  const mouseX = useMotionValue(Infinity);

  return (
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        "flex h-20 w-fit items-center gap-4", // no background or border – clean, minimal
        className
      )}
    >
      {levels.map((level) => (
        <DockItem
          key={level}
          level={level}
          mouseX={mouseX}
          isSelected={selectedLevel === level}
          onClick={() => onLevelSelect(level)}
        />
      ))}
    </motion.div>
  );
};

const DockItem = ({
  level,
  mouseX,
  isSelected,
  onClick,
}: {
  level: DockLevel;
  mouseX: MotionValue<number>;
  isSelected: boolean;
  onClick: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // Distance from mouse to item center – drives width and scale
  const distance = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  // Spring‑animated width (100px → 130px → 100px)
  const width = useSpring(
    useTransform(distance, [-200, 0, 200], [100, 130, 100]),
    { mass: 0.1, stiffness: 150, damping: 12 }
  );

  // Spring‑animated scale (1 → 1.15 → 1)
  const scale = useSpring(
    useTransform(distance, [-200, 0, 200], [1, 1.15, 1]),
    { mass: 0.1, stiffness: 150, damping: 12 }
  );

  return (
    <motion.div
      ref={ref}
      style={{ width, scale }}
      className="relative flex items-center justify-center"
    >
      <motion.button
        type="button"
        aria-pressed={isSelected}
        data-selected={isSelected ? "true" : "false"}
        onClick={onClick}
        className={cn(
          // Base glass styling – taken from reference profile cards & buttons
          "h-12 w-full rounded-full px-6 backdrop-blur-sm transition-all duration-300",
          "border text-sm font-medium shadow-md",
          // Default state
          "border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] text-[#8A8FB5]",
          // Hover state – increased border opacity and background
          !isSelected &&
            "[@media(hover:hover)]:hover:border-[rgba(160,220,255,0.5)] [@media(hover:hover)]:hover:bg-[rgba(20,50,80,0.5)] [@media(hover:hover)]:hover:text-[#E0E7FF]",
          // Selected state – cyan border and subtle glow
          isSelected &&
    "!border-[#4fb0e0] !bg-[rgba(79,176,224,0.12)] !text-[#c0e2ff] !shadow-[0_0_10px_rgba(79,176,224,0.2)]",
          // Focus ring for accessibility
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#69d0ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1f]"
        )}
      >
        <span className="font-jetbrains">{level}</span>
      </motion.button>
    </motion.div>
  );
};

export default LevelsDock;