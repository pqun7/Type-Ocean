'use client';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion, Transition, Variants } from 'framer-motion';
import { useMemo, useId } from 'react';

export type TextMorphProps = {
  children: string;
  as?: React.ElementType;
  className?: string;
  style?: React.CSSProperties;
  variants?: Variants;
  transition?: Transition;
  blurAmount?: number;
};

export function TextMorph({
  children,
  as: Component = 'p',
  className,
  style,
  variants,
  transition,
  blurAmount = 3,
}: TextMorphProps) {
  const uniqueId = useId();

  const characters = useMemo(() => {
    const charCounts: Record<string, number> = {};

    return children.split('').map((char) => {
      const lowerChar = char.toLowerCase();
      charCounts[lowerChar] = (charCounts[lowerChar] || 0) + 1;

      return {
        id: `${uniqueId}-${lowerChar}${charCounts[lowerChar]}`,
        label: char === ' ' ? '\u00A0' : char,
      };
    });
  }, [children, uniqueId]);

  const defaultVariants: Variants = {
    initial: { 
      opacity: 0,
      filter: `blur(${blurAmount}px)`,
      scale: 0.8
    },
    animate: { 
      opacity: 1,
      filter: 'blur(0px)',
      scale: 1,
      transition: { duration: 0.3 } 
    },
    exit: { 
      opacity: 0,
      filter: `blur(${blurAmount}px)`,
      scale: 0.8,
      transition: { duration: 0.2 } 
    },
  };

  const defaultTransition: Transition = {
    type: 'spring',
    stiffness: 260,
    damping: 20,
    mass: 0.5,
  };

  return (
    <Component className={cn(className)} aria-label={children} style={style}>
      <AnimatePresence mode='popLayout' initial={false}>
        {characters.map((character) => (
          <motion.span
            key={character.id}
            layoutId={character.id}
            className='inline-block'
            aria-hidden='true'
            initial='initial'
            animate='animate'
            exit='exit'
            variants={variants || defaultVariants}
            transition={transition || defaultTransition}
            style={{
              transformOrigin: 'center bottom',
              willChange: 'transform, opacity, filter',
            }}
          >
            {character.label}
          </motion.span>
        ))}
      </AnimatePresence>
    </Component>
  );
}