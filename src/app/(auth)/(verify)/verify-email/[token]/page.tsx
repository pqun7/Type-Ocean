import { verifyEmail } from "@/actions/verify-email";
import { redirect } from "next/navigation";
import { auth } from "@/features/auth/lib/auth";

export default async function EmailVerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth()
  const result = (await verifyEmail(token)) as unknown as { success: boolean }

  const redirectPath = session ? "/dashboard" : "/auth/signin"
  const statusParam = result.success ? "success" : "error"

  return redirect(`${redirectPath}?verified=${statusParam}`)
}
