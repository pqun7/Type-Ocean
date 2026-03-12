import { ResetPasswordForm } from "@/components/auth/password/reset-password-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="container flex min-h-screen items-center justify-center">
      <ResetPasswordForm token={token} />
    </div>
  );
}