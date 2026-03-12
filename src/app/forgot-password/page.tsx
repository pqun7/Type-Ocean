import { ForgotPasswordForm } from "@/components/auth/password/forgot-password-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <div className="container flex min-h-screen items-center justify-center">
      <ForgotPasswordForm />
    </div>
  );
}