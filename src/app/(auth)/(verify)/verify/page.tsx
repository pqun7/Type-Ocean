// src/app/verify/page.tsx
import { auth } from "@/features/auth/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/features/auth/lib/db";
import { VerifyEmailOtpForm } from "@/components/auth/verification/verify-email-otp-form";

export default async function VerifyPage() {
  const session = await auth();

  if (!session) redirect("/auth?signin");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { emailVerified: true, email: true, pendingEmail: true, emailVerifyOtpSentAt: true },
  });

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