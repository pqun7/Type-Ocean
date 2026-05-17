"use client";

import * as React from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useSettings } from "@/features/settings/context";
import type { FontScale } from "@/features/settings/types";
import {
  ARABIC_TYPING_FONT_OPTIONS,
  ENGLISH_TYPING_FONT_OPTIONS,
  type ArabicTypingFontId,
  type EnglishTypingFontId,
} from "@/features/settings/typingFonts";
import { TYPING_LANGUAGES, type TypingLanguage } from "@/features/typing/i18n/typingLanguages";
import { cn } from "@/lib/utils";

type UserApiResponse = {
  user?: {
    id: string;
    profile?: {
      hideFromLeaderboard?: boolean;
    } | null;
  };
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch");
  return (await res.json()) as UserApiResponse;
};

function SettingRow(props: {
  title: string;
  description?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { title, description, children, disabled } = props;
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4",
        disabled && "opacity-60"
      )}
      aria-disabled={disabled ? true : undefined}
    >
      <div className="space-y-1">
        <div className="text-sm font-medium text-[#E0E7FF]">{title}</div>
        {description ? (
          <div className="text-xs text-[#8A8FB5]">{description}</div>
        ) : null}
      </div>
      <div className="pt-0.5">{children}</div>
    </div>
  );
}

function FontPresetButton<T extends string>(props: {
  option: {
    id: T;
    label: string;
    description: string;
    sample: string;
    cssFamily: string;
  };
  selected: boolean;
  dir: "ltr" | "rtl";
  lang: string;
  onSelect: (value: T) => void;
}) {
  const { option, selected, dir, lang, onSelect } = props;

  return (
    <button
      type="button"
      onClick={() => onSelect(option.id)}
      className={cn(
        "group rounded-2xl border p-3 text-left transition-all duration-200",
        "bg-[rgba(12,28,46,0.72)] backdrop-blur-sm",
        selected
          ? "border-cyan-300/60 bg-[rgba(35,88,132,0.35)] shadow-[0_0_0_1px_rgba(125,211,252,0.15)]"
          : "border-[rgba(160,220,255,0.12)] hover:border-[rgba(160,220,255,0.35)] hover:bg-[rgba(24,54,82,0.5)]"
      )}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[#E0E7FF]">{option.label}</div>
          <div className="text-[11px] text-[#8A8FB5]">{option.description}</div>
        </div>
        {selected ? (
          <span className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
            Active
          </span>
        ) : null}
      </div>

      <div
        className="mt-3 rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-sm leading-7 text-white/90"
        dir={dir}
        lang={lang}
        style={{ fontFamily: option.cssFamily }}
      >
        {option.sample}
      </div>
    </button>
  );
}

export function SettingsContent(props: { className?: string; onRequestClose?: () => void }) {
  const { className, onRequestClose } = props;
  const { settings, updateSettings, resetSettings } = useSettings();

  const { data, mutate, isLoading } = useSWR<UserApiResponse>("/api/user", fetcher);

  const [savingLeaderboard, setSavingLeaderboard] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);

  const hideFromLeaderboard = data?.user?.profile?.hideFromLeaderboard ?? false;

  const setHideFromLeaderboard = async (next: boolean) => {
    if (savingLeaderboard) return;
    setSavingLeaderboard(true);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileData: { hideFromLeaderboard: next } }),
      });
      if (!res.ok) {
        throw new Error("Failed to update leaderboard visibility");
      }
      await mutate();
    } finally {
      setSavingLeaderboard(false);
    }
  };

  const resetAll = async () => {
    // Reset local settings first
    resetSettings();

    // Reset server-backed settings best-effort
    try {
      await fetch("/api/user", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileData: { hideFromLeaderboard: false } }),
      });
      await mutate();
    } catch {
      // ignore
    }

    setResetOpen(false);
    onRequestClose?.();
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#E0E7FF]">Settings</h2>
          <p className="text-sm text-[#8A8FB5]">
            Control the experience, performance, and privacy.
          </p>
        </div>
      </div>

      {/* Performance Card */}
      <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-[#E0E7FF]">
            Performance and Results Interface
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            title="Show chart after session ends"
            description="Disabling this hides the chart or heatmap panel and keeps the results stats visible."
          >
            <Switch
              checked={settings.showSessionChart}
              onCheckedChange={(v) => updateSettings({ showSessionChart: v })}
            />
          </SettingRow>

          <Separator className="bg-[rgba(160,220,255,0.15)]" />

          <SettingRow
            title="Reduce motion"
            description="Reduces/disables animations for a calmer experience."
          >
            <Switch
              checked={settings.reduceMotion}
              onCheckedChange={(v) => updateSettings({ reduceMotion: v })}
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Sound Card */}
      <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-[#E0E7FF]">
            Sound and Notifications
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            title="Mute sound effects"
            description="Disables the key-click sound while typing."
          >
            <Switch
              checked={settings.soundEffectsMuted}
              onCheckedChange={(v) => updateSettings({ soundEffectsMuted: v })}
            />
          </SettingRow>

          <div
            className={cn(
              "flex items-start justify-between gap-4",
              settings.soundEffectsMuted && "opacity-60"
            )}
            aria-disabled={settings.soundEffectsMuted ? true : undefined}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium text-[#E0E7FF]">
                Volume + Sound effects (Key click)
              </div>
              <div className="text-xs text-[#8A8FB5]">
                Comfortable, quiet key-click sound.
              </div>
            </div>
            <div className="pt-0.5 w-[220px]">
            <div className="flex items-center gap-3">
                <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={settings.soundEffectsVolume}
                disabled={settings.soundEffectsMuted}
                onChange={(e) =>
                    updateSettings({ soundEffectsVolume: Number(e.target.value) })
                }
                className="volume-slider w-full disabled:cursor-not-allowed"
                />
                <div className="text-xs tabular-nums text-[#8A8FB5] w-[44px] text-right">
                {settings.soundEffectsVolume}%
                </div>
            </div>
            </div>
          </div>

          <Separator className="bg-[rgba(160,220,255,0.15)]" />

          <SettingRow
            title="XP Notifications"
            description="Hide XP notifications"
          >
            <Switch
              checked={settings.hideXpNotifications}
              onCheckedChange={(v) => updateSettings({ hideXpNotifications: v })}
            />
          </SettingRow>

          <SettingRow
            title="PvP notifications: Match invitations"
            description="Future feature"
            disabled
          >
            <Switch
              checked={false}
              disabled
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Accessibility Card */}
      <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-[#E0E7FF]">Accessibility</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm text-[#E0E7FF]">Font size</Label>
            <Select
              value={settings.fontScale}
              onValueChange={(v) => updateSettings({ fontScale: v as FontScale })}
            >
              <SelectTrigger className="w-[220px] border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.3)] text-[#E0E7FF] placeholder:text-[#8A8FB5] focus:border-[rgba(160,220,255,0.6)] backdrop-blur-sm">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="bg-[rgba(20,50,80,0.9)] backdrop-blur-sm border-[rgba(160,220,255,0.15)] text-[#E0E7FF]">
                <SelectItem value="default" className="hover:bg-[rgba(160,220,255,0.1)] focus:bg-[rgba(160,220,255,0.15)] focus:text-[#E0E7FF] transition-colors cursor-pointer">Default</SelectItem>
                <SelectItem value="large" className="hover:bg-[rgba(160,220,255,0.1)] focus:bg-[rgba(160,220,255,0.15)] focus:text-[#E0E7FF] transition-colors cursor-pointer">Large</SelectItem>
                <SelectItem value="xlarge" className="hover:bg-[rgba(160,220,255,0.1)] focus:bg-[rgba(160,220,255,0.15)] focus:text-[#E0E7FF] transition-colors cursor-pointer">XL</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-[#8A8FB5]">The caret will scale with the font.</div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-[#E0E7FF]">Typing language</Label>
            <Select
              value={settings.typingLanguage}
              onValueChange={(v) => updateSettings({ typingLanguage: v as TypingLanguage })}
            >
              <SelectTrigger className="w-[220px] border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.3)] text-[#E0E7FF] placeholder:text-[#8A8FB5] focus:border-[rgba(160,220,255,0.6)] backdrop-blur-sm">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent className="bg-[rgba(20,50,80,0.9)] backdrop-blur-sm border-[rgba(160,220,255,0.15)] text-[#E0E7FF]">
                {(Object.entries(TYPING_LANGUAGES) as Array<
                  [TypingLanguage, { label: string; dir: "ltr" | "rtl"; locale: string }]
                >).map(([value, meta]) => (
                  <SelectItem
                    key={value}
                    value={value}
                    className="hover:bg-[rgba(160,220,255,0.1)] focus:bg-[rgba(160,220,255,0.15)] focus:text-[#E0E7FF] transition-colors cursor-pointer"
                  >
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator className="bg-[rgba(160,220,255,0.15)]" />

          <div className="space-y-3">
            <div>
              <Label className="text-sm text-[#E0E7FF]">
                {settings.typingLanguage === "ar" ? "Arabic typing font" : "English typing font"}
              </Label>
              <div className="mt-1 text-xs text-[#8A8FB5]">
                {settings.typingLanguage === "ar"
                  ? "Applied to Arabic typing surfaces, previews, and user text entry."
                  : "Applied to English typing surfaces, previews, and user text entry."}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {settings.typingLanguage === "ar"
                ? ARABIC_TYPING_FONT_OPTIONS.map((option) => (
                    <FontPresetButton<ArabicTypingFontId>
                      key={option.id}
                      option={option}
                      selected={settings.arabicTypingFont === option.id}
                      dir="rtl"
                      lang="ar"
                      onSelect={(value) => updateSettings({ arabicTypingFont: value })}
                    />
                  ))
                : ENGLISH_TYPING_FONT_OPTIONS.map((option) => (
                    <FontPresetButton<EnglishTypingFontId>
                      key={option.id}
                      option={option}
                      selected={settings.englishTypingFont === option.id}
                      dir="ltr"
                      lang="en"
                      onSelect={(value) => updateSettings({ englishTypingFont: value })}
                    />
                  ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Privacy Card */}
      <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-[#E0E7FF]">
            Privacy and Visibility
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            title="Hide from leaderboard"
            description={
              isLoading ? "Loading…" : "When enabled, your account will not appear on the leaderboard."
            }
          >
            <Switch
              checked={hideFromLeaderboard}
              onCheckedChange={(v) => setHideFromLeaderboard(v)}
              disabled={savingLeaderboard || isLoading}
            />
          </SettingRow>

          <SettingRow
            title="Who can invite you to PvP"
            description="Future feature"
            disabled
          >
            <Switch
              checked={false}
              disabled
            />
          </SettingRow>
        </CardContent>
      </Card>

      {/* Advanced Card */}
      <Card className="border border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm shadow-xl hover:border-[rgba(160,220,255,0.3)] transition-all">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-[#E0E7FF]">Advanced</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setResetOpen(true)}
              className="border-[rgba(160,220,255,0.3)] bg-[rgba(20,50,80,0.5)] text-cyan-300 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.6)] hover:bg-[rgba(20,50,80,0.8)]"
            >
              Reset settings to default
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="border-[rgba(160,220,255,0.15)] bg-[rgba(20,50,80,0.3)] backdrop-blur-sm text-[#E0E7FF]">
          <DialogHeader>
            <DialogTitle className="text-[#E0E7FF]">Reset settings</DialogTitle>
            <DialogDescription className="text-[#8A8FB5]">
              This resets local settings and restores leaderboard visibility.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setResetOpen(false)}
              className="border-red-400/50 bg-transparent text-red-300 backdrop-blur-sm transition-all hover:border-red-400 hover:bg-red-500/20"
            >
              Cancel
            </Button>
            <Button
              onClick={resetAll}
              className="border-[rgba(160,220,255,0.5)] bg-[rgba(20,50,80,0.5)] text-cyan-300 backdrop-blur-sm transition-all hover:border-[rgba(160,220,255,0.8)] hover:bg-[rgba(20,50,80,0.8)]"
            >
              Reset
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}