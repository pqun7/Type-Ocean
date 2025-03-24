import { motion } from "framer-motion";
import { RefObject } from "react";
import { useOptimizedScrollTransform } from "./hooks/scrollHooks";

interface PricingCardProps {
  plan: {
    id: string;
    title: string;
    description: string;
    price: number;
    duration?: string;
    features: string[];
  };
  index: number;
  parentRef: RefObject<HTMLDivElement>;
}

const PricingCard = ({ plan, index, parentRef }: PricingCardProps) => {
  const stagger = index * 0.15;

  const opacity = useOptimizedScrollTransform(parentRef, [0, 1], [stagger, 1 - stagger]);
  const y = useOptimizedScrollTransform(parentRef, [50, -50], [stagger, 1 - stagger]);
  const scale = useOptimizedScrollTransform(parentRef, [0.9, 1], [stagger, 1 - stagger]);
  const rotateX = useOptimizedScrollTransform(parentRef, [15, 0], [stagger, 1 - stagger]);
  const rotateY = useOptimizedScrollTransform(parentRef, [-10, 0], [stagger, 1 - stagger]);
  const rotateZ = useOptimizedScrollTransform(parentRef, [5, 0], [stagger, 1 - stagger]);

  return (
    <motion.div
      style={{
        opacity,
        y,
        scale,
        rotateX,
        rotateY,
        rotateZ,
        background: `rgba(30,70,100,0.4)`, // خلفية موحدة مع Benefits
        border: `1px solid rgba(140,200,240,0.1)`, // حدود موحدة
        borderRadius: "12px",
        transition: "all 0.3s ease-out",
      }}
      className="relative rounded-2xl p-8 flex flex-col h-full backdrop-blur-sm" // تأثير ضبابي
      whileHover={{
        background: "rgba(80,60,190,0.3)", // تأثير hover مشابه
        borderColor: "rgba(140,200,240,0.3)",
        boxShadow: "0 12px 40px rgba(140,200,240,0.2)",
        transition: {
          duration: 0.2,
          ease: "easeInOut",
        },
      }}
    >
      {/* Glass effect overlay */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          background: `linear-gradient(45deg, rgba(120,110,230,0.1), rgba(140,200,240,0.1))`, // تأثير زجاجي
          zIndex: -1,
        }}
      />

      <div className="flex-1 flex flex-col space-y-6">
        {/* العنوان */}
        <div className="mb-4">
          <h3 className="text-2xl font-bold text-[rgb(200,240,255)] mb-3">{plan.title}</h3>
          <p className="text-[rgba(140,200,240,0.8)] text-sm leading-relaxed px-2">
            {plan.description}
          </p>
        </div>

        {/* السعر */}
        <div className="mb-4">
          <div className="flex items-center justify-center text-4xl font-bold text-[rgb(200,240,255)] mb-2">
            ${plan.price}
            {plan.duration && (
              <span className="ml-2 text-xl text-[rgba(140,200,240,0.8)]">/{plan.duration}</span>
            )}
          </div>
        </div>

        {/* الميزات */}
        <ul className="space-y-3 flex-1 mb-6">
          {plan.features.map((feature, index) => (
            <li key={index} className="flex items-start text-left px-2 py-1.5">
              <svg
                className="w-5 h-5 text-green-400 mr-3 flex-shrink-0 mt-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span className="text-[rgba(140,200,240,0.8)] text-sm leading-normal">
                {feature}
              </span>
            </li>
          ))}
        </ul>

        {/* الزر */}
        <button
          className={`w-full py-4 rounded-xl font-semibold text-lg transition-all duration-300 ${
            plan.id === "1"
              ? `bg-[rgba(120,110,230,1)] hover:bg-[rgba(120,110,230,0.8)]`
              : `bg-[rgba(140,200,240,0.2)] hover:bg-[rgba(140,200,240,0.3)]`
          }`}
        >
          {plan.id === "0"
            ? "Start Free Trial"
            : plan.id === "1"
            ? "Get Started"
            : "Find Section"}
        </button>
      </div>
    </motion.div>
  );
};

export default PricingCard;