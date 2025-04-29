import { ResendVerificationEmail } from "@/components/auth/verification-email"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function VerifyPage() {
  const session = await auth()

  if (!session) return redirect("/auth")
  if (session.user.emailVerified) return redirect("/dashboard")

  return (
    <div className="max-w-md mx-auto mt-20 p-6 bg-white rounded-lg shadow">
      <h1 className="text-2xl font-bold mb-4">تفعيل الحساب</h1>
      <p className="mb-4">
        تم إرسال رابط التفعيل إلى بريدك الإلكتروني. الرجاء التحقق من صندوق الوارد.
      </p>
      <ResendVerificationEmail email={session.user.email!} />
    </div>
  )
}