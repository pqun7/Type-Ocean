// components/ui/text-morph-button.tsx
"use client";

import { TextMorph } from "@/components/core/text-morph";
import { motion, useAnimate } from "framer-motion";
import { ReactNode, useState, useEffect } from "react"; // أضف useEffect هنا

export function TextMorphButton({
  from,
  to,
  className,
  disableMorph,
  disabled,
  children,
}: {
  from: string;
  to: string;
  className?: string;
  disableMorph?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [scope, animate] = useAnimate();

  useEffect(() => {
    // إلغاء أي أنيميشن جارية عند التغيير
    const cancelAnimation = async () => {
      if (disableMorph || disabled) {
        await animate(scope.current, { scale: 1 }, { duration: 0 });
        setIsHovered(false);
      }
    };
    cancelAnimation();
  }, [disableMorph, animate]);

  const handleTap = () => {
    if (disableMorph || disabled) return;

    animate(scope.current, {
      scale: 0.95,
      transition: {
        type: "spring",
        stiffness: 400,
        damping: 15,
        mass: 0.5,
      },
    });
  };

  const isShowingLoader = !!children;

  return (
    <motion.button
      ref={scope}
      onHoverStart={() => !disableMorph && setIsHovered(true)}
      onHoverEnd={() => !disableMorph && setIsHovered(false)}
      onTap={handleTap}
      disabled={disabled}
      className={`${className} relative h-12 overflow-hidden rounded-full flex items-center justify-center`}
      type="submit"
    >
      <div
        className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none"
        style={{ opacity: isShowingLoader ? 0 : 1 }}
      >
        <TextMorph>
          {disableMorph || disabled ? from : isHovered ? to : from}
        </TextMorph>
      </div>

      <span className="relative z-10 flex items-center justify-center">
        {children}
      </span>
    </motion.button>
  );
}
