"use client";

import { motion } from "framer-motion";
import { benefits } from "@/constants";
import Section from "./ui/Section";
import { FlipWords } from "./ui/flip-words";
import Image, { StaticImageData } from "next/image";
import { useOptimizedScrollTransform } from "@/hooks/scrollHooks";
import { useRef } from "react";


const Header = () => {
  const ref = useRef<HTMLDivElement>(null);

  const opacity = useOptimizedScrollTransform(ref, [0, 1.6]);
  const y = useOptimizedScrollTransform(ref, [50, 0]);
  const scale = useOptimizedScrollTransform(ref, [0.9, 1]);

  return (
    <motion.div
      ref={ref}
      style={{ opacity, y, scale }}
      className="max-w-[50rem] mx-auto mb-12 lg:mb-20 md:max-w-md lg:max-w-2xl flex justify-center items-center"
      transition={{ type: "spring", damping: 20, stiffness: 150 }}
    >
      <h2 className="h2 text-center bg-clip-text text-transparent bg-gradient-to-r from-[rgb(140,200,240)] to-[rgb(120,110,230)]">
        Type Faster with{" "}
        <FlipWords
          words={["Simple", "Fun", "Effective", "Fast", "Smart"]}
          className="text-[rgb(200,240,255)]"
        />{" "}
        Training!
      </h2>
    </motion.div>
  );
};

const AnimatedBenefit = ({ benefit, index }: { benefit: { icon: string | StaticImageData; title: string; text: string; width?: number; }; index: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  const opacity = useOptimizedScrollTransform(ref, [0, 1.6]);
  const y = useOptimizedScrollTransform(ref, [70 * (index % 3), 0]);
 

  return (
    <motion.div
      ref={ref}
      style={{ opacity, y }}
      className="bg-[rgba(30,70,100,0.4)] rounded-2xl p-8 backdrop-blur-sm border border-[rgba(140,200,240,0.1)] transition-all group"
      whileHover={{
        backgroundColor: "rgba(80,60,190,0.3)",
        borderColor: "rgba(140,200,240,0.3)",
        boxShadow: "0 8px 32px rgba(140, 200, 240, 0.2)",
      }}
      transition={{
        scroll: { damping: 18, stiffness: 150 },
        hover: { type: "spring", damping: 20, stiffness: 300 },
      }}
    >
      <div className="flex flex-col items-center justify-center">
        <div className="w-28 h-28 bg-[rgba(140,200,240,0.1)] rounded-full flex items-center justify-center border border-[rgba(120,110,230,0.2)] group-hover:border-[rgba(120,110,230,0.5)] transition-colors duration-300">
          <Image
            src={benefit.icon}
            alt={benefit.title}
            width={benefit.width || 112}
            height={112}
            className="filter brightness-125 saturate-110"
          />
        </div>
        <h3 className="h4 text-center mt-4 text-[rgb(200,240,255)]">
          {benefit.title}
        </h3>
        <p className="text-center text-[rgba(140,200,240,0.8)] mt-2 leading-6">
          {benefit.text}
        </p>
      </div>
    </motion.div>
  );
};

const BenefitsSection = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-10 mb-5">
    {benefits.map((benefit, index) => (
      <AnimatedBenefit key={index} benefit={benefit} index={index} />
    ))}
  </div>
);

const Benefits = () => {
  return (
    <Section>
      <div className="container relative z-2">
        <Header />
        <BenefitsSection />
      </div>
    </Section>
  );
};

export default Benefits;