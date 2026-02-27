"use client";

import * as React from "react";
import { Howl, Howler } from "howler";

import { useSettings } from "@/features/settings/context";
import {
  createKeyboardSfxWavUrl,
  type KeyboardSfxKind,
} from "@/features/audio/sfx/softClickWav";

type AudioContextValue = {
  playKeyClick: () => void;
  playKeySfx: (kind: KeyboardSfxKind) => void;
};

const AudioContext = React.createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();

  const sfxSrcRef = React.useRef<Partial<Record<KeyboardSfxKind, string>>>({});
  const sfxHowlRef = React.useRef<Partial<Record<KeyboardSfxKind, Howl>>>({});
  const sfxHtml5FallbackRef = React.useRef<Partial<Record<KeyboardSfxKind, boolean>>>({});

  const createHowl = React.useCallback(
    (kind: KeyboardSfxKind, src: string, html5: boolean) => {
      return new Howl({
        src: [src],
        preload: true,
        html5,
        pool: 8,
        volume: Math.max(0, Math.min(1, settings.soundEffectsVolume / 100)),
        onloaderror: () => {
          if (sfxHtml5FallbackRef.current[kind]) return;
          sfxHtml5FallbackRef.current[kind] = true;
          try {
            sfxHowlRef.current[kind]?.unload();
          } catch {
            // ignore
          }
          sfxHowlRef.current[kind] = createHowl(kind, src, true);
        },
        onplayerror: () => {
          if (sfxHtml5FallbackRef.current[kind]) return;
          sfxHtml5FallbackRef.current[kind] = true;
          try {
            sfxHowlRef.current[kind]?.unload();
          } catch {
            // ignore
          }
          sfxHowlRef.current[kind] = createHowl(kind, src, true);
        },
      });
    },
    [settings.soundEffectsVolume]
  );

  const ensureSfxHowl = React.useCallback(
    (kind: KeyboardSfxKind) => {
      if (!sfxSrcRef.current[kind]) {
        sfxSrcRef.current[kind] = createKeyboardSfxWavUrl(kind);
      }

      if (!sfxHowlRef.current[kind] && sfxSrcRef.current[kind]) {
        sfxHowlRef.current[kind] = createHowl(kind, sfxSrcRef.current[kind]!, false);
      }

      return sfxHowlRef.current[kind] ?? null;
    },
    [createHowl]
  );

  React.useEffect(() => {
    // Warm the sound so it is ready shortly after mount.
    ensureSfxHowl("key");
    ensureSfxHowl("space");
    ensureSfxHowl("enter");
    ensureSfxHowl("tab");

    return () => {
      // Best-effort cleanup; keep simple.
      try {
        for (const howl of Object.values(sfxHowlRef.current)) {
          howl?.unload();
        }
      } catch {
        // ignore
      }
      sfxHowlRef.current = {};
      sfxSrcRef.current = {};
      sfxHtml5FallbackRef.current = {};
    };
    // Note: cleanup only runs on provider unmount.
  }, [ensureSfxHowl]);

  React.useEffect(() => {
    // Keep volume in sync when settings change.
    const v = Math.max(0, Math.min(1, settings.soundEffectsVolume / 100));
    for (const howl of Object.values(sfxHowlRef.current)) {
      howl?.volume(v);
    }
  }, [settings.soundEffectsVolume]);

  const playKeySfx = React.useCallback(
    (kind: KeyboardSfxKind) => {
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

      const howl = ensureSfxHowl(kind);
      if (!howl) return;
      try {
        const v = Math.max(0, Math.min(1, settings.soundEffectsVolume / 100));
        howl.volume(v);
        const id = howl.play();
        // Tiny pitch jitter for realism (ASMR feel).
        const rate = 0.98 + Math.random() * 0.04;
        (howl as unknown as { rate?: (r: number, soundId?: number) => void }).rate?.(rate, id);
      } catch {
        // ignore
      }
    },
    [ensureSfxHowl, settings.soundEffectsMuted, settings.soundEffectsVolume]
  );

  const playKeyClick = React.useCallback(() => {
    playKeySfx("key");
  }, [playKeySfx]);

  const value = React.useMemo<AudioContextValue>(
    () => ({ playKeyClick, playKeySfx }),
    [playKeyClick, playKeySfx]
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio(): AudioContextValue {
  const ctx = React.useContext(AudioContext);
  if (!ctx) throw new Error("useAudio must be used within AudioProvider");
  return ctx;
}
