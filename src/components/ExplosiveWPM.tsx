import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

const ExplosiveWPM = ({ wpm }: { wpm: number }) => {
  const shouldReduceMotion = useReducedMotion();
  const lines = shouldReduceMotion ? 8 : 24;
  const mousePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // تكوين حركة الخروج بناءً على تفضيلات المستخدم
  const exitAnimation = shouldReduceMotion
    ? { opacity: 0 }
    : {
        scale: 0,
        opacity: 0,
        rotate: 45,
        filter: "blur(20px)",
        transition: { 
          duration: 0.8, 
          ease: "easeInOut",
          staggerChildren: 0.02
        }
      };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ 
        opacity: 1, 
        scale: 1,
        transition: { type: "spring", stiffness: 120, damping: 15 }
      }}
      exit={exitAnimation}
      className="absolute inset-0 flex flex-col items-center justify-center rounded-xl z-20 overflow-hidden cursor-pointer"
    >
      {/* خلفية تفاعلية ديناميكية */}
      <motion.div
        animate={{
          background: [
            "linear-gradient(45deg, rgba(10,26,42,0.9), rgba(26,43,63,0.7))",
            "linear-gradient(135deg, rgba(26,43,63,0.7), rgba(42,59,85,0.5))",
          ],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          repeatType: "mirror",
        }}
        className="absolute inset-0 backdrop-blur-[12px] bg-opacity-60"
        style={{
          transform: `translate(
            ${(mousePos.current.x - window.innerWidth/2) * 0.02}px,
            ${(mousePos.current.y - window.innerHeight/2) * 0.02}px
          ) scale(1.02)`,
        }}
      />

      {/* نظام الجسيمات الشعاعية */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        exit={{
          scale: 0,
          opacity: 0,
          transition: { 
            duration: 0.6,
            staggerChildren: 0.02,
            when: "afterChildren"
          }
        }}
        className="relative z-20"
        transition={{ type: "spring", bounce: 0.4, duration: 1.2 }}
      >
        {Array.from({ length: lines }).map((_, i) => (
          <motion.div
            key={i}
            initial={{
              rotate: (360 / lines) * i,
              scale: 0,
              opacity: 0,
            }}
            animate={{
              scale: [0, 1.6, 0.9],
              opacity: [0, 0.8, 0],
              x: Math.cos((i * Math.PI) / (lines / 2)) * 240,
              y: Math.sin((i * Math.PI) / (lines / 2)) * 240,
              rotateZ: [0, 15, 0],
            }}
            exit={{ 
              scale: 0, 
              opacity: 0,
              x: 0,
              y: 0,
              transition: { 
                duration: 0.4, 
                ease: "backIn"
              } 
            }}
            transition={{
              duration: 2.8,
              delay: i * 0.03,
              ease: [0.34, 1.56, 0.64, 1],
            }}
            className="absolute h-2 w-32 bg-gradient-to-r from-[#6ad8ff] to-[#4a8cff] origin-left rounded-full shadow-[0_0_40px_#6ad8ff4D]"
            style={{
              filter: `blur(${i % 2 === 0 ? "12px" : "6px"})`,
              transformOrigin: "left center",
              willChange: "transform, opacity",
            }}
          />
        ))}
      </motion.div>

      {/* العنصر النصي الرئيسي */}
      <motion.div
        className="relative z-40 text-center"
        initial={{ scale: 0, filter: "blur(20px)" }}
        animate={{
          scale: [1, 1.02, 1],
          filter: "blur(0px)",
          y: [-4, 4, -4],
          rotateZ: [-0.5, 0.5, -0.5],
        }}
        exit={{
          scale: 0,
          opacity: 0,
          filter: "blur(20px)",
          transition: { 
            duration: 0.5,
            ease: "easeInOut"
          }
        }}
        transition={{
          delay: 0.4,
          duration: 5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <h1 className="text-9xl font-black bg-gradient-to-r from-blue-300 via-blue-400 to-blue-500 bg-clip-text text-transparent font-mono tracking-tighter neon-text">
          {wpm}
          <motion.span 
            className="text-4xl ml-3 bg-gradient-to-r from-[#6ad8ff] to-[#4a8cff] bg-clip-text text-transparent font-bold"
            animate={{
              opacity: [0.8, 1, 0.8],
              scale: [1, 1.05, 1],
            }}
            exit={{
              opacity: 0,
              scale: 0.5,
              transition: { duration: 0.3 }
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
            }}
          >
            WPM
          </motion.span>
        </h1>
      </motion.div>

      {/* نظام الجسيمات الثانوية */}
      <div className="absolute inset-0 pointer-events-none z-30">
        {Array.from({ length: 16 }).map((_, i) => (
          <motion.div
            key={i}
            initial={{
              scale: 0,
              opacity: 0,
              x: Math.cos((i * Math.PI) / 8) * 100,
              y: Math.sin((i * Math.PI) / 8) * 100,
            }}
            animate={{
              scale: [0, 1.2, 0],
              opacity: [0, 0.6, 0],
              transition: {
                duration: 3.2,
                delay: i * 0.1,
                repeat: Infinity,
                repeatDelay: 1.5,
              },
            }}
            exit={{
              scale: 0,
              opacity: 0,
              transition: {
                duration: 0.3,
                delay: i * 0.02
              }
            }}
            className="absolute w-4 h-4 bg-[#6ad8ff] rounded-full shadow-[0_0_20px_#6ad8ff]"
            style={{
              filter: "blur(3px)",
              transformOrigin: "center center",
            }}
          />
        ))}
      </div>

      {/* تأثير الإشعاع الخلفي */}
      <motion.div
        animate={{
          rotate: [0, 360],
          scale: [1, 1.4, 1],
          opacity: [0.3, 0.6, 0.3],
        }}
        exit={{
          opacity: 0,
          scale: 2,
          transition: { duration: 0.6 }
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "linear",
        }}
        className="absolute inset-0 bg-[conic-gradient(from_90deg_at_50%_50%,rgba(106,216,255,0.2)_0%,rgba(74,140,255,0.6)_50%,rgba(106,216,255,0.2)_100%)] blur-[60px]"
      />
    </motion.div>
  );
};

export default ExplosiveWPM;