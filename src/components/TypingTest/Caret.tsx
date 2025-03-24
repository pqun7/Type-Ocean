import { motion } from "framer-motion";

interface CaretProps {
  caretPosition: { x: number; y: number };
  caretHeight?: string;
}

export default function Caret({ caretPosition, caretHeight }: CaretProps) {
  return (
    <motion.span
      className={`absolute w-0.5 ${caretHeight} bg-blue-400`}
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
