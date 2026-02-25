import { motion } from "framer-motion";

import { useSettings } from "@/features/settings/context";

interface CaretProps {
  caretPosition: { x: number; y: number };
  caretHeight?: string;
  className?: string;
  colorClassName?: string;
}

export default function Caret({
  caretPosition,
  caretHeight = "h-5",
  className = "",
  colorClassName = "bg-blue-400",
}: CaretProps) {
  const { settings } = useSettings();

     if (settings.reduceMotion) {
    return (
      <motion.span
        className={`absolute w-0.5 ${caretHeight} ${colorClassName} ${className}`}
        animate={{ left: caretPosition.x, top: caretPosition.y }}
        transition={{
          // حركة أبطأ قليلاً على المحور X لسلاسة أكبر
          left: {
            type: "tween",
            duration: 0.2,          // مدة أطول قليلاً من الافتراضي
            ease: [0.25, 0.1, 0.25, 1] // منحنى easing ناعم (easeInOut)
          },
          // حركة سريعة على المحور Y (يمكن تعديلها حسب الرغبة)
          top: {
            type: "tween",
            duration: 0.1,
            ease: "easeOut"
          },
        }}
      />
    );
  }
  
  return (
    <motion.span
      className={`absolute w-0.5 ${caretHeight} ${colorClassName} ${className}`}
      initial={{ left: caretPosition.x, top: caretPosition.y }}
      animate={{
        left: caretPosition.x,
        top: caretPosition.y,
        opacity: [1, 0.3, 1],
        scaleY: [1, 0.7, 1],
      }}
      transition={{
        left: { type: "spring", stiffness: 350, damping: 30 },
        top: { type: "spring", stiffness: 300, damping: 20 },
        opacity: { duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" },
        scaleY: { duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatType: "mirror" },
      }}
    />
  );
}