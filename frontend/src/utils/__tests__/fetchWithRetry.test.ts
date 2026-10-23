import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithRetry } from '../fetchWithRetry';

describe('Fetch With Retry (fetchWithRetry.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return successful response on first attempt without retries', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

    const res = await fetchWithRetry('https://example.com/api', { maxRetries: 3 });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should not retry on client 4xx errors (fail fast)', async () => {
    const notFoundResponse = new Response('not found', { status: 404 });
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(notFoundResponse);

    const res = await fetchWithRetry('https://example.com/api/missing', { maxRetries: 3, baseDelayMs: 10 });
    expect(res.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should retry on 500 status and succeed if subsequent attempt passes', async () => {
    const error500 = new Response('server error', { status: 500 });
    const ok200 = new Response('recovered', { status: 200 });

    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(error500)
      .mockResolvedValueOnce(ok200);

    const res = await fetchWithRetry('https://example.com/api/flaky', { 
      maxRetries: 2, 
      baseDelayMs: 10,
      maxDelayMs: 20 
    });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('should abort retry sleep when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    const error503 = new Response('busy', { status: 503 });

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      controller.abort();
      return error503;
    });

    const res = await fetchWithRetry('https://example.com/api/aborted', {
      maxRetries: 3,
      baseDelayMs: 500,
      signal: controller.signal
    });

    expect(res.status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(4);
  });
});
