"use client";

import useSWR from "swr";
import { useEffect, useMemo, useState } from "react";

type UserAvatarResponse = {
  user?: {
    username?: unknown;
    image?: unknown;
    profile?: {
      avatar?: unknown;
    };
  };
};

const fetcher = async (url: string): Promise<UserAvatarResponse | null> => {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    // Treat auth failures as empty state (no avatar) to avoid noisy retries.
    if (res.status === 401 || res.status === 403) return null;
    throw new Error(`HTTP ${res.status}`);
  }

  return (await res.json().catch(() => null)) as UserAvatarResponse | null;
};

export function useUserAvatar(enabled: boolean) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const swrKey = mounted && enabled ? "/api/user" : null;

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR(swrKey, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    // Avoid repeated calls during navigation/mounts.
    dedupingInterval: 60000,
    errorRetryCount: 1,
    shouldRetryOnError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) return false;
      return true;
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onAuthChanged = () => {
      void mutate();
    };

    window.addEventListener("auth:changed", onAuthChanged);
    return () => window.removeEventListener("auth:changed", onAuthChanged);
  }, [mutate]);

  const parsed = useMemo(() => {
    const usernameRaw = data?.user?.username;
    const imageRaw = data?.user?.image;
    const avatarRaw = data?.user?.profile?.avatar;

    const username = typeof usernameRaw === "string" ? usernameRaw : null;
    const avatarUrl =
      typeof avatarRaw === "string" && avatarRaw.length > 0
        ? avatarRaw
        : typeof imageRaw === "string" && imageRaw.length > 0
          ? imageRaw
          : null;

    return { username, avatarUrl };
  }, [data]);

  return {
    username: parsed.username,
    avatarUrl: parsed.avatarUrl,
    isLoading: mounted ? isLoading : true,
    error,
    refresh: mutate,
  };
}
