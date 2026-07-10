/**
 * Fetches a URL with automatic retries on failure.
 * This helps mask network instability and timeout errors.
 */
export async function fetchWithRetry(url: string | RequestInfo | URL, options: RequestInit = {}, retries: number = 3, backoff: number = 1000): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      // We also retry if the response is a 5xx error (server error/timeout)
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }
      if (i === retries - 1) return response;
      throw new Error(`HTTP Error ${response.status}`);
    } catch (err: any) {
      lastError = err;
      if (i < retries - 1) {
        // Wait before retrying (exponential backoff: 1s, 2s, 4s...)
        await new Promise(resolve => setTimeout(resolve, backoff * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}
