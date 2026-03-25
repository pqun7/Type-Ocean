// src/app/profile/delete-account-button.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { signOut as nextAuthSignOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAlert } from "@/contexts/alert-context";
import { cn } from "@/lib/utils";

export function DeleteAccountButton({ className }: { className?: string }) {
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

      await nextAuthSignOut({ redirect: false });

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
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={deleting}
        className={cn(
          "w-full font-medium rounded-lg py-5 text-base border border-red-500/50 bg-transparent text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors duration-300",
          className
        )}
      >
        Delete account
      </Button>

      <AnimatePresence>
        {open && (
          <DialogContent
            className="border-white/10 bg-[#0a0a1f]/90 text-[#E0E7FF] backdrop-blur-lg"
            forceMount
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <DialogHeader>
                <DialogTitle className="font-grotesk text-[#E0E7FF]">Delete account</DialogTitle>
                <DialogDescription className="text-sm text-[#8A8FB5]">
                  This will permanently delete your account and related data. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 flex flex-col sm:flex-row justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={deleting}
                  className="flex-1 sm:flex-none font-medium rounded-lg py-3.5 text-base border border-[#69d0ff] bg-transparent text-[#60a5fa] hover:bg-[#69d0ff]/20 hover:text-[#93c5fd] transition-all duration-300"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={onDelete}
                  disabled={deleting}
                  className="flex-1 sm:flex-none font-medium rounded-lg py-3.5 text-base border border-red-500/50 bg-transparent text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-all duration-300"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Deleting…
                    </>
                  ) : (
                    "Delete"
                  )}
                </Button>
              </div>
            </motion.div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  );
}