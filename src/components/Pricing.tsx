"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import Section from "./Section";
import { pricing } from "@/constants";
import { Button1 } from "@/components/ui/Buttons";
import {
  useOptimizedScrollTransform,
  useDelayedScrollTransform,
} from "@/components/hooks/scrollHooks";

// Define the structure of a pricing plan
interface PricingPlan {
  id: string;
  title: string;
  description: string;
  price: string | null;
  duration?: string;
  features: string[];
}

const Pricing = () => {
  return (
    <Section className="overflow-hidden" id="pricing">
      <div className="container relative z-2">
        <div className="hidden relative justify-center mb-10 lg:flex">
          <PricingList />
        </div>
      </div>
    </Section>
  );
};

const PricingList = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full flex items-center justify-center p-4 md:p-8"
    >
      <div className="max-w-6xl w-full space-y-8">
        {/* Animated Header */}
        <motion.div
          style={{
            opacity: useOptimizedScrollTransform(containerRef, [0, 2]),
            y: useDelayedScrollTransform(containerRef, [50, -20], 0.1),
            scale: useOptimizedScrollTransform(containerRef, [0.95, 1]),
          }}
          className="text-center mb-12"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-4">
            Pricing Plans
          </h2>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto">
            Choose the perfect plan for your needs. Start with a free trial and
            upgrade anytime.
          </p>
        </motion.div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          {pricing.map((plan: PricingPlan, index: number) => (
            <PricingCard
              key={plan.id}
              plan={plan}
              containerRef={containerRef}
              isSecondCard={index === 1}
              delay={index * 0.15}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface PricingCardProps {
  plan: PricingPlan;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isSecondCard: boolean;
  delay: number;
}

const PricingCard = ({
  plan,
  containerRef,
  isSecondCard,
  delay,
}: PricingCardProps) => {
  // Animation values
  const yDirection = isSecondCard ? [-120, 120] : [120, -50];

  const opacity = useDelayedScrollTransform(containerRef, [0, 1.6]);
  const y = useDelayedScrollTransform(containerRef, yDirection, delay);
  const scale = useDelayedScrollTransform(containerRef, [0.9, 1], delay);

  return (
    <motion.div
      style={{
        opacity,
        y,
        scale,
        background: `rgba(200, 240, 255, 0.1)`,
        backdropFilter: "blur(10px)",
        border: `1px solid rgba(120, 110, 230, 0.2)`,
        transition: "all 0.3s ease-out",
      }}
      className="relative rounded-2xl p-8 flex flex-col h-full"
      whileHover={{
        background: "rgba(200, 240, 255, 0.15)",
        borderColor: "rgba(180, 190, 255, 0.4)",
        boxShadow: "0 12px 40px rgba(180, 190, 255, 0.25)",
        transition: { duration: 0.2, ease: "easeInOut" },
      }}
    >
      {/* Glass Overlay */}
      <div
        className="absolute inset-0 rounded-2xl"
        style={{
          background: `linear-gradient(
            45deg, 
            rgba(80, 60, 190, 0.15), 
            rgba(140, 200, 240, 0.15)
          )`,
          filter: "blur(12px)",
          zIndex: -1,
        }}
      />

      <div className="flex-1 flex flex-col space-y-6">
        {/* Plan Header */}
        <div className="mb-4">
          <h3 className="text-2xl font-bold text-white mb-3">{plan.title}</h3>
          <p className="text-gray-300 text-sm leading-relaxed px-2">
            {plan.description}
          </p>
        </div>

        {/* Price Section */}
        <div className="mb-4">
          <div className="text-white font-bold text-3xl">
            ${plan.price}
            {plan.duration && (
              <span className="ml-2 text-xl text-gray-400">
                /{plan.duration}
              </span>
            )}
          </div>
        </div>

        {/* Features List */}
        <ul className="space-y-3 flex-1 mb-6">
          {plan.features.map((feature, index) => (
            <li key={index} className="flex items-start text-left px-2 py-1.5">
              <CheckIcon />
              <span className="text-gray-300 text-sm leading-normal">
                {feature}
              </span>
            </li>
          ))}
        </ul>

        {/* CTA Button */}
        <motion.div whileTap={{ scale: 0.95 }}>
          <Button1 className={getButtonClass(plan.id)}>
            {getButtonText(plan.id)}
          </Button1>
        </motion.div>
      </div>
    </motion.div>
  );
};
// Checkmark icon for features list
const CheckIcon = () => (
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
);

// Helper function to get button class based on plan ID
const getButtonClass = (id: string): string => {
  return `w-full py-4 rounded-xl font-semibold text-lg transition-all duration-300 ${
    id === "1"
      ? `bg-[rgba(120, 110, 230 ,1)] hover:bg-[rgba(120, 110, 230 ,0.8)]`
      : `bg-[rgba(140, 200, 240,0.2)] hover:bg-[rgba(140, 200, 240,0.3)]`
  }`;
};

// Helper function to determine button text based on plan ID
const getButtonText = (id: string): string => {
  return id === "0"
    ? "Start Free Trial"
    : id === "1"
    ? "Get Started"
    : "Find Section";
};

export default Pricing;
