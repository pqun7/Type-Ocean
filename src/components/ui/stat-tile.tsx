"use client";

import * as React from "react";
import { motion } from "framer-motion";

export type StatTileProps = {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  icon?: React.ReactNode;
  gradient?: string;
  className?: string;
  centered?: boolean;
  valueColor?: string; // new prop for value text color
};

export function StatTile(props: StatTileProps) {
  return (
    <motion.div
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={
        "rounded-xl border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] p-4 backdrop-blur-sm hover:border-[rgba(160,220,255,0.3)] transition-all" +
        (props.centered ? " flex flex-col items-center text-center" : "") +
        (props.className ? ` ${props.className}` : "")
      }
    >
      <div className={"flex items-center gap-2 text-[rgba(200,240,255,0.8)]" + (props.centered ? " justify-center" : "")}>
        {props.icon ? <span className="text-cyan-300">{props.icon}</span> : null}
        <span className="text-xs uppercase tracking-wider">{props.label}</span>
      </div>
      <div
        className={
          "mt-1 text-2xl font-bold " +
          (props.gradient
            ? `bg-clip-text text-transparent ${props.gradient}`
            : (props.valueColor ? props.valueColor : "text-slate-100"))
        }
      >
        {props.value}
      </div>
      {props.subValue ? <div className="mt-1 text-xs text-[rgba(200,240,255,0.6)]">{props.subValue}</div> : null}
    </motion.div>
  );
}
