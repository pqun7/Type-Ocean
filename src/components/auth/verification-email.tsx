"use client"

import { useTransition } from "react"
import { resendVerificationEmail } from "@/actions/email-verification"
import { toast } from "sonner"

export function ResendVerificationEmail({ email }: { email: string }) {
  const [isPending, startTransition] = useTransition()

  const handleResend = async () => {
    startTransition(async () => {
      const { success, error } = await resendVerificationEmail(email)
      if (success) toast.success("تم إعادة إرسال رابط التفعيل")
      if (error) toast.error(error)
    })
  }

  return (
    <div className="mt-4">
      <button
        onClick={handleResend}
        disabled={isPending}
        className="text-blue-600 hover:text-blue-800 text-sm disabled:opacity-50"
      >
        {isPending ? "جاري الإرسال..." : "إعادة إرسال الرابط"}
      </button>
    </div>
  )
}