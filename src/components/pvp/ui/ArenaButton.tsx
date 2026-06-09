'use client';

import { Swords, Loader2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

interface ArenaButtonProps {
  disabled?: boolean;
  onClick: () => void | Promise<void>;
  loading?: boolean;
  pulseOnReady?: boolean; // triggers attention-grabbing pulse when queue is ready
  label?: string;
  loadingLabel?: string;
  variant?: 'primary' | 'danger';
  size?: 'default' | 'compact';
  fullWidth?: boolean;
}

export default function ArenaButton({
  disabled = false,
  onClick,
  loading = false,
  pulseOnReady = false,
  label = 'ENTER ARENA',
  loadingLabel = 'ENTERING ARENA...',
  variant = 'primary',
  size = 'default',
  fullWidth = true,
}: ArenaButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [pulse, setPulse] = useState(pulseOnReady);

  const isDanger = variant === 'danger';
  const iconColor = isDanger ? 'text-red-300' : 'text-cyan-300';
  const hoverRingClass = isDanger
    ? 'bg-gradient-to-r from-red-400/0 via-red-400/30 to-red-400/0'
    : 'bg-gradient-to-r from-cyan-400/0 via-cyan-400/30 to-cyan-400/0';
  const pulseRingClass = isDanger ? 'border-red-300' : 'border-cyan-300';
  const buttonToneClass = disabled || loading
    ? 'opacity-50 cursor-not-allowed border-white/10 bg-white/5 text-white/30 shadow-none'
    : isDanger
      ? 'border border-red-400/60 bg-gradient-to-r from-red-500/10 via-rose-500/10 to-red-500/10 text-red-300 hover:border-red-300/80 hover:scale-[1.02] active:scale-[0.98]'
      : 'border border-cyan-400/60 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-cyan-500/10 text-cyan-300 hover:border-cyan-300/80 hover:scale-[1.02] active:scale-[0.98]';
  const MainIcon = isDanger ? X : Swords;
  const sizeClass = size === 'compact'
    ? 'h-7 px-3 text-[9px] tracking-[0.08em]'
    : 'h-9 px-4 text-[10px] tracking-[0.1em]';
  const widthClass = fullWidth ? 'w-full' : 'w-auto';

  // Auto-reset pulse after animation
  useEffect(() => {
    if (pulseOnReady) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [pulseOnReady]);

  const handleClick = async () => {
    if (disabled || loading) return;
    setIsPressed(true);
    await onClick();
    setTimeout(() => setIsPressed(false), 150);
  };

  return (
    <motion.button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      disabled={disabled || loading}
      className={`
        relative mt-2 rounded-full font-bold uppercase
        transition-all duration-300 ease-out
        flex items-center justify-center gap-2
        backdrop-blur-sm
        ${widthClass}
        ${sizeClass}
        ${buttonToneClass}
      `}
      // animate={{
      //   scale: isPressed ? 0.97 : 1,
      // }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    >
      {/* Animated glow ring on hover */}
      {!disabled && !loading && (
        <motion.span
          className={`absolute inset-0 rounded-full blur-md ${hoverRingClass}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: isHovered ? 0.6 : 0 }}
          transition={{ duration: 0.2 }}
        />
      )}

      {/* Pulse ring for attention (when ready to queue) */}
      {pulse && !disabled && !loading && (
        <motion.span
          className={`absolute inset-0 rounded-full border ${pulseRingClass}`}
          initial={{ scale: 1, opacity: 0.8 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 1, repeat: 2, ease: 'easeOut' }}
        />
      )}

      {/* Loading spinner */}
      {loading ? (
        <Loader2 className={`h-3.5 w-3.5 animate-spin ${iconColor}`} />
      ) : (
        <motion.div
          animate={!disabled ? { rotate: isHovered ? [0, -10, 10, -5, 0] : 0 } : {}}
          transition={{ duration: 0.4 }}
        >
          <MainIcon className="h-3.5 w-3.5 transition-all duration-200" />
        </motion.div>
      )}

      <span className="relative z-10">
        {loading ? loadingLabel : label}
      </span>

   

      {/* Ripple effect on click */}
      {!disabled && !loading && (
        <motion.span
          className="absolute inset-0 rounded-full bg-white/10"
          initial={{ scale: 0, opacity: 0.5 }}
          animate={isPressed ? { scale: 1.5, opacity: 0 } : {}}
          transition={{ duration: 0.3 }}
        />
      )}
    </motion.button>
  );
}