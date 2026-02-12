import { redirect } from "next/navigation";

import { auth } from "@/features/auth/lib/auth";
import { SignOut } from "@/components/auth/sign-out";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth?form=login");
  }

  return (
    <div className="min-h-svh p-6 md:p-10">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold text-slate-100">Profile</h1>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <p className="text-slate-200">
            <span className="text-slate-400">Username:</span> {session.user.username ?? "—"}
          </p>
          <p className="text-slate-200">
            <span className="text-slate-400">Email:</span> {session.user.email ?? "—"}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <h2 className="text-lg font-medium text-slate-100">Account</h2>
          <div className="mt-3">
            <SignOut />
          </div>
        </div>
      </div>
    </div>
  );
}
