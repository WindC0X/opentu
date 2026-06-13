import {
  CREATIVE_MANAGED_PROFILE_ID,
  isCreativeEmbeddedMode,
} from '../../services/creative-mode';
import {
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
  type ProviderProfile,
} from '../../utils/settings-manager';
import type { BenchmarkModality } from '../../services/model-benchmark-service';

type CapabilityKey =
  | 'supportsText'
  | 'supportsImage'
  | 'supportsVideo'
  | 'supportsAudio';

function getCapabilityKey(modality: BenchmarkModality): CapabilityKey {
  if (modality === 'text') return 'supportsText';
  if (modality === 'image') return 'supportsImage';
  if (modality === 'video') return 'supportsVideo';
  return 'supportsAudio';
}

export function getAvailableProfilesForModality(
  profiles: ProviderProfile[],
  modality: BenchmarkModality,
  creativeEmbedded = isCreativeEmbeddedMode()
): ProviderProfile[] {
  const capabilityKey = getCapabilityKey(modality);
  return profiles.filter(
    (profile) =>
      (!creativeEmbedded || profile.id === CREATIVE_MANAGED_PROFILE_ID) &&
      profile.enabled &&
      (profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID ||
        profile.capabilities[capabilityKey])
  );
}
