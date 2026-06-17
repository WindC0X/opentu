import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearInternalFetchLogs,
  debugFetch,
  getInternalFetchLogs,
  setDebugFetchBroadcast,
  setDebugFetchEnabled,
} from './debug-fetch';

describe('debugFetch Creative privacy', () => {
  afterEach(() => {
    setDebugFetchEnabled(false);
    setDebugFetchBroadcast(() => undefined);
    clearInternalFetchLogs();
    vi.restoreAllMocks();
  });

  it.each([
    '/creative/api/bootstrap',
    'https://app.example/creative/api/bootstrap',
    'https://app.example/creative/api/documents/doc-1',
    'https://app.example/creative/relay/v1/images/tasks',
  ])('skips debug logging for private Creative request %s', async (url) => {
    setDebugFetchEnabled(true);
    const broadcasts: unknown[] = [];
    setDebugFetchBroadcast((log) => broadcasts.push(log));
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            bootstrap: 'response-secret',
            nonce: 'nonce-secret',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

    await debugFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer provider-secret',
          Cookie: 'session=secret',
          'X-Creative-CSRF': 'csrf-secret',
          'X-Creative-Nonce': 'nonce-secret',
          'Idempotency-Key': 'idem-secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: 'private prompt',
          apiKey: 'body-secret',
        }),
      },
      { logRequestBody: true, logResponseBody: true }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getInternalFetchLogs()).toEqual([]);
    expect(broadcasts).toEqual([]);
  });
});
