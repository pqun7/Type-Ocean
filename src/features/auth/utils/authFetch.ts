
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
  const timeout = typeof options.timeout === "number" ? options.timeout : DEFAULT_TIMEOUT;
  const timeoutId = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : null;

  // Respect an external signal (e.g. page-level AbortController)
  // while still enforcing our own timeout.
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  try {
    const headers = new Headers(options.headers);
    
    const isServer = typeof window === "undefined";
    const internalSecret = process.env.API_INTERNAL_SECRET;

    // Server-to-server: require userId + secret
    if (isServer) {
      if (!options.userId) {
        throw new Error("Missing user ID");
      }
      if (!internalSecret) {
        throw new Error("Missing internal secret");
      }
      headers.set("x-user-id", options.userId);
      headers.set("Authorization", `Bearer ${internalSecret}`);
    }
    // Client: rely on cookies; do NOT attach spoofable user id header

    if (options.requestId) {
      headers.set("x-request-id", options.requestId);
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
    
    // Re-throw the original error instead of masking it
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}