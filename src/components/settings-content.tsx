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

import { DeleteAccountButton } from "@/app/profile/delete-account-button";

import { useSettings } from "@/features/settings/context";
import type { FontScale } from "@/features/settings/types";
import type { TypingLanguage } from "@/features/typing/i18n/typingLanguages";
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
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-60")}
      aria-disabled={disabled ? true : undefined}
    >
      <div className="space-y-1">
        <div className="text-sm font-medium text-slate-100">{title}</div>
        {description ? <div className="text-xs text-slate-400">{description}</div> : null}
      </div>
      <div className="pt-0.5">{children}</div>
    </div>
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
          <h2 className="text-lg font-semibold text-slate-100">Settings</h2>
          <p className="text-sm text-slate-400">Control the experience, performance, and privacy.</p>
        </div>
        {onRequestClose ? (
          <Button variant="secondary" onClick={onRequestClose}>
            Close
          </Button>
        ) : null}
      </div>

      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-slate-100">Performance and Results Interface</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            title="Show chart after session ends"
            description="Disabling this hides only the chart and keeps the results screen."
          >
            <Switch
              checked={settings.showSessionChart}
              onCheckedChange={(v) => updateSettings({ showSessionChart: v })}
            />
          </SettingRow>

          <Separator className="bg-white/10" />

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

      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-slate-100">Sound and Notifications</div>
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

          <div className={cn("flex items-start justify-between gap-4", settings.soundEffectsMuted && "opacity-60")} aria-disabled={settings.soundEffectsMuted ? true : undefined}>
            <div className="space-y-1">
              <div className="text-sm font-medium text-slate-100">Volume + Sound effects (Key click)</div>
              <div className="text-xs text-slate-400">Comfortable, quiet key-click sound.</div>
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
                  onChange={(e) => updateSettings({ soundEffectsVolume: Number(e.target.value) })}
                  className={cn(
                    "w-full",
                    "accent-white",
                    "disabled:cursor-not-allowed"
                  )}
                />
                <div className="text-xs tabular-nums text-slate-400 w-[44px] text-right">{settings.soundEffectsVolume}%</div>
              </div>
            </div>
          </div>

          <Separator className="bg-white/10" />

          <SettingRow title="XP Notifications" description="Hide XP notifications" >
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
            <Switch checked={false} disabled />
          </SettingRow>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-slate-100">Accessibility</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm text-slate-100">Font size</Label>
            <Select
              value={settings.fontScale}
              onValueChange={(v) => updateSettings({ fontScale: v as FontScale })}
            >
              <SelectTrigger className="w-[220px] border-white/10 bg-white/5 text-slate-100">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="large">Large</SelectItem>
                <SelectItem value="xlarge">XL</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-slate-400">The caret will scale with the font.</div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-slate-100">Typing language</Label>
            <Select
              value={settings.typingLanguage}
              onValueChange={(v) => updateSettings({ typingLanguage: v as TypingLanguage })}
            >
              <SelectTrigger className="w-[220px] border-white/10 bg-white/5 text-slate-100">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">Arabic (RTL)</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-slate-400">Arabic uses right-to-left layout and caret.</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-slate-100">Privacy and Visibility</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            title="Hide from leaderboard"
            description={isLoading ? "Loading…" : "When enabled, your account will not appear on the leaderboard."}
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
            <Switch checked={false} disabled />
          </SettingRow>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/5">
        <CardHeader className="pb-2">
          <div className="text-sm font-semibold text-slate-100">Advanced</div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium text-slate-100">Delete account/data</div>
            <div className="text-xs text-slate-400">The account and all associated data will be permanently deleted.</div>
            <DeleteAccountButton className="max-w-sm" />
          </div>

          <Separator className="bg-white/10" />

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setResetOpen(true)} className="border-white/10 bg-white/5 text-slate-100">
              Reset settings to default
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="border-white/10 bg-[#0a0a1f]/90 text-[#E0E7FF] backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle>Reset settings</DialogTitle>
            <DialogDescription className="text-[#8A8FB5]">
              This resets local settings and restores leaderboard visibility.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={resetAll}>Reset</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
