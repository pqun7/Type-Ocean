import { motion } from "framer-motion";

export const ProgressBar = ({ progress }: { progress: number }) => (
  <div className="w-full bg-slate-700 rounded-full h-1.5 overflow-hidden">
    <motion.div
      className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full"
      initial={{ width: 0 }}
      animate={{ width: `${Math.min(progress, 100)}%` }}
      transition={{ type: "spring", stiffness: 100, damping: 15 }}
    />
  </div>
);
