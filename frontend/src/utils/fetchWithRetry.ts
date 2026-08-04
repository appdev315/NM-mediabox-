/**
 * Network Fetching Utility with Exponential Backoff, Jitter, and Retry logic.
 * Retries strictly on transient network failures (TypeError) and HTTP 5xx, 429, 408 status codes.
 */

export interface FetchWithRetryOptions extends RequestInit {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOnStatus?: number[];
  signal?: AbortSignal;
}

const DEFAULT_RETRY_STATUSES = [408, 429, 500, 502, 503, 504];

function isRetryableError(error: unknown, status?: number, retryOnStatus = DEFAULT_RETRY_STATUSES): boolean {
  if (status !== undefined) {
    return retryOnStatus.includes(status);
  }
  // TypeError is thrown by fetch API on network disconnects / DNS failures
  if (error instanceof TypeError) {
    return true;
  }
  return false;
}

function calculateJitteredBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 300;
  return Math.min(maxDelayMs, exponentialDelay + jitter);
}

export async function fetchWithRetry(
  url: string | URL,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    retryOnStatus = DEFAULT_RETRY_STATUSES,
    signal,
    ...fetchOptions
  } = options;

  let attempt = 0;

  while (true) {
    try {
      const response = await fetch(url, { ...fetchOptions, signal });

      if (response.ok || attempt >= maxRetries || !isRetryableError(null, response.status, retryOnStatus)) {
        return response;
      }

      attempt++;
      const delay = calculateJitteredBackoff(attempt, baseDelayMs, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error: unknown) {
      if (attempt >= maxRetries || !isRetryableError(error, undefined, retryOnStatus)) {
        throw error;
      }

      attempt++;
      const delay = calculateJitteredBackoff(attempt, baseDelayMs, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
