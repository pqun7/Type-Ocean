import { ForgotPasswordForm } from "@/components/auth/password/forgot-password-form";
import Header from "@/components/layout/Header/Header";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <>
      <Header />
      <div className="container flex min-h-screen items-center justify-center pt-[4.75rem] lg:pt-[5.25rem]">
        <ForgotPasswordForm />
      </div>
    </>
  );
}
