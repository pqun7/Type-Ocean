import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
  fullWidth?: boolean;
}

export const GlowButton = forwardRef<HTMLButtonElement, GlowButtonProps>(
  ({ children, className, variant = "primary", loading, disabled, fullWidth, ...props }, ref) => {
    const variants = {
      primary: "bg-gradient-to-r from-[#00D4FF] to-[#A78BFA] text-white shadow-[0_0_15px_rgba(0,212,255,0.5)] hover:shadow-[0_0_25px_rgba(0,212,255,0.7)]",
      secondary: "bg-white/10 border border-white/20 text-white hover:bg-white/20 hover:border-white/40",
      danger: "bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 hover:border-red-500/50",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "relative flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold uppercase tracking-wide transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed",
          variants[variant],
          fullWidth && "w-full",
          className
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
        {!loading && variant === "primary" && (
          <span className="absolute inset-0 rounded-full bg-white/20 blur-sm animate-pulse" />
        )}
      </button>
    );
  }
);

GlowButton.displayName = "GlowButton";