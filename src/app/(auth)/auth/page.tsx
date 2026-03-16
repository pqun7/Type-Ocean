import { AuthForm } from "@/components/auth/auth-form";
import { auth } from "@/lib/auth";
import VerifiedMessage from "@/components/auth/verification/VerifiedMessage";
import { HandleAuthErrors } from "@/components/handle-auth-errors";
import { redirect } from "next/navigation";

export default async function AuthPage() {
  const session = await auth();

  // Prevent accessing the auth page when already logged in.
  if (session?.user?.id) {
    redirect("/home");
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <HandleAuthErrors />
      <VerifiedMessage />
      <div className="flex w-full flex-col gap-6">
        <AuthForm />
      </div>
    </div>
  );
}

