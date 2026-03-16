// src/app/verify/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { VerifyEmailOtpForm } from "@/components/auth/verification/verify-email-otp-form";

export default async function VerifyPage() {
  const session = await auth();

  if (!session) redirect("/auth?signin");
  const rows = await db
    .select({
      emailVerified: users.emailVerified,
      email: users.email,
      pendingEmail: users.pendingEmail,
      emailVerifyOtpSentAt: users.emailVerifyOtpSentAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const user = rows[0] ?? null;

  if (!user) redirect("/auth?signin");
  if (user.emailVerified && !user.pendingEmail) redirect("/home");

  const destination = (user.pendingEmail ?? user.email).toLowerCase().trim();
  const initialSentAt = user.emailVerifyOtpSentAt ? user.emailVerifyOtpSentAt.toISOString() : null;

  return (
    <div className="container flex min-h-screen items-center justify-center">
      <VerifyEmailOtpForm destinationEmail={destination} initialSentAt={initialSentAt} />
    </div>
  );
}
