// src/components/auth/verification/email-verification-button.tsx
"use client";

import { useTransition } from "react";
import { resendVerificationEmail } from "@/actions/email-verification";
import { useAlert } from "@/contexts/alert-context";
import { Button } from "@/components/ui/button";

export function EmailVerificationButton({ email }: { email: string }) {
  const [isPending, startTransition] = useTransition();
  const { showAlert } = useAlert();

  const handleResend = () => {
    startTransition(async () => {
      const result = await resendVerificationEmail(email);
      if (result.success) {
        showAlert("The activation link has been sent to your email.", "success");
      } else {
        showAlert(result.error || "Failed to send the message.", "error");
      }
    });
  };

  return (
    <Button 
      onClick={handleResend}
      disabled={isPending}
      variant="outline"
      type="button"
      className="font-medium rounded-lg py-5 w-full border-[#fb923c] hover:bg-[#fb923c]/20 text-[#fb923c] hover:text-[#fed7aa] transition-colors duration-300"
    >
      {isPending ? "Sending..." : "Resend Activation Link"}
    </Button>
  );
}