"use client";

import { motion, type Variants } from "framer-motion";

const lineVariants: Variants = {
  hidden: { opacity: 0, x: -50, rotate: -10 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    rotate: i === 1 ? 0 : i === 0 ? -15 : 15, // تناسق في التدوير بين الخطوط
    transition: { delay: i * 0.2, duration: 0.6, ease: [0, 0, 0.58, 1] as const },
  }),
};

const Lines: React.FC = () => {
  return (
    <svg
      width="220"
      height="100"
      viewBox="0 0 220 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="absolute bottom-0 right-0"
    >
      {[
        { y: 20, x2: 100 }, // الخط الأول (قصير)
        { y: 40, x2: 160 }, // الخط الأوسط (أطول)
        { y: 60, x2: 100 }, // الخط الثالث (قصير)
      ].map((line, i) => (
        <motion.line
          key={i}
          x1="10"
          y1={line.y}
          x2={line.x2}
          y2={line.y}
          stroke="rgb(255, 192, 203)" // لون زهري فاتح
          strokeWidth="4"
          strokeLinecap="round"
          variants={lineVariants}
          custom={i}
          initial="hidden"
          animate="visible"
          transform={`rotate(0, ${line.x2 / 2}, ${line.y})`}
        />
      ))}
    </svg>
  );
};

export default Lines;
