"use client";

import * as React from "react";

import { loadAppSettings, resetAppSettings, saveAppSettings } from "./storage";
import { AppSettings, DEFAULT_APP_SETTINGS } from "./types";

type SettingsContextValue = {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
};

const SettingsContext = React.createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // IMPORTANT: Keep the initial render identical between server and client to avoid hydration mismatches.
  // We always start with defaults, then load from localStorage after mount.
  const [settings, setSettings] = React.useState<AppSettings>(DEFAULT_APP_SETTINGS);

  React.useEffect(() => {
    setSettings(loadAppSettings());
  }, []);

  const updateSettings = React.useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveAppSettings(next);
      return next;
    });
  }, []);

  const resetSettingsAll = React.useCallback(() => {
    resetAppSettings();
    setSettings(DEFAULT_APP_SETTINGS);
  }, []);

  const value = React.useMemo<SettingsContextValue>(
    () => ({
      settings,
      updateSettings,
      resetSettings: resetSettingsAll,
    }),
    [settings, updateSettings, resetSettingsAll]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return ctx;
}
