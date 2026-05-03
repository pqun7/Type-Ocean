import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

export function HolographicCard({
  children,
  className,
  ...props
}: Omit<HTMLMotionProps<"div">, "children"> & { children?: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      whileHover={{ y: -4, scale: 1.01 }}
      className={cn(
        "relative rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/0 backdrop-blur-md shadow-2xl transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,212,255,0.15)]",
        className
      )}
      {...props}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-500" />
      {children}
    </motion.div>
  );
}