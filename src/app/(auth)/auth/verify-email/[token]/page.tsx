import { verifyEmail } from "@/actions/verify-email"
import { redirect } from "next/navigation"

export default async function EmailVerificationPage({
  params,
}: {
  params: { token: string }
}) {
  const result = await verifyEmail(params.token)

  if (result.success) {
    redirect('/home?verified=success')
  } else {
    redirect('/home?verified=error')
  }
}