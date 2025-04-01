export const SPRING_CONFIG = { stiffness: 200, damping: 25, mass: 0.5 };
export const SCROLL_RANGE = [0, 100];
export const MOBILE_MENU_TRANSITION = { duration: 0.3, ease: "easeInOut" };


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
        type: "spring",
        stiffness: 300,
        damping: 15
      }
    },
    hover: {
      scale: 1.05,
      transition: { 
        type: "spring", 
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
        ease: "easeOut"
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
        repeatType: "loop",
        ease: "linear"
      }
    }
  };