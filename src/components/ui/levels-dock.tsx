import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";
import { useRef } from "react";
import { HoverBorderGradient } from "./hover-border-gradient";

interface LevelsDockProps {
  onLevelSelect: (level: "SHORT" | "MEDIUM" | "LONG") => void;
  levels: ("SHORT" | "MEDIUM" | "LONG")[];
  selectedLevel: "SHORT" | "MEDIUM" | "LONG";
  className?: string;
}

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
       "flex h-20 w-fit gap-4 items-center ",
       
        className
      )}
      // "rounded-full bg-gradient-to-br from-[#1B1B2E]/90 to-[#1D2B3A]/90",
      // "backdrop-blur-xl border-2 border-[rgba(105,208,255,0.15)]",
      // "px-6 shadow-2xl shadow-[#69d0ff]/15",
      // "relative before:absolute before:inset-0 before:rounded-full",
      // "before:bg-[radial-gradient(circle_at_center,#69d0ff15_0%,transparent_70%)]",
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
  level: string;
  mouseX: any;
  isSelected: boolean;
  onClick: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const width = useSpring(
    useTransform(distance, [-200, 0, 200], [100, 130, 100]),
    { mass: 0.1, stiffness: 150, damping: 12 }
  );

  const scale = useSpring(useTransform(distance, [-200, 0, 200], [1, 1.15, 1]), {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });
  return (
    <motion.div
      ref={ref}
      style={{ width, scale }}
      className="relative flex items-center justify-center"
    >
      <motion.button
        onClick={onClick}
        className={cn(
          "w-[25rem] h-12 rounded-full px-6 flex items-center justify-center",
          "transition-all duration-300 border-2",
          "shadow-md hover:shadow-[#69d0ff]/20",
          isSelected
            ? "bg-[rgba(105,208,255,0.15)] border-[#1c5975] shadow-inner"
            : "bg-[rgba(255,255,255,0.08)] border-transparent hover:border-[#69d0ff33]"
        )}
      >
        <motion.span
          className={cn(
            "font-jetbrains text-base transition-colors",
            isSelected ? "text-[#beeaff]" : "text-gray-300"
          )}
        >
          {level}
        </motion.span>
      </motion.button>
    </motion.div>
  );
};

export default LevelsDock;
