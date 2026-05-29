import { describe, expect, it } from 'vitest';

import { runLiveProviderSmoke } from './live-provider-smoke';

describe('S12 live provider smoke', () => {
  it('is opt-in gated and verifies the real provider path when explicitly enabled', async () => {
    const result = await runLiveProviderSmoke(process.env);

    if (result.kind === 'skipped') {
      console.info(result.message);
      expect(result.message).toContain('MENGTU_LIVE_PROVIDER_SMOKE=1');
      return;
    }

    console.info(JSON.stringify(result.summary));
    if (result.kind === 'provider_failed') {
      throw new Error(
        `S12 live provider smoke reached provider but did not succeed: status=${result.summary.status}`
      );
    }

    expect(result.summary).toMatchObject({
      assetCount: expect.any(Number),
      status: 'succeeded',
      usageId: expect.any(String),
    });
    expect(result.summary.assetCount).toBeGreaterThan(0);
    expect(result.summary.providerRequestId).toEqual(expect.any(String));
    expect(result.summary.quota.heldAmount).toBe(0);
  });
});
