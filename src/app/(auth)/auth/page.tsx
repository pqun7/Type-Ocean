import { AuthForm } from "@/components/auth/auth-form";
import { auth } from "@/lib/auth";
import { SignOut } from "@/components/auth/sign-out";
import VerifiedMessage from "@/components/auth/verification/VerifiedMessage";
import { HandleAuthErrors } from "@/components/handle-auth-errors";

export default async function AuthPage() {
  const session = await auth();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <HandleAuthErrors />
      <VerifiedMessage />

      <p className="font-medium text-cyan-100">
        {session?.user.username || "No name found"}
      </p>
      <p className="font-medium text-cyan-100">
        {session?.user.email || "No email found"}
      </p>
      <p className="font-medium text-cyan-100">
        {session?.user.emailVerified
          ? session.user.emailVerified.toString()
          : "No email found"}
      </p>
      <div className="flex w-full flex-col gap-6">
        <AuthForm />
      </div>
      <SignOut />
    </div>
  );
}
