import { describe, expect, it } from 'vitest';

import { runLiveProviderRevalidation } from './live-provider-revalidation';

describe('Q48 live provider revalidation', () => {
  it('is opt-in gated and verifies still-held late recovery when explicitly enabled', async () => {
    const result = await runLiveProviderRevalidation(process.env);

    if (result.kind === 'skipped') {
      console.info(result.message);
      expect(result.message).toContain('MENGTU_LIVE_PROVIDER_REVALIDATION=1');
      return;
    }

    console.info(JSON.stringify(result.summary));
    if (result.kind === 'not_recovered') {
      throw new Error(
        `Q48 live provider revalidation did not recover: status=${result.summary.recoveryStatus} reason=${result.summary.recoveryReason}`
      );
    }

    expect(result.summary).toMatchObject({
      assetCount: expect.any(Number),
      finalStatus: 'succeeded',
      generationRequestCount: 1,
      preRecoveryStatus: 'running',
      recoveryGenerationRequestCount: 0,
      recoveryStatus: 'recovered',
      usageId: expect.any(String),
    });
    expect(result.summary.assetCount).toBeGreaterThan(0);
    expect(result.summary.providerRequestId).toEqual(expect.any(String));
    expect(result.summary.quota.heldAmount).toBe(0);
  });
});
