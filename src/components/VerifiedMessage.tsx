"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAlert } from "@/contexts/alert-context";

export default function VerifiedMessage() {
  const { showAlert } = useAlert();
  const searchParams = useSearchParams();

  const verificationStatus = searchParams.get("verified");

  useEffect(() => {
    if (verificationStatus === "true") {
      showAlert("Email verified successfully!", "success");
    } else if (verificationStatus === "false") {
      showAlert("Email verification failed.", "error");
    }
  }, [verificationStatus, showAlert]);

  return null;
}
