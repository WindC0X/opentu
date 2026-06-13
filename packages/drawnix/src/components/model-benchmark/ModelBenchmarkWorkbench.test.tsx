// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CREATIVE_MANAGED_PROFILE_ID } from '../../services/creative-mode';
import type { ProviderProfile } from '../../utils/settings-manager';
import { getAvailableProfilesForModality } from './model-benchmark-profile-filter';

function profile(
  id: string,
  capabilities: Partial<ProviderProfile['capabilities']> = {}
): ProviderProfile {
  return {
    id,
    name: id,
    providerType: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    authType: id === CREATIVE_MANAGED_PROFILE_ID ? 'session-broker' : 'bearer',
    enabled: true,
    capabilities: {
      supportsModelsEndpoint: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: true,
      supportsAudio: true,
      ...capabilities,
    },
  } as ProviderProfile;
}

describe('ModelBenchmarkWorkbench profile filtering', () => {
  it('uses only the new-api managed provider in embedded Creative mode', () => {
    const profiles = [
      profile('legacy-default'),
      profile('tuzi-origin'),
      profile(CREATIVE_MANAGED_PROFILE_ID),
    ];

    expect(
      getAvailableProfilesForModality(profiles, 'image', true).map(
        (item) => item.id
      )
    ).toEqual([CREATIVE_MANAGED_PROFILE_ID]);
  });

  it('keeps standalone provider choices outside embedded Creative mode', () => {
    const profiles = [
      profile('legacy-default'),
      profile('disabled-provider'),
      profile('image-provider'),
      profile('text-only-provider', { supportsImage: false }),
    ];
    profiles[1].enabled = false;

    expect(
      getAvailableProfilesForModality(profiles, 'image', false).map(
        (item) => item.id
      )
    ).toEqual(['legacy-default', 'image-provider']);
  });
});
