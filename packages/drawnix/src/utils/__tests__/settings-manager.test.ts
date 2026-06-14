import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAWNIX_SETTINGS_KEY } from '../../constants/storage';

function createStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

function mockSettingsManagerDeps() {
  vi.doMock('../crypto-utils', () => ({
    CryptoUtils: {
      testCrypto: async () => false,
      isEncrypted: () => false,
      decrypt: async (value: string) => value,
      encrypt: async (value: string) => value,
    },
  }));

  vi.doMock('../config-indexeddb-writer', () => ({
    configIndexedDBWriter: {
      saveConfig: async () => {},
    },
  }));
}

describe('settings-manager', () => {
  beforeEach(() => {
    vi.resetModules();

    if (typeof globalThis.localStorage?.clear !== 'function') {
      Object.defineProperty(globalThis, 'localStorage', {
        value: createStorageMock(),
        configurable: true,
      });
    }

    if (typeof window === 'undefined') {
      vi.stubGlobal('window', {
        location: {
          search: '',
          href: 'https://example.com/app',
        },
        history: {
          replaceState: () => {},
        },
        dispatchEvent: () => true,
      });
    } else {
      Object.assign(window, {
        location: {
          search: '',
          href: 'https://example.com/app',
        },
        history: {
          replaceState: () => {},
        },
        dispatchEvent: () => true,
      });
    }

    localStorage.clear();
  });

  it('defaults missing compatibility while preserving managed profile details and explicit values', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
        },
        providerProfiles: [
          {
            id: 'legacy-default',
            name: '兔子 AI',
            providerType: 'custom',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'query',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'tuzi-origin',
            name: '兔子 原价',
            providerType: 'gemini-compatible',
            baseUrl: 'https://example.com/custom-endpoint',
            apiKey: 'origin-key',
            authType: 'header',
            imageApiCompatibility: 'tuzi-gpt-image',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'custom-auto',
            name: '自定义自动',
            providerType: 'openai-compatible',
            baseUrl: 'https://gateway-auto.example.com/v1',
            apiKey: 'auto-key',
            authType: 'bearer',
            imageApiCompatibility: 'auto',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'custom-missing',
            name: '自定义缺省',
            providerType: 'openai-compatible',
            baseUrl: 'https://gateway-missing.example.com/v1',
            apiKey: 'missing-key',
            authType: 'bearer',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'custom-provider',
            name: '自定义供应商',
            providerType: 'openai-compatible',
            baseUrl: 'https://gateway.example.com/v1',
            apiKey: 'custom-key',
            authType: 'bearer',
            imageApiCompatibility: 'tuzi-compatible',
            enabled: true,
            capabilities: {},
          },
          {
            id: 'invalid-provider',
            name: '错误配置供应商',
            providerType: 'openai-compatible',
            baseUrl: 'https://invalid.example.com/v1',
            apiKey: 'invalid-key',
            authType: 'bearer',
            imageApiCompatibility: 'unknown-mode',
            enabled: true,
            capabilities: {},
          },
        ],
      })
    );

    const {
      providerProfilesSettings,
      DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
      LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      TUZI_CODEX_PROVIDER_PROFILE_ID,
      TUZI_BUSINESS_PROVIDER_PROFILE_ID,
      TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const profiles = providerProfilesSettings.get();
    const legacyProfile = profiles.find(
      (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
    );
    const tuziOriginProfile = profiles.find(
      (profile) => profile.id === TUZI_ORIGINAL_PROVIDER_PROFILE_ID
    );
    const tuziCodexProfile = profiles.find(
      (profile) => profile.id === TUZI_CODEX_PROVIDER_PROFILE_ID
    );
    const tuziBusinessProfile = profiles.find(
      (profile) => profile.id === TUZI_BUSINESS_PROVIDER_PROFILE_ID
    );

    expect(legacyProfile).toMatchObject({
      providerType: 'custom',
      authType: 'query',
      imageApiCompatibility: LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
    });
    expect(tuziOriginProfile).toMatchObject({
      providerType: 'gemini-compatible',
      authType: 'header',
      pricingGroup: 'default',
      imageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(tuziCodexProfile).toMatchObject({
      pricingGroup: 'codex',
      imageApiCompatibility: DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
    });
    expect(tuziBusinessProfile).toMatchObject({
      name: 'Business',
      baseUrl: 'https://business.tu-zi.com/v1',
      homepageUrl: 'https://business.tu-zi.com/',
      pricingUrl: 'https://business.tu-zi.com/api/pricing',
      imageApiCompatibility: LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
    });
    expect(
      profiles.find((profile) => profile.id === 'custom-auto')
    ).toMatchObject({
      imageApiCompatibility: 'auto',
    });
    expect(
      profiles.find((profile) => profile.id === 'custom-missing')
    ).toMatchObject({
      imageApiCompatibility: DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY,
    });
    expect(
      profiles.find((profile) => profile.id === 'custom-provider')
    ).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(
      profiles.find((profile) => profile.id === 'invalid-provider')
    ).toMatchObject({
      imageApiCompatibility: 'auto',
    });

    await providerProfilesSettings.update([
      ...profiles.filter((profile) => profile.id !== 'custom-provider'),
      {
        id: 'custom-provider',
        name: '自定义供应商',
        providerType: 'openai-compatible',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'custom-key',
        authType: 'bearer',
        imageApiCompatibility: 'tuzi-compatible' as any,
        enabled: true,
        capabilities: {
          supportsModelsEndpoint: true,
          supportsText: true,
          supportsImage: true,
          supportsVideo: true,
          supportsAudio: true,
          supportsTools: true,
        },
      },
    ]);

    const updatedCustomProfile = providerProfilesSettings
      .get()
      .find((profile) => profile.id === 'custom-provider');

    expect(updatedCustomProfile).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
  });

  it('migrates legacy default Tuzi GPT Image compatibility only once', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
        },
        providerProfiles: [
          {
            id: 'legacy-default',
            name: 'default 分组',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.tu-zi.com/v1',
            apiKey: 'legacy-key',
            authType: 'bearer',
            imageApiCompatibility: 'openai-gpt-image',
            enabled: true,
            capabilities: {},
          },
        ],
      })
    );

    const {
      providerProfilesSettings,
      settingsManager,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const migratedProfile = providerProfilesSettings
      .get()
      .find((profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID);

    expect(migratedProfile).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(settingsManager.getSettings().migrations).toMatchObject({
      legacyDefaultImageApiCompatibilityV1: true,
    });

    await providerProfilesSettings.update(
      providerProfilesSettings.get().map((profile) =>
        profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
          ? {
              ...profile,
              imageApiCompatibility: 'openai-gpt-image' as const,
            }
          : profile
      )
    );

    vi.resetModules();
    mockSettingsManagerDeps();

    const reloaded = await import('../settings-manager');
    const reloadedLegacyProfile = reloaded.providerProfilesSettings
      .get()
      .find(
        (profile) => profile.id === reloaded.LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      );

    expect(reloadedLegacyProfile).toMatchObject({
      imageApiCompatibility: 'openai-gpt-image',
    });
    expect(reloaded.settingsManager.getSettings().migrations).toMatchObject({
      legacyDefaultImageApiCompatibilityV1: true,
    });
  });

  it('does not migrate legacy default compatibility when the default baseUrl is not Tuzi', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com/v1',
        },
        providerProfiles: [
          {
            id: 'legacy-default',
            name: 'default 分组',
            providerType: 'openai-compatible',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'openai-key',
            authType: 'bearer',
            imageApiCompatibility: 'openai-gpt-image',
            enabled: true,
            capabilities: {},
          },
        ],
      })
    );

    const {
      providerProfilesSettings,
      settingsManager,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const legacyProfile = providerProfilesSettings
      .get()
      .find((profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID);

    expect(legacyProfile).toMatchObject({
      imageApiCompatibility: 'openai-gpt-image',
    });
    expect(settingsManager.getSettings().migrations).toMatchObject({
      legacyDefaultImageApiCompatibilityV1: true,
    });
  });

  it('preserves managed profile compatibility overrides after reload', async () => {
    mockSettingsManagerDeps();

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
        },
      })
    );

    const {
      providerProfilesSettings,
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID,
      TUZI_CODEX_PROVIDER_PROFILE_ID,
      TUZI_MIX_PROVIDER_PROFILE_ID,
      TUZI_ORIGINAL_PROVIDER_PROFILE_ID,
      TUZI_BUSINESS_PROVIDER_PROFILE_ID,
    } = await import('../settings-manager');

    const profiles = providerProfilesSettings.get();

    await providerProfilesSettings.update(
      profiles.map((profile) => {
        if (profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID) {
          return {
            ...profile,
            imageApiCompatibility: 'tuzi-gpt-image' as const,
          };
        }

        if (profile.id === TUZI_ORIGINAL_PROVIDER_PROFILE_ID) {
          return {
            ...profile,
            imageApiCompatibility: 'auto' as const,
          };
        }

        if (profile.id === TUZI_MIX_PROVIDER_PROFILE_ID) {
          return {
            ...profile,
            imageApiCompatibility: 'openai-compatible-basic' as const,
          };
        }

        if (profile.id === TUZI_CODEX_PROVIDER_PROFILE_ID) {
          return {
            ...profile,
            imageApiCompatibility: 'tuzi-gpt-image' as const,
          };
        }

        if (profile.id === TUZI_BUSINESS_PROVIDER_PROFILE_ID) {
          return {
            ...profile,
            homepageUrl: 'business.tu-zi.com/dashboard',
            pricingUrl: 'https://business.tu-zi.com/api/pricing?group=vip',
            imageApiCompatibility: 'auto' as const,
          };
        }

        return profile;
      })
    );

    vi.resetModules();
    mockSettingsManagerDeps();

    const reloaded = await import('../settings-manager');
    const reloadedProfiles = reloaded.providerProfilesSettings.get();

    expect(
      reloadedProfiles.find(
        (profile) => profile.id === LEGACY_DEFAULT_PROVIDER_PROFILE_ID
      )
    ).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(
      reloadedProfiles.find(
        (profile) => profile.id === TUZI_ORIGINAL_PROVIDER_PROFILE_ID
      )
    ).toMatchObject({
      imageApiCompatibility: 'auto',
    });
    expect(
      reloadedProfiles.find(
        (profile) => profile.id === TUZI_MIX_PROVIDER_PROFILE_ID
      )
    ).toMatchObject({
      imageApiCompatibility: 'openai-compatible-basic',
    });
    expect(
      reloadedProfiles.find(
        (profile) => profile.id === TUZI_CODEX_PROVIDER_PROFILE_ID
      )
    ).toMatchObject({
      imageApiCompatibility: 'tuzi-gpt-image',
    });
    expect(
      reloadedProfiles.find(
        (profile) => profile.id === TUZI_BUSINESS_PROVIDER_PROFILE_ID
      )
    ).toMatchObject({
      homepageUrl: 'https://business.tu-zi.com/dashboard',
      pricingUrl: 'https://business.tu-zi.com/api/pricing?group=vip',
      imageApiCompatibility: 'auto',
    });
  });

  it('keeps embedded Creative on a managed unavailable route before bootstrap instead of falling back to legacy credentials', async () => {
    mockSettingsManagerDeps();
    Object.assign(window, {
      location: {
        search: '',
        href: 'https://example.com/creative/',
        pathname: '/creative/',
      },
    });

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
          imageModelName: 'gpt-image-2-vip',
        },
      })
    );

    const { resolveInvocationRoute, hasInvocationRouteCredentials } =
      await import('../settings-manager');
    const { CREATIVE_MANAGED_PROFILE_ID } = await import(
      '../../services/creative-mode'
    );

    const route = resolveInvocationRoute('image', 'gpt-image-2-vip');

    expect(route).toMatchObject({
      routeType: 'image',
      modelId: '',
      profileId: CREATIVE_MANAGED_PROFILE_ID,
      profileName: 'New API Creative',
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
      source: 'preset',
    });
    expect(hasInvocationRouteCredentials('image', 'gpt-image-2-vip')).toBe(
      false
    );
  });

  it('does not use stale requested, preset, or legacy model ids when the embedded managed catalog is empty', async () => {
    mockSettingsManagerDeps();
    Object.assign(window, {
      location: {
        search: '',
        href: 'https://example.com/creative/',
        pathname: '/creative/',
      },
    });

    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'legacy-key',
          baseUrl: 'https://api.tu-zi.com/v1',
          imageModelName: 'legacy-image-model',
        },
        providerProfiles: [
          {
            id: 'new-api-creative',
            name: 'New API Creative',
            providerType: 'openai-compatible',
            baseUrl: '/creative/relay/v1',
            apiKey: '',
            authType: 'session-broker',
            enabled: true,
            capabilities: {
              supportsModelsEndpoint: true,
              supportsText: true,
              supportsImage: true,
              supportsVideo: true,
              supportsAudio: true,
              supportsTools: true,
            },
          },
        ],
        providerCatalogs: [
          {
            profileId: 'new-api-creative',
            discoveredAt: Date.now(),
            discoveredModels: [],
            selectedModelIds: [],
            sourceBaseUrl: '/creative/api/models',
            error: 'creative_session_unavailable',
          },
        ],
        invocationPresets: [
          {
            id: 'default',
            name: 'Default',
            isDefault: true,
            text: { defaultModelRef: null },
            image: {
              defaultModelRef: {
                profileId: 'new-api-creative',
                modelId: 'stale-preset-image',
              },
            },
            video: { defaultModelRef: null },
            audio: { defaultModelRef: null },
          },
        ],
      })
    );

    const { resolveInvocationRoute, hasInvocationRouteCredentials } =
      await import('../settings-manager');

    const route = resolveInvocationRoute('image', {
      profileId: 'new-api-creative',
      modelId: 'stale-requested-image',
    });

    expect(route).toMatchObject({
      profileId: 'new-api-creative',
      modelId: '',
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
    });
    expect(JSON.stringify(route)).not.toMatch(
      /stale-requested-image|stale-preset-image|legacy-image-model|legacy-key|api\.tu-zi\.com/i
    );
    expect(
      hasInvocationRouteCredentials('image', {
        profileId: 'new-api-creative',
        modelId: 'stale-requested-image',
      })
    ).toBe(false);
  });
});
