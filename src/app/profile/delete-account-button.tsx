"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { signOut as nextAuthSignOut } from "next-auth/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAlert } from "@/contexts/alert-context";

export function DeleteAccountButton() {
  const router = useRouter();
  const { showAlert } = useAlert();

  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);

  async function onDelete() {
    if (deleting) return;

    setDeleting(true);
    try {
      const res = await fetch("/api/user", { method: "DELETE" });
      const data: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "Failed to delete account";
        throw new Error(msg);
      }

      // Ensure session cookies are cleared immediately (JWT sessions won't auto-expire on user deletion).
      await nextAuthSignOut({ redirect: false });

      showAlert("Account deleted", "success");
      setOpen(false);
      router.replace("/auth");
      router.refresh();
    } catch (e) {
      showAlert(e instanceof Error ? e.message : "Failed to delete account", "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        setOpen(next);
      }}
    >
      <Button
        type="button"
        variant="destructive"
        className="w-full"
        onClick={() => setOpen(true)}
        disabled={deleting}
      >
        Delete account
      </Button>

      <DialogContent className="border-white/10 bg-slate-950/90 text-slate-100 backdrop-blur">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription className="text-slate-300">
            This will permanently delete your account and related data. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={deleting}
            className="border-white/10 bg-slate-900/70 text-slate-100 shadow-sm backdrop-blur hover:bg-slate-900"
          >
            Cancel
          </Button>

          <Button type="button" variant="destructive" onClick={onDelete} disabled={deleting}>
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Deleting…
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
