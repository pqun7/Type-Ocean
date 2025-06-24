import * as Sentry from "@sentry/nextjs";

type AuthFetchOptions = RequestInit & {
  timeout?: number;
  userId?: string;
  requestId?: string;
};

const DEFAULT_TIMEOUT = 8000;

class HttpError extends Error {
  public status: number;
  public data?: any;
  constructor(status: number, message: string, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = "HttpError";
  }
}

export async function authFetch<T = unknown>(
  url: string,
  options: AuthFetchOptions = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = new Headers(options.headers);
    
    // Security: Always validate user ID
    if (!options.userId) throw new Error("Missing user ID");
    // Fix: Use lowercase header name to match API expectation
    headers.set("x-user-id", options.userId);

    if (options.requestId) {
      headers.set("x-request-id", options.requestId);
    }

    // Server-side authentication
    if (typeof window === "undefined") {
      headers.set("Authorization", `Bearer ${process.env.API_INTERNAL_SECRET}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: "Unknown error occurred" };
      }
      
      // Provide more specific error messages based on status
      let errorMessage = errorData.error || "Request failed";
      if (response.status === 401) {
        errorMessage = "Authentication failed";
      } else if (response.status === 429) {
        errorMessage = "Too many requests. Please try again later";
      } else if (response.status >= 500) {
        errorMessage = "Server error. Please try again";
      }
      
      throw new HttpError(response.status, errorMessage, errorData);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error("Request timeout");
    }
    
    Sentry.captureException(error, {
      tags: { endpoint: url },
      user: { id: options.userId },
      extra: {
        timeout,
        url,
        method: options.method || 'GET'
      }
    });
    
    // Re-throw the original error instead of masking it
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}