"use client";
import useSWR from 'swr';
import { logger } from "@/log/clientLogger";
import { useEffect, useState } from 'react';

const fetcher = async (url: string) => {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'include', // Include cookies for session
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Don't log 401s as errors - they're expected when not authenticated
        return { valid: false, reason: 'not_authenticated' };
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    const loggedError = error instanceof Error ? error : new Error(String(error));
    logger.auth.error("Session fetch failed", loggedError);
    throw loggedError;
  }
};

export const useUserSession = () => {
  const [mounted, setMounted] = useState(false);
  
  // Prevent hydration mismatch by only running SWR after mount
  useEffect(() => {
    setMounted(true);
  }, []);
  
  const { data, error, isLoading, mutate } = useSWR(
  mounted ? '/api/session' : null,
  fetcher, 
  {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    refreshInterval: 300000,
    shouldRetryOnError: (error) => {
      if (error?.message?.includes('401')) return false;
      if (error?.message?.includes('500')) return false;  
      return true;
    },
    errorRetryCount: 1, // قلل من عدد المحاولات
    errorRetryInterval: 10000, // زد الفاصل بين المحاولات
    dedupingInterval: 30000, // زد فترة منع التكرار إلى 30 ثانية
  }
);

  // Only log actual errors, not authentication failures
  if (error && !error.message?.includes('401')) {
    logger.auth.error("Session fetch error", error);
  }

  // Return consistent state during SSR and initial client render
  if (!mounted) {
    return {
      userId: undefined,
      username: undefined,
      email: undefined,
      emailVerified: undefined,
      session: null,
      isLoading: true,
      error: null,
      isAuthenticated: false,
      refreshSession: () => {},
    };
  }

  return {
    userId: data?.valid ? data.userId : undefined,
    username: data?.username,
    email: data?.email,
    emailVerified: data?.emailVerified,
    session: data?.valid ? data : null,
    isLoading,
    error: error && !error.message?.includes('401') ? error : null,
    isAuthenticated: !!data?.valid,
    refreshSession: mutate,
  };
};