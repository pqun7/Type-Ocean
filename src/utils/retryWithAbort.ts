// utils/retryWithAbort.ts
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 8000,
    signal,
  } = options;

  let lastError: Error = new Error('All retry attempts failed');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check for abort signal before each attempt
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts || signal?.aborted) {
        break;
      }

      const exponentialDelay = Math.min(
        baseDelay * Math.pow(2, attempt - 1),
        maxDelay
      );
      const jitter = Math.random() * 0.1 * exponentialDelay;
      const delayMs: number = exponentialDelay + jitter;

      // Wait with abort signal support
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Request aborted'));
        });
      });
    }
  }

  throw lastError;
}