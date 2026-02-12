import { redirect } from "next/navigation";

import { auth } from "@/features/auth/lib/auth";
import { SettingsDialog } from "@/components/settings-dialog";

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth?form=login");
  }

  return (
    <div className="min-h-svh p-6 md:p-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
        <p className="text-slate-300">
          Settings UI is currently provided as a dialog in the header. This page provides an entry point for mobile navigation.
        </p>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <SettingsDialog />
        </div>
      </div>
    </div>
  );
}
