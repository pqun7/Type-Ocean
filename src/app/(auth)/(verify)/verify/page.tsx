// src/app/verify/page.tsx
import { auth } from "@/features/auth/lib/auth";
import { redirect } from "next/navigation";
import { EmailVerificationButton } from "@/components/auth/verification/email-verification-button";

export default async function VerifyPage() {
  const session = await auth();

  if (!session) redirect("/auth?signin");
  if (session.user.emailVerified) redirect("/home");

  return (
    <div className="max-w-md mx-auto mt-20 p-6">
      <h1 className="text-2xl font-bold mb-4">Account Activation</h1>
      <p className="mb-4">Please check your email</p>
      <EmailVerificationButton email={session.user.email!} />
    </div>
  );
}