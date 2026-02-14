import { verifyEmail } from "@/actions/verify-email";

export default async function EmailVerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // `verifyEmail` performs the redirect on success/failure.
  await verifyEmail(token);
  return null;
}
