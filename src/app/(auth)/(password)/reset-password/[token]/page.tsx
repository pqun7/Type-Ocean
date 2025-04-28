import { ResetPasswordForm } from "@/components/auth/password/reset-password-form";


export default async function ResetPasswordPage({
  params,
}: {
  // note: params is now a Promise
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="container flex min-h-screen items-center justify-center">
      <ResetPasswordForm token={token} />
    </div>
  );
}