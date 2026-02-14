"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAlert } from "@/contexts/alert-context";
import { consumeFlashCookie } from "@/lib/flash-cookies";

export default function VerifiedMessage() {
  const { showAlert } = useAlert();
  const searchParams = useSearchParams();

  const verificationStatus = searchParams.get("verified");

  useEffect(() => {
    const flash = consumeFlashCookie("__flash_verified");
    if (flash) {
      if (flash === "success") {
        showAlert("Email verified successfully!", "success");
      } else if (flash === "false" || flash === "failed") {
        showAlert("Email verification failed.", "error");
      } else if (flash === "already") {
        showAlert("Email already verified.", "success");
      }
      return;
    }

    if (verificationStatus === "success") {
      showAlert("Email verified successfully!", "success");
    } else if (verificationStatus === "false") {
      showAlert("Email verification failed.", "error");
    }
  }, [verificationStatus, showAlert]);

  return null;
}
