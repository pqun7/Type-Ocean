"use client";

import * as React from "react";
import { Howl, Howler } from "howler";

import { useSettings } from "@/features/settings/context";
import {
  pickSingleKeySfxId,
  SINGLE_KEY_SFX_FILES,
  type KeyEventLike,
  type SingleKeySfxId,
} from "@/features/audio/sfx/singleKeys";

type AudioContextValue = {
  playKeyClick: () => void;
  playKeyForEvent: (e: KeyEventLike) => void;
};

const AudioContext = React.createContext<AudioContextValue | null>(null);

const FALLBACK_CLICK_WAV_DATA_URI =
  "data:audio/wav;base64,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";

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();

  const howlRef = React.useRef<Partial<Record<SingleKeySfxId, Howl>>>({});
  const html5FallbackRef = React.useRef<Partial<Record<SingleKeySfxId, boolean>>>({});
  const brokenRef = React.useRef<Partial<Record<SingleKeySfxId, true>>>({});

  const fallbackHowlRef = React.useRef<Howl | null>(null);
  const fallbackHtml5Ref = React.useRef(false);

  const createHowl = React.useCallback(
    (id: SingleKeySfxId, src: string, html5: boolean) => {
      return new Howl({
        src: [src],
        preload: true,
        html5,
        pool: 8,
        volume: Math.max(0, Math.min(1, settings.soundEffectsVolume / 100)),
        onloaderror: () => {
          // If the file is missing/blocked, mark as broken and avoid retry storms.
          brokenRef.current[id] = true;

          console.warn(
            `[SFX] Failed to load sound file for ${id}: ${src}. ` +
              `Place files under public/audio/single-keys/ (e.g. ${src}).`
          );

          if (html5FallbackRef.current[id]) return;
          html5FallbackRef.current[id] = true;
          try {
            howlRef.current[id]?.unload();
          } catch {
            // ignore
          }
          howlRef.current[id] = createHowl(id, src, true);
        },
        onplayerror: () => {
          if (html5FallbackRef.current[id]) return;
          html5FallbackRef.current[id] = true;
          try {
            howlRef.current[id]?.unload();
          } catch {
            // ignore
          }
          howlRef.current[id] = createHowl(id, src, true);
        },
      });
    },
    [settings.soundEffectsVolume]
  );

  const ensureFallbackHowl = React.useCallback(() => {
    if (fallbackHowlRef.current) return fallbackHowlRef.current;
    const make = (html5: boolean) =>
      new Howl({
        src: [FALLBACK_CLICK_WAV_DATA_URI],
        preload: true,
        html5,
        pool: 8,
        volume: Math.max(0, Math.min(1, settings.soundEffectsVolume / 100)),
        onloaderror: () => {
          if (fallbackHtml5Ref.current) return;
          fallbackHtml5Ref.current = true;
          try {
            fallbackHowlRef.current?.unload();
          } catch {
            // ignore
          }
          fallbackHowlRef.current = make(true);
        },
        onplayerror: () => {
          if (fallbackHtml5Ref.current) return;
          fallbackHtml5Ref.current = true;
          try {
            fallbackHowlRef.current?.unload();
          } catch {
            // ignore
          }
          fallbackHowlRef.current = make(true);
        },
      });

    fallbackHowlRef.current = make(false);
    return fallbackHowlRef.current;
  }, [settings.soundEffectsVolume]);

  const ensureHowl = React.useCallback(
    (id: SingleKeySfxId) => {
      if (brokenRef.current[id]) return null;
      if (!howlRef.current[id]) {
        const src = SINGLE_KEY_SFX_FILES[id];
        howlRef.current[id] = createHowl(id, src, false);
      }
      return howlRef.current[id] ?? null;
    },
    [createHowl]
  );

  React.useEffect(() => {
    // Warm common keys only (keeps startup light, avoids 32 requests).
    ensureHowl("027"); // Space
    ensureHowl("028"); // Enter
    ensureHowl("029"); // Backspace
    ensureHowl("030"); // Digits
    ensureHowl("031"); // Shift/Caps
    ensureHowl("032"); // Symbols
    ensureHowl("001"); // A

    return () => {
      // Best-effort cleanup; keep simple.
      try {
        for (const howl of Object.values(howlRef.current)) {
          howl?.unload();
        }
      } catch {
        // ignore
      }
      howlRef.current = {};
      html5FallbackRef.current = {};
      brokenRef.current = {};

      try {
        fallbackHowlRef.current?.unload();
      } catch {
        // ignore
      }
      fallbackHowlRef.current = null;
      fallbackHtml5Ref.current = false;
    };
    // Note: cleanup only runs on provider unmount.
  }, [ensureHowl]);

  React.useEffect(() => {
    // Keep volume in sync when settings change.
    const v = Math.max(0, Math.min(1, settings.soundEffectsVolume / 100));
    for (const howl of Object.values(howlRef.current)) {
      howl?.volume(v);
    }
    fallbackHowlRef.current?.volume(v);
  }, [settings.soundEffectsVolume]);

  const playKeyById = React.useCallback(
    (id: SingleKeySfxId) => {
      if (settings.soundEffectsMuted) return;

      // Resume AudioContext on user gesture when possible.
      try {
        const ctx = Howler?.ctx;
        if (ctx && ctx.state === "suspended") {
          void ctx.resume();
        }
      } catch {
        // ignore
      }

      const primary = ensureHowl(id);
      const howl = primary ?? ensureHowl("032") ?? ensureHowl("001") ?? ensureFallbackHowl();
      if (!howl) return;
      try {
        const v = Math.max(0, Math.min(1, settings.soundEffectsVolume / 100));
        howl.volume(v);
        const id = howl.play();
        // Tiny pitch jitter for realism (ASMR feel).
        const rate = 0.985 + Math.random() * 0.03;
        (howl as unknown as { rate?: (r: number, soundId?: number) => void }).rate?.(rate, id);
      } catch {
        // ignore
      }
    },
    [ensureFallbackHowl, ensureHowl, settings.soundEffectsMuted, settings.soundEffectsVolume]
  );

  const playKeyForEvent = React.useCallback(
    (e: KeyEventLike) => {
      const picked = pickSingleKeySfxId(e);
      if (!picked) return;
      playKeyById(picked);
    },
    [playKeyById]
  );

  const playKeyClick = React.useCallback(() => {
    // Back-compat: treat as generic keypress.
    playKeyById("001");
  }, [playKeyById]);

  const value = React.useMemo<AudioContextValue>(
    () => ({ playKeyClick, playKeyForEvent }),
    [playKeyClick, playKeyForEvent]
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio(): AudioContextValue {
  const ctx = React.useContext(AudioContext);
  if (!ctx) throw new Error("useAudio must be used within AudioProvider");
  return ctx;
}
