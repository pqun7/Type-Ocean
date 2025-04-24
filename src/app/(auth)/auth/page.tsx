// app/(auth)/auth/page.tsx
import { AuthForm } from "@/components/auth/auth-form";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignOut } from "@/components/auth/sign-out";

const AuthPage = async () => {
  const session = await auth();
  console.log("SESSION:", session);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <p className="font-medium text-cyan-100">
        {session?.user.username || "No name found"}
      </p>
      <p className="font-medium text-cyan-100">
        {session?.user.email || "No email found"}
      </p>
      <div className="flex w-full flex-col gap-6">
        <AuthForm />
      </div>
      <SignOut />
    </div>
  );
};

export default AuthPage;
