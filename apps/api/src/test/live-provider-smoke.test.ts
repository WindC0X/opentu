import { describe, expect, it } from 'vitest';

import {
  assertNoSecretLeak,
  liveSecretValues,
  runLiveProviderSmoke,
} from './live-provider-smoke';

describe('S12 live provider smoke guard', () => {
  it('skips without opt-in before reading or using provider credentials', async () => {
    const result = await runLiveProviderSmoke({
      GRSAI_API_KEY: 'fake-secret-that-must-not-be-used',
    });

    expect(result).toEqual({
      kind: 'skipped',
      message:
        'S12 live provider smoke skipped: set MENGTU_LIVE_PROVIDER_SMOKE=1 to opt in.',
    });
  });

  it('collects supported server-side GrsAI credential env values only after opt-in', () => {
    expect(
      liveSecretValues({
        GRSAI_API_KEY: 'legacy-secret',
        PROVIDER_SECRET_GRSAI: 'provider-secret',
        PROVIDER_SECRET_GRSAI_API_KEY: 'provider-kind-secret',
      })
    ).toEqual([
      'provider-kind-secret',
      'provider-secret',
      'legacy-secret',
    ]);
  });

  it('fails redaction assertions without exposing the secret in the error', () => {
    expect(() =>
      assertNoSecretLeak({ nested: 'Bearer fake-secret' }, ['fake-secret'])
    ).toThrow('S12 live provider smoke detected a secret leak.');
  });
});
