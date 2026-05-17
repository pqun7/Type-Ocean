"use client";

import * as React from "react";

import { loadAppSettings, resetAppSettings, saveAppSettings } from "./storage";
import { AppSettings, DEFAULT_APP_SETTINGS } from "./types";
import {
  getArabicTypingFontOption,
  getEnglishTypingFontOption,
} from "./typingFonts";

const SETTINGS_SYNC_DEBOUNCE_MS = 450;

type SettingsUserResponse = {
  user?: {
    profile?: {
      appSettings?: AppSettings | null;
    } | null;
  } | null;
};

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
  const syncTimeoutRef = React.useRef<number | null>(null);
  const hasHydratedRef = React.useRef(false);

  React.useEffect(() => {
    const localSettings = loadAppSettings();
    setSettings(localSettings);

    let cancelled = false;

    void fetch("/api/user", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as SettingsUserResponse;
      })
      .then((payload) => {
        if (cancelled) return;
        const remoteSettings = payload?.user?.profile?.appSettings;
        if (!remoteSettings) return;
        saveAppSettings(remoteSettings);
        setSettings(remoteSettings);
      })
      .catch(() => {
        // ignore anonymous or transient failures and keep local settings
      })
      .finally(() => {
        if (!cancelled) {
          hasHydratedRef.current = true;
        }
      });

    return () => {
      cancelled = true;
      if (syncTimeoutRef.current != null) {
        window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--font-user-english",
      getEnglishTypingFontOption(settings.englishTypingFont).cssFamily
    );
    root.style.setProperty(
      "--font-user-arabic",
      getArabicTypingFontOption(settings.arabicTypingFont).cssFamily
    );
  }, [settings.arabicTypingFont, settings.englishTypingFont]);

  const persistServerSettings = React.useCallback((next: AppSettings) => {
    if (syncTimeoutRef.current != null) {
      window.clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = window.setTimeout(() => {
      void fetch("/api/user", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          profileData: {
            appSettings: next,
          },
        }),
      }).catch(() => {
        // keep local settings even if remote sync fails
      });
    }, SETTINGS_SYNC_DEBOUNCE_MS);
  }, []);

  const updateSettings = React.useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveAppSettings(next);
      if (hasHydratedRef.current) {
        persistServerSettings(next);
      }
      return next;
    });
  }, [persistServerSettings]);

  const resetSettingsAll = React.useCallback(() => {
    resetAppSettings();
    setSettings(DEFAULT_APP_SETTINGS);
    if (hasHydratedRef.current) {
      persistServerSettings(DEFAULT_APP_SETTINGS);
    }
  }, [persistServerSettings]);

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
