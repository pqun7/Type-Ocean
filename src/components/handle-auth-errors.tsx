// components/handle-auth-errors.tsx
"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAlert } from "@/contexts/alert-context";
import { mapErrorToMessage } from "@/constants/errors";

export function HandleAuthErrors() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const { showAlert } = useAlert();
  const prevError = useRef<string | null>(null);

  useEffect(() => {
    // التحقق من وجود خطأ جديد ومختلف عن السابق
    if (error && error !== prevError.current) {
      const message = mapErrorToMessage(error);
      showAlert(message, "error");
      prevError.current = error; // تحديث المرجع بالقيمة الحالية
      
      // إزالة معلمة الخطأ من URL دون إعادة تحميل الصفحة
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("error");
      window.history.replaceState(null, "", `?${newParams.toString()}`);
    }
  }, [error, searchParams, showAlert]); // إضافة searchParams ك dependency

  return null;
}