import { describe, expect, it } from 'vitest';

import { runLiveProviderRevalidation } from './live-provider-revalidation';

describe('Q48 live provider revalidation guard', () => {
  it('skips without opt-in before reading or using provider credentials', async () => {
    const result = await runLiveProviderRevalidation(
      {
        GRSAI_API_KEY: 'fake-secret-that-must-not-be-used',
      },
      {
        fetchImpl: async () => {
          throw new Error('provider fetch must not run without opt-in');
        },
      }
    );

    expect(result).toEqual({
      kind: 'skipped',
      message:
        'Q48 live provider revalidation skipped: set MENGTU_LIVE_PROVIDER_REVALIDATION=1 to opt in.',
    });
  });

  it('recovers a still-held task by reusing the existing request id', async () => {
    const calls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/v1/api/generate')) {
        return jsonResponse({ id: 'q48-existing-request', status: 'running' });
      }
      if (url.includes('/v1/api/result')) {
        return jsonResponse({
          results: [{ url: 'https://cdn.example.test/q48.png' }],
          status: 'succeeded',
        });
      }
      if (url === 'https://cdn.example.test/q48.png') {
        return new Response(tinyPng(), {
          headers: { 'content-type': 'image/png' },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const result = await runLiveProviderRevalidation(
      {
        GRSAI_API_KEY: 'fake-secret-token',
        MENGTU_LIVE_PROVIDER_REVALIDATION: '1',
        MENGTU_LIVE_PROVIDER_REVALIDATION_MODE: 'still-held-late-recovery',
        MENGTU_LIVE_PROVIDER_REVALIDATION_POLL_INTERVAL_MS: '1',
        MENGTU_LIVE_PROVIDER_REVALIDATION_SEED_TIMEOUT_MS: '1000',
        MENGTU_LIVE_PROVIDER_REVALIDATION_TIMEOUT_MS: '1000',
      },
      { fetchImpl: fakeFetch }
    );

    expect(result.kind).toBe('recovered');
    if (result.kind !== 'recovered') {
      throw new Error('expected recovered result');
    }
    expect(result.summary).toMatchObject({
      assetCount: 1,
      finalStatus: 'succeeded',
      generationRequestCount: 1,
      preRecoveryHeldAmount: 10,
      preRecoveryStatus: 'running',
      providerRequestId: 'q48-existing-request',
      quota: {
        heldAmount: 0,
        ledger: expect.arrayContaining([
          expect.objectContaining({ amount: 10, entryType: 'hold' }),
          expect.objectContaining({ amount: 10, entryType: 'consume' }),
        ]),
      },
      recoveryGenerationRequestCount: 0,
      recoveryStatus: 'recovered',
    });
    expect(calls.filter((url) => url.endsWith('/v1/api/generate'))).toHaveLength(1);
    expect(JSON.stringify(result.summary)).not.toContain('fake-secret-token');
    expect(JSON.stringify(result.summary)).not.toContain('https://cdn.example.test');
  });

  it('requires the still-held revalidation mode after opt-in', async () => {
    await expect(
      runLiveProviderRevalidation({
        GRSAI_API_KEY: 'fake-secret-token',
        MENGTU_LIVE_PROVIDER_REVALIDATION: '1',
      })
    ).rejects.toThrow(
      'Q48 live provider revalidation requires MENGTU_LIVE_PROVIDER_REVALIDATION_MODE=still-held-late-recovery.'
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
}
