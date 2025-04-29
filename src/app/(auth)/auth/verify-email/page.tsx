import { verifyEmail } from "@/actions/email-verification"
import { redirect } from "next/navigation"

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  if (!searchParams.token) return redirect("/auth")

  const { success, error } = await verifyEmail(searchParams.token)

  return (
    <div className="max-w-md mx-auto mt-20 p-6 bg-white rounded-lg shadow">
      <h1 className="text-2xl font-bold mb-4">تفعيل البريد الإلكتروني</h1>
      {success && (
        <div className="text-green-600">
          تم تفعيل البريد الإلكتروني بنجاح!
        </div>
      )}
      {error && <div className="text-red-600">{error}</div>}
    </div>
  )
}