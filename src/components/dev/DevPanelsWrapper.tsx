"use client";
/**
 * ⚠️  DEV-ONLY — renders both dev test panels at the root level.
 *
 * Placed inside <LevelProvider> in layout.tsx so useLevel() works correctly.
 * Rendering here (not inside the Header) ensures no parent transform/filter
 * creates a new stacking context, so position:fixed works at the viewport level.
 */

import { XPNotificationTestPanel } from "./XPNotificationTestPanel";
import { AchievementsTestPanel } from "./AchievementsTestPanel";

export function DevPanelsWrapper() {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <>
      <XPNotificationTestPanel />
      <AchievementsTestPanel />
    </>
  );
}
