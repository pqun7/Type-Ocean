"use client";
import useSWR from 'swr';
import { logger } from '@/log/clientLogger';

const fetcher = (url: string) => fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
}).then(res => res.json());

export const useUserSession = () => {
  const filePath = "hooks/useUserSession.ts";
  
  const { data, error, isLoading } = useSWR('/api/session', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    refreshInterval: 300000, // 5 دقائق
    shouldRetryOnError: false
  });

  // تسجيل الأخطاء
  if (error) {
    logger.auth.error("Session fetch error", filePath, error);
  }

  return {
    userId: data?.valid ? data.userId : undefined,
    isLoading,
    error,
  };
};