"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useUserSession } from "@/features/auth/hooks/useUserSession";

type FeedbackCategory = "complaint" | "suggestion" | "rating" | "bug" | "other";

type FeedbackEntry = {
  id: string;
  category: FeedbackCategory;
  status: string;
  subject: string;
  body: string;
  rating: number | null;
  imageUrl: string | null;
  adminReplyTitle: string | null;
  adminReplyBody: string | null;
  respondedAt: string | null;
  createdAt: string;
};

const categoryLabels: Record<FeedbackCategory, string> = {
  complaint: "Complaint",
  suggestion: "Suggestion",
  rating: "Rating",
  bug: "Bug",
  other: "Other",
};

export function FeedbackDialog() {
  const { isAuthenticated, isLoading } = useUserSession();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [rating, setRating] = useState("5");
  const [image, setImage] = useState<File | null>(null);

  const showRatingField = category === "rating";

  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [entries]
  );

  const loadFeedback = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { feedback: FeedbackEntry[] };
      setEntries(payload.feedback ?? []);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!open || !isAuthenticated) {
      return;
    }

    void loadFeedback();
  }, [isAuthenticated, open]);

  if (isLoading || !isAuthenticated) {
    return null;
  }

  const submitFeedback = async () => {
    setStatusMessage(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set("category", category);
      formData.set("subject", subject);
      formData.set("body", body);

      if (showRatingField) {
        formData.set("rating", rating);
      }

      if (image) {
        formData.set("image", image);
      }

      const response = await fetch("/api/feedback", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setStatusMessage(payload?.error ?? "Failed to send feedback.");
        return;
      }

      setSubject("");
      setBody("");
      setImage(null);
      setRating("5");
      setCategory("suggestion");
      setStatusMessage("Your message was sent to the admin team.");
      await loadFeedback();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-cyan-300/25 bg-[linear-gradient(135deg,rgba(34,211,238,0.18),rgba(14,116,144,0.4))] px-4 py-3 text-sm font-semibold text-cyan-50 shadow-[0_14px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:border-cyan-200/40 hover:bg-[linear-gradient(135deg,rgba(34,211,238,0.24),rgba(14,116,144,0.48))]"
        >
          <MessageSquarePlus className="h-4 w-4" />
          Feedback
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-cyan-300/15 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_34%),rgba(2,6,23,0.92)]">
        <DialogHeader>
          <DialogTitle>Contact Admins</DialogTitle>
          <DialogDescription>
            Send a complaint, suggestion, bug report, or rating. You can optionally attach one image, and admin replies will appear here and in the admin notice dialog.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(categoryLabels) as FeedbackCategory[]).map((value) => {
                const active = value === category;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    className={active
                      ? "rounded-full border border-cyan-300/30 bg-cyan-400/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-100"
                      : "rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300 transition hover:border-cyan-300/20 hover:text-cyan-100"}
                  >
                    {categoryLabels[value]}
                  </button>
                );
              })}
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Subject</label>
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Short summary" />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Message</label>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={7}
                className="flex w-full rounded-2xl border border-white/10 bg-transparent px-3 py-3 text-sm text-slate-100 shadow-sm outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/40"
                placeholder="Describe the issue, suggestion, or rating details."
              />
            </div>

            {showRatingField ? (
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Rating</label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={rating}
                    onChange={(event) => setRating(event.target.value)}
                    className="max-w-[120px]"
                  />
                  <div className="flex items-center gap-1 text-amber-300">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className={`h-4 w-4 ${index < Number(rating || 0) ? "fill-current" : "opacity-30"}`} />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.24em] text-slate-400">Optional image</label>
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => setImage(event.target.files?.[0] ?? null)}
                className="cursor-pointer"
              />
              <div className="text-xs text-slate-400">
                PNG, JPG, or WebP up to 4 MB.
                {image ? ` Selected: ${image.name}` : ""}
              </div>
            </div>

            {statusMessage ? (
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                {statusMessage}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Recent feedback</div>
                <div className="mt-1 text-sm text-slate-300">Track replies and status updates from admins.</div>
              </div>
              <Button className="bg-white/10 text-white hover:bg-white/15" onClick={() => void loadFeedback()} disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </div>

            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {sortedEntries.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-sm text-slate-300">
                  No feedback submitted yet.
                </div>
              ) : sortedEntries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{entry.subject}</span>
                    <span className="rounded-full border border-cyan-400/20 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-cyan-200">
                      {categoryLabels[entry.category]}
                    </span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                      {entry.status}
                    </span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{entry.body}</div>
                  <div className="mt-2 text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString()}</div>
                  {entry.rating ? (
                    <div className="mt-2 text-xs text-amber-300">Rating: {entry.rating}/5</div>
                  ) : null}
                  {entry.imageUrl ? (
                    <a href={entry.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-cyan-200 underline-offset-4 hover:underline">
                      Open attached image
                    </a>
                  ) : null}
                  {entry.adminReplyTitle && entry.adminReplyBody ? (
                    <div className="mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3">
                      <div className="text-sm font-semibold text-emerald-100">{entry.adminReplyTitle}</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-50/90">{entry.adminReplyBody}</div>
                      <div className="mt-2 text-xs text-emerald-200/70">
                        Replied {entry.respondedAt ? new Date(entry.respondedAt).toLocaleString() : "recently"}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button className="bg-white/10 text-white hover:bg-white/15" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            className="bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30"
            onClick={() => void submitFeedback()}
            disabled={isSubmitting || subject.trim().length < 3 || body.trim().length < 10}
          >
            {isSubmitting ? "Sending..." : "Send to admins"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}