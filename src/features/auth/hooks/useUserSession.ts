// useUserSession.ts
"use client";
import { useEffect, useState } from "react";
import { logger } from '@/log/clientLogger'; // المسار المعدل

/**
 * Provides current user session information
 * @returns User ID from active session
 */
export const useUserSession = () => {
  const [userId, setUserId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Session fetching on component mount
  useEffect(() => {
    const fetchSession = async () => {
      setIsLoading(true);
      try {
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "force-cache" // استفد من التخزين المؤقت
        });

        if (!response.ok) {
          throw new Error(`Session check failed: ${response.status}`);
        }

        const { valid, userId: sessionUserId } = await response.json();
        
        if (valid && sessionUserId) {
          setUserId(sessionUserId);
          logger.auth.debug("Session validated", { userId: sessionUserId });
        } else {
          setUserId(undefined);
          logger.auth.debug("No valid session found");
        }
      } catch (err) {
        setError(err as Error);
        logger.auth.error("Session fetch error", err as Error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, []);


  return { userId, isLoading, error };
};