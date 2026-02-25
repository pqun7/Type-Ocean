"use client";

import * as React from "react";
import { MotionConfig } from "framer-motion";

import { useSettings } from "@/features/settings/context";

export function MotionSettingsProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();

  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "always" : "never"}>
      {children}
    </MotionConfig>
  );
}
