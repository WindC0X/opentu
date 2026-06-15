import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const mixedCaseStaticImageModel: ModelConfig = {
    id: 'Gpt-image-2',
    label: 'Gpt-image-2',
    shortCode: 'gpt2',
    type: 'image',
    vendor: 'GPT' as ModelVendor,
    sourceProfileId: 'new-api-creative',
    sourceProfileName: 'New API Creative',
    selectionKey: 'new-api-creative::Gpt-image-2',
  };

  const managedCatalog = {
    profileId: 'new-api-creative',
    discoveredAt: Date.now(),
    discoveredModels: [managedImageModel],
    selectedModelIds: [managedImageModel.id],
    sourceBaseUrl: '/creative/api/models',
    error: null,
  };
  const legacyCatalog = {
    profileId: 'legacy-default',
    discoveredAt: Date.now(),
    discoveredModels: [legacyImageModel],
    selectedModelIds: [legacyImageModel.id],
    sourceBaseUrl: 'https://api.tu-zi.com/v1',
    error: null,
  };

  return {
    managedImageModel,
    legacyImageModel,
    mixedCaseStaticImageModel,
    managedCatalog,
    legacyCatalog,
    catalogs: [legacyCatalog, managedCatalog],
    isCreativeEmbeddedMode: vi.fn(() => true),
    reloadFromStorage: vi.fn(),
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
    get: () => mocks.catalogs,
    update: vi.fn(async () => undefined),
    addListener: vi.fn(),
  },
  invocationPresetsSettings: {
    addListener: vi.fn(),
  },
  settingsManager: {
    addListener: vi.fn(),
    reloadFromStorage: mocks.reloadFromStorage,
  },
}));

describe('runtimeModelDiscovery in embedded Creative mode', () => {
  beforeEach(() => {
    mocks.catalogs = [mocks.legacyCatalog, mocks.managedCatalog];
    mocks.isCreativeEmbeddedMode.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('can reload the settings-manager instance owned by runtime discovery before refreshing catalogs', async () => {
    vi.resetModules();
    mocks.reloadFromStorage.mockClear();
    const { runtimeModelDiscovery } = await import('./runtime-model-discovery');

    runtimeModelDiscovery.refreshFromSettings({ reloadFromStorage: true });

    expect(mocks.reloadFromStorage).toHaveBeenCalledTimes(1);
    expect(runtimeModelDiscovery.getSelectableModels('image')).toEqual([
      expect.objectContaining({
        id: 'newapi-image-model',
        sourceProfileId: 'new-api-creative',
      }),
    ]);
  });

  it('keeps the executable managed model id when enriching a case-insensitive static model match', async () => {
    mocks.catalogs = [
      mocks.legacyCatalog,
      {
        ...mocks.managedCatalog,
        discoveredModels: [mocks.mixedCaseStaticImageModel],
        selectedModelIds: [mocks.mixedCaseStaticImageModel.id],
      },
    ];
    vi.resetModules();
    const { runtimeModelDiscovery } = await import('./runtime-model-discovery');

    const managedState = runtimeModelDiscovery.getState('new-api-creative');
    const selectableImages = runtimeModelDiscovery.getSelectableModels('image');

    expect(managedState.discoveredModels).toEqual([
      expect.objectContaining({
        id: 'Gpt-image-2',
        shortCode: 'gpt2',
        imageDefaults: expect.objectContaining({ aspectRatio: 'auto' }),
      }),
    ]);
    expect(managedState.selectedModelIds).toEqual(['Gpt-image-2']);
    expect(managedState.models.map((model) => model.id)).toEqual([
      'Gpt-image-2',
    ]);
    expect(selectableImages).toEqual([
      expect.objectContaining({
        id: 'Gpt-image-2',
        shortCode: 'gpt2',
        selectionKey: 'new-api-creative::Gpt-image-2',
      }),
    ]);
  });

  it('uses static presentation metadata when direct discovery adapts a case-insensitive static model id', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: [
              {
                id: 'Gpt-image-2',
                object: 'model',
                owned_by: 'openai',
                supported_endpoint_types: ['openai-image'],
              },
            ],
          }),
      }))
    );
    const { runtimeModelDiscovery } = await import('./runtime-model-discovery');

    const discovered = await runtimeModelDiscovery.discover(
      'new-api-creative',
      '/creative/relay/v1',
      'test-key'
    );

    expect(discovered).toEqual([
      expect.objectContaining({
        id: 'Gpt-image-2',
        label: 'gpt-image-2',
        shortCode: 'gpt2',
        imageDefaults: expect.objectContaining({ aspectRatio: 'auto' }),
      }),
    ]);
  });
});
