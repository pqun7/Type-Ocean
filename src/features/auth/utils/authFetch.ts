import * as Sentry from "@sentry/nextjs";

type AuthFetchOptions = RequestInit & {
  timeout?: number;
};

const DEFAULT_TIMEOUT = 8000;

export async function authFetch<T = unknown>(
  url: string,
  options: AuthFetchOptions = {},
  userId?: string
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout || DEFAULT_TIMEOUT
  );

  try {
    const headers = new Headers(options.headers);
    
    if (userId) {
      headers.set("X-User-ID", userId);
    }

    if (typeof window === "undefined") {
      headers.set("Authorization", `Bearer ${process.env.API_INTERNAL_SECRET}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Request failed");
    }

    return await response.json();
  } catch (error) {
    Sentry.captureException(error, {
      tags: { endpoint: url },
      user: userId ? { id: userId } : undefined,
    });

    throw error instanceof Error 
      ? error 
      : new Error("Unknown fetch error");
  } finally {
    clearTimeout(timeoutId);
  }
}