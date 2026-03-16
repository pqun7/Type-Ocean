import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { SettingsContent } from "@/components/settings-content";

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth?form=login");
  }

  return (
    <div className="min-h-svh p-6 md:p-10">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <SettingsContent />
        </div>
      </div>
    </div>
  );
}

