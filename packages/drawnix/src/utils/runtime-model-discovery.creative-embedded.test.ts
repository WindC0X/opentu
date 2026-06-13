import { describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../constants/model-config';

const mocks = vi.hoisted(() => {
  const managedImageModel: ModelConfig = {
    id: 'newapi-image-model',
    label: 'New API Image Model',
    type: 'image',
    vendor: 'GPT' as ModelVendor,
    sourceProfileId: 'new-api-creative',
    sourceProfileName: 'New API Creative',
    selectionKey: 'new-api-creative::newapi-image-model',
  };
  const legacyImageModel: ModelConfig = {
    id: 'legacy-image-model',
    label: 'Legacy Image Model',
    type: 'image',
    vendor: 'GEMINI' as ModelVendor,
    sourceProfileId: 'legacy-default',
    sourceProfileName: 'default 分组',
    selectionKey: 'legacy-default::legacy-image-model',
  };

  return {
    managedImageModel,
    legacyImageModel,
    isCreativeEmbeddedMode: vi.fn(() => true),
  };
});

vi.mock('../services/creative-mode', () => ({
  CREATIVE_MANAGED_PROFILE_ID: 'new-api-creative',
  isCreativeEmbeddedMode: mocks.isCreativeEmbeddedMode,
}));

vi.mock('./settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  providerProfilesSettings: {
    get: () => [
      {
        id: 'legacy-default',
        name: 'default 分组',
        enabled: true,
      },
      {
        id: 'new-api-creative',
        name: 'New API Creative',
        enabled: true,
      },
    ],
    addListener: vi.fn(),
  },
  providerCatalogsSettings: {
    get: () => [
      {
        profileId: 'legacy-default',
        discoveredAt: Date.now(),
        discoveredModels: [mocks.legacyImageModel],
        selectedModelIds: [mocks.legacyImageModel.id],
        sourceBaseUrl: 'https://api.tu-zi.com/v1',
        error: null,
      },
      {
        profileId: 'new-api-creative',
        discoveredAt: Date.now(),
        discoveredModels: [mocks.managedImageModel],
        selectedModelIds: [mocks.managedImageModel.id],
        sourceBaseUrl: '/creative/api/models',
        error: null,
      },
    ],
    update: vi.fn(async () => undefined),
    addListener: vi.fn(),
  },
  invocationPresetsSettings: {
    addListener: vi.fn(),
  },
  settingsManager: {
    addListener: vi.fn(),
  },
}));

describe('runtimeModelDiscovery in embedded Creative mode', () => {
  it('uses the new-api managed catalog as the selectable model source and does not append OpenTU static defaults', async () => {
    vi.resetModules();
    const { runtimeModelDiscovery } = await import('./runtime-model-discovery');

    const imageModels = runtimeModelDiscovery.getSelectableModels('image');

    expect(imageModels.map((model) => model.selectionKey || model.id)).toEqual([
      'new-api-creative::newapi-image-model',
    ]);
    expect(imageModels.map((model) => model.id)).not.toContain(
      'legacy-image-model'
    );
    expect(imageModels.some((model) => !model.sourceProfileId)).toBe(false);
  });

  it('does not recreate OpenTU static defaults as pinned choices in embedded mode', async () => {
    vi.resetModules();
    const { runtimeModelDiscovery } = await import('./runtime-model-discovery');

    expect(
      runtimeModelDiscovery.getPinnedSelectableModel('image', 'gpt-image-2')
    ).toBeNull();
    expect(
      runtimeModelDiscovery.getPinnedSelectableModel('image', 'legacy-image-model', {
        profileId: 'legacy-default',
        modelId: 'legacy-image-model',
      })
    ).toBeNull();
    expect(
      runtimeModelDiscovery.getPinnedSelectableModel(
        'image',
        mocks.managedImageModel.id,
        {
          profileId: 'new-api-creative',
          modelId: mocks.managedImageModel.id,
        }
      )?.selectionKey
    ).toBe('new-api-creative::newapi-image-model');
  });

  it('preserves the managed catalog when settings persistence checks ordinary base URL signatures', async () => {
    vi.resetModules();
    const { runtimeModelDiscovery } = await import('./runtime-model-discovery');

    runtimeModelDiscovery.invalidateIfConfigChanged(
      'new-api-creative',
      '/creative/relay/v1',
      ''
    );

    expect(runtimeModelDiscovery.getSelectableModels('image')).toEqual([
      expect.objectContaining({
        id: 'newapi-image-model',
        sourceProfileId: 'new-api-creative',
      }),
    ]);
  });
});
