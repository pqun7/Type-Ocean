// useUserSession.ts
"use client";
import { useEffect, useState } from "react";
import { getSession } from "next-auth/react";

/**
 * Provides current user session information
 * @returns User ID from active session
 */
export const useUserSession = () => {
  const [userId, setUserId] = useState<string | undefined>();

  // Session fetching on component mount
  useEffect(() => {
    const fetchSession = async () => {
      const session = await getSession();
      setUserId(session?.user?.id);
    };
    fetchSession();
  }, []);

  return { userId };
};