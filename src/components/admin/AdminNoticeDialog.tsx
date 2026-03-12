"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type AdminNotice = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
  expiresAt: string;
};

const severityAccent: Record<AdminNotice["severity"], string> = {
  info: "border-cyan-400/30 text-cyan-200",
  warning: "border-amber-400/30 text-amber-200",
  critical: "border-rose-400/30 text-rose-200",
};

type AdminNoticeDialogProps = {
  initialUserId: string | null;
};

const STREAM_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

export function AdminNoticeDialog({ initialUserId }: AdminNoticeDialogProps) {
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [open, setOpen] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    if (!initialUserId) {
      setNotice(null);
      setOpen(false);
      return;
    }

    let retryTimer: number | null = null;
    let stream: EventSource | null = null;
    let closed = false;
    let failureCount = 0;

    const clearRetryTimer = () => {
      if (retryTimer == null) {
        return;
      }

      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connectStream = () => {
      if (closed) {
        return;
      }

      stream = new EventSource("/api/me/admin-notice/stream", { withCredentials: true });

      stream.addEventListener("ready", () => {
        failureCount = 0;
      });

      stream.addEventListener("notice", (event) => {
        failureCount = 0;
        const payload = JSON.parse((event as MessageEvent).data) as { notice: AdminNotice | null };
        setNotice(payload.notice);
        setOpen(Boolean(payload.notice));
      });

      stream.onerror = () => {
        if (closed) {
          return;
        }

        stream?.close();
        stream = null;
        clearRetryTimer();

        const delayMs = STREAM_RETRY_DELAYS_MS[Math.min(failureCount, STREAM_RETRY_DELAYS_MS.length - 1)];
        failureCount += 1;
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          connectStream();
        }, delayMs);
      };
    };

    connectStream();

    return () => {
      closed = true;
      clearRetryTimer();
      stream?.close();
    };
  }, [initialUserId]);

  const dismissNotice = async () => {
    setIsDismissing(true);
    try {
      await fetch("/api/me/admin-notice", {
        method: "DELETE",
        credentials: "include",
      });
      setNotice(null);
      setOpen(false);
    } finally {
      setIsDismissing(false);
    }
  };

  if (!notice) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs uppercase tracking-[0.24em] ${severityAccent[notice.severity]}`}>
            {notice.severity}
          </div>
          <DialogTitle>{notice.title}</DialogTitle>
          <DialogDescription>
            Sent by an administrator on {new Date(notice.createdAt).toLocaleString()}.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm leading-7 text-slate-100 whitespace-pre-wrap">
          {notice.body}
        </div>

        <div className="text-xs text-slate-400">
          Expires {new Date(notice.expiresAt).toLocaleString()}.
        </div>

        <DialogFooter>
          <Button onClick={dismissNotice} disabled={isDismissing} className="bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30">
            {isDismissing ? "Dismissing..." : "Dismiss"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}