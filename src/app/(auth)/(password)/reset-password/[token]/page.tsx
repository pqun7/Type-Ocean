import { ResetPasswordForm } from "@/components/auth/password/reset-password-form";

export default function ResetPasswordPage({
  params,
}: {
  params: { token: string };
}) {
  return (
    <div className="container flex min-h-screen items-center justify-center">
      <ResetPasswordForm token={params.token} />
    </div>
  );
}