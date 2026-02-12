export const SPRING_CONFIG = { stiffness: 200, damping: 25, mass: 0.5 };
export const SCROLL_RANGE = [0, 100];
export const MOBILE_MENU_TRANSITION = {
  duration: 0.3,
  ease: [0.42, 0, 0.58, 1] as const,
};


export const LEVEL_ANIMATION = {
    initial: { 
      scale: 0.9, 
      opacity: 0,
      y: 10
    },
    animate: { 
      scale: 1, 
      opacity: 1,
      y: 0,
      transition: {
        type: "spring" as const,
        stiffness: 300,
        damping: 15
      }
    },
    hover: {
      scale: 1.05,
      transition: { 
        type: "spring" as const, 
        stiffness: 400 
      }
    },
    tap: {
      scale: 0.95
    }
  };
  
  export const PROGRESS_ANIMATION = {
    initial: { width: 0 },
    animate: { 
      width: "100%",
      transition: {
        duration: 1,
        ease: [0, 0, 0.58, 1] as const
      }
    }
  };
  
  export const SHINE_ANIMATION = {
    initial: { left: "-100%" },
    animate: {
      left: "100%",
      transition: {
        duration: 1.5,
        repeat: Infinity,
        repeatType: "loop" as const,
        ease: [0, 0, 1, 1] as const
      }
    }
  };