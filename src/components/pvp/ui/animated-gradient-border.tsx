import { cn } from "@/lib/utils";

export function AnimatedGradientBorder({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative group", className)}>
      <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-[#00D4FF] via-[#A78BFA] to-[#F87171] opacity-30 blur group-hover:opacity-100 transition duration-500" />
      <div className="relative bg-black/40 backdrop-blur-sm rounded-2xl">{children}</div>
    </div>
  );
}