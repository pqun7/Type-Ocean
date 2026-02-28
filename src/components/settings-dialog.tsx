"use client";

import * as React from "react";
import { GearIcon } from "@radix-ui/react-icons";

import { SettingsContent } from "@/components/settings-content";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SettingsDialog() {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="p-2 px-2 rounded-lg hover:bg-white/10 transition-colors  text-slate-200 hover:text-white"
          aria-label="Settings"
        >
          <GearIcon className="w-6 h-6 scale-150" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex flex-col overflow-hidden p-0 md:max-h-[85vh] md:max-w-[700px] lg:max-w-[800px]">
        <DialogTitle className="sr-only w-6 h-6 transition-transform group-hover:scale-110">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your settings here.
        </DialogDescription>
        <div className="flex-1 overflow-y-auto p-4 pb-12 md:p-6 md:pb-14">
          <SettingsContent onRequestClose={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
