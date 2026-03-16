import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { AdminDashboardClient } from "./page-client";

export const runtime = "nodejs";

export default async function AdminPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth?callbackUrl=/admin");
  }

  if (session.user.role !== "admin") {
    redirect("/forbidden?from=admin");
  }

  return <AdminDashboardClient isProduction={process.env.NODE_ENV === "production"} />;
}
