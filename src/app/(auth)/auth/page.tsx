// app/(auth)/auth/page.tsx
import { AuthForm } from "@/components/auth/auth-form";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

const AuthPage = async () => {
  const session = await auth();
  console.log("SESSION:", session);
  if (session) redirect("/chack-auth"); // Redirect to the authenticated page if already logged in
  
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full flex-col gap-6">
        <AuthForm />
      </div>
    </div>
  );
};

export default AuthPage;
