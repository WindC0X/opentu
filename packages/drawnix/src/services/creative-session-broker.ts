import {
  ModelVendor,
  type ModelConfig,
  type ModelType,
  getStaticModelConfig,
} from '../constants/model-config';
import {
  createModelRef,
  providerCatalogsSettings,
  providerProfilesSettings,
  settingsManager,
  updateActiveInvocationRouteModel,
  type ProviderCatalog,
  type ProviderProfile,
} from '../utils/settings-manager';
import { sortModelsByDisplayPriority } from '../utils/model-sort';
import { reconcilePersistedModelSelectionsWithAvailableModels } from '../utils/ai-model-selection-storage';
import {
  getCreativeDefaultModel,
  stripCreativeServerUiPolicy,
} from './creative-display-policy';
import {
  CREATIVE_BOOTSTRAP_ENDPOINT,
  CREATIVE_MANAGED_PROFILE_ID,
  CREATIVE_MANAGED_PROFILE_NAME,
  CREATIVE_MODELS_ENDPOINT,
  CREATIVE_RELAY_BASE_URL,
  clearCreativeSessionAuthMaterial,
  isCreativeEmbeddedMode,
  setCreativeAssetSyncConfig,
  setCreativeSessionAuthMaterial,
} from './creative-mode';
import { initializeCreativeModelPreferenceSync } from './creative-model-preference-sync';

type CreativeModelEndpointItem = {
  id?: unknown;
  object?: unknown;
  owned_by?: unknown;
  type?: unknown;
  modality?: unknown;
  modalities?: unknown;
  supported_endpoint_types?: unknown;
  label?: unknown;
  name?: unknown;
  description?: unknown;
};

export interface CreativeBootstrapResult {
  status: 'skipped' | 'ready' | 'error';
  profileId?: string;
  models?: ModelConfig[];
  error?: string;
}

let initializationPromise: Promise<CreativeBootstrapResult> | null = null;

function cloneStaticModel(model: ModelConfig): ModelConfig {
  return JSON.parse(JSON.stringify(model)) as ModelConfig;
}

function inferVendor(modelId: string, owner?: string | null): ModelVendor {
  const lower = `${modelId} ${owner || ''}`.toLowerCase();
  if (lower.includes('gpt') || lower.includes('openai')) return ModelVendor.GPT;
  if (lower.includes('gemini') || lower.includes('google')) return ModelVendor.GEMINI;
  if (lower.includes('claude') || lower.includes('anthropic')) return ModelVendor.ANTHROPIC;
  if (lower.includes('deepseek')) return ModelVendor.DEEPSEEK;
  if (lower.includes('grok') || lower.includes('xai')) return ModelVendor.GROK;
  if (lower.includes('qwen')) return ModelVendor.QWEN;
  if (lower.includes('suno') || lower.includes('chirp')) return ModelVendor.SUNO;
  if (lower.includes('seedance') || lower.includes('seedream') || lower.includes('doubao')) {
    return ModelVendor.DOUBAO;
  }
  if (lower.includes('kling')) return ModelVendor.KLING;
  if (lower.includes('veo')) return ModelVendor.VEO;
  if (lower.includes('sora')) return ModelVendor.SORA;
  return ModelVendor.OTHER;
}

function inferModelType(item: CreativeModelEndpointItem, modelId: string): ModelType {
  const hints = [
    item.type,
    item.modality,
    ...(Array.isArray(item.modalities) ? item.modalities : []),
    ...(Array.isArray(item.supported_endpoint_types)
      ? item.supported_endpoint_types
      : []),
    modelId,
  ]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ');

  if (hints.includes('image') || hints.includes('/images/')) return 'image';
  if (hints.includes('video') || hints.includes('/videos/')) return 'video';
  if (hints.includes('audio') || hints.includes('speech') || hints.includes('music')) {
    return 'audio';
  }
  return 'text';
}

function normalizeCreativeModel(
  item: CreativeModelEndpointItem
): ModelConfig | null {
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;
  if (!id) {
    return null;
  }

  const staticModel = getStaticModelConfig(id);
  const base = staticModel
    ? cloneStaticModel(staticModel)
    : {
        id,
        label:
          (typeof item.label === 'string' && item.label.trim()) ||
          (typeof item.name === 'string' && item.name.trim()) ||
          id,
        shortLabel:
          (typeof item.name === 'string' && item.name.trim()) ||
          (typeof item.label === 'string' && item.label.trim()) ||
          id,
        description:
          typeof item.description === 'string' && item.description.trim()
            ? item.description.trim()
            : undefined,
        type: inferModelType(item, id),
        vendor: inferVendor(
          id,
          typeof item.owned_by === 'string' ? item.owned_by : null
        ),
      };

  return {
    ...base,
    sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
    sourceProfileName: CREATIVE_MANAGED_PROFILE_NAME,
    selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::${id}`,
    tags: Array.from(new Set([...(base.tags || []), 'runtime', 'creative'])),
  };
}

function extractModelItems(payload: unknown): CreativeModelEndpointItem[] {
  const sanitized = stripCreativeServerUiPolicy(payload) as unknown;
  if (Array.isArray(sanitized)) {
    return sanitized as CreativeModelEndpointItem[];
  }
  if (!sanitized || typeof sanitized !== 'object') {
    return [];
  }
  const raw = sanitized as Record<string, unknown>;
  if (Array.isArray(raw.data)) {
    return raw.data as CreativeModelEndpointItem[];
  }
  if (Array.isArray(raw.models)) {
    return raw.models as CreativeModelEndpointItem[];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAuthString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getCreativeBootstrapAuth(payload: unknown): {
  csrfToken: string;
  nonce: string;
} {
  const sanitized = stripCreativeServerUiPolicy(payload);
  const data = isRecord(sanitized) && isRecord(sanitized.data)
    ? sanitized.data
    : sanitized;
  const auth = isRecord(data) && isRecord(data.auth) ? data.auth : null;
  const mode = normalizeAuthString(auth?.mode);

  if (mode !== 'session-broker') {
    throw new Error('creative bootstrap auth.mode must be session-broker');
  }

  const csrfToken = normalizeAuthString(auth?.csrfToken);
  if (!csrfToken) {
    throw new Error('creative bootstrap auth.csrfToken is required');
  }

  const nonce = normalizeAuthString(auth?.nonce);
  if (!nonce) {
    throw new Error('creative bootstrap auth.nonce is required');
  }

  return { csrfToken, nonce };
}

function applyCreativeBootstrapAuthMaterial(payload: unknown): void {
  setCreativeSessionAuthMaterial(getCreativeBootstrapAuth(payload));
}

function getBootstrapData(payload: unknown): unknown {
  const sanitized = stripCreativeServerUiPolicy(payload);
  return isRecord(sanitized) && isRecord(sanitized.data)
    ? sanitized.data
    : sanitized;
}

function readNestedRecord(
  value: unknown,
  ...keys: string[]
): Record<string, unknown> | null {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current) || !isRecord(current[key])) {
      return null;
    }
    current = current[key];
  }
  return isRecord(current) ? current : null;
}

function readBooleanFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function applyCreativeBootstrapAssetSyncConfig(payload: unknown): void {
  const data = getBootstrapData(payload);
  const assets = readNestedRecord(data, 'assets');
  const assetSync = readNestedRecord(data, 'assetSync');
  const features = readNestedRecord(data, 'features');
  const enabled =
    readBooleanFlag(isRecord(data) ? data.assetSyncEnabled : undefined) ??
    readBooleanFlag(assetSync?.enabled) ??
    readBooleanFlag(assets?.syncEnabled) ??
    readBooleanFlag(assets?.assetSyncEnabled) ??
    readBooleanFlag(features?.assetSyncEnabled) ??
    false;
  const disabledReason =
    (typeof assetSync?.disabledReason === 'string' && assetSync.disabledReason) ||
    (typeof assets?.disabledReason === 'string' && assets.disabledReason) ||
    (typeof features?.assetSyncDisabledReason === 'string' &&
      features.assetSyncDisabledReason) ||
    (enabled ? undefined : 'bootstrap_disabled_or_missing');

  setCreativeAssetSyncConfig({
    assetSyncEnabled: enabled,
    ...(disabledReason ? { disabledReason } : {}),
  });
}

type CreativeBootstrapCapabilities = {
  videoRelayEnabled: boolean;
};

function getCreativeBootstrapCapabilities(
  payload: unknown
): CreativeBootstrapCapabilities {
  const data = getBootstrapData(payload);
  const capabilities = readNestedRecord(data, 'capabilities');
  const features = readNestedRecord(data, 'features');
  const videoRelayEnabled =
    readBooleanFlag(capabilities?.videoRelayEnabled) ??
    readBooleanFlag(capabilities?.supportsVideo) ??
    readBooleanFlag(features?.videoRelayEnabled) ??
    false;

  return { videoRelayEnabled };
}

async function fetchCreativeJson(
  endpoint: string,
  fetcher: typeof fetch = fetch
): Promise<unknown> {
  const response = await fetcher(endpoint, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`${endpoint} HTTP ${response.status}`);
  }

  const text = await response.text();
  return text.trim() ? JSON.parse(text) : {};
}

function buildManagedProfile(
  capabilities: CreativeBootstrapCapabilities
): ProviderProfile {
  return {
    id: CREATIVE_MANAGED_PROFILE_ID,
    name: CREATIVE_MANAGED_PROFILE_NAME,
    providerType: 'openai-compatible',
    baseUrl: CREATIVE_RELAY_BASE_URL,
    apiKey: '',
    authType: 'session-broker',
    enabled: true,
    capabilities: {
      supportsModelsEndpoint: true,
      supportsText: true,
      supportsImage: true,
      supportsVideo: capabilities.videoRelayEnabled,
      supportsAudio: true,
      supportsTools: true,
    },
  };
}

async function upsertManagedProfile(
  capabilities: CreativeBootstrapCapabilities
): Promise<void> {
  const profile = buildManagedProfile(capabilities);
  const profiles = providerProfilesSettings.get();
  const nextProfiles = [
    ...profiles.filter((item) => item.id !== CREATIVE_MANAGED_PROFILE_ID),
    profile,
  ];
  await providerProfilesSettings.update(nextProfiles);
}

function buildCatalog(models: ModelConfig[]): ProviderCatalog {
  const sortedModels = sortModelsByDisplayPriority(models);
  return {
    profileId: CREATIVE_MANAGED_PROFILE_ID,
    discoveredAt: Date.now(),
    discoveredModels: sortedModels,
    selectedModelIds: sortedModels.map((model) => model.id),
    sourceBaseUrl: CREATIVE_MODELS_ENDPOINT,
    signature: `creative:${sortedModels.map((model) => model.id).join('|')}`,
    error: null,
  };
}

async function upsertManagedCatalog(models: ModelConfig[]): Promise<void> {
  const catalogs = providerCatalogsSettings.get();
  const nextCatalog = buildCatalog(models);
  await providerCatalogsSettings.update([
    ...catalogs.filter((item) => item.profileId !== CREATIVE_MANAGED_PROFILE_ID),
    nextCatalog,
  ]);
}

async function upsertManagedUnavailableCatalog(): Promise<void> {
  const catalogs = providerCatalogsSettings.get();
  const nextCatalog: ProviderCatalog = {
    profileId: CREATIVE_MANAGED_PROFILE_ID,
    discoveredAt: Date.now(),
    discoveredModels: [],
    selectedModelIds: [],
    sourceBaseUrl: CREATIVE_MODELS_ENDPOINT,
    signature: 'creative:unavailable',
    error: 'creative_session_unavailable',
  };
  await providerCatalogsSettings.update([
    ...catalogs.filter((item) => item.profileId !== CREATIVE_MANAGED_PROFILE_ID),
    nextCatalog,
  ]);
}

async function ensureManagedUnavailableProfile(): Promise<void> {
  await upsertManagedProfile({
    videoRelayEnabled: false,
  });
  await upsertManagedUnavailableCatalog();
}

function filterModelsByCreativeCapabilities(
  models: ModelConfig[],
  capabilities: CreativeBootstrapCapabilities
): ModelConfig[] {
  if (capabilities.videoRelayEnabled) {
    return models;
  }
  return models.filter((model) => model.type !== 'video');
}

async function applyManagedDefaults(models: ModelConfig[]): Promise<void> {
  const routeTypes: ModelType[] = ['text', 'image', 'video', 'audio'];
  for (const type of routeTypes) {
    const defaultModel = getCreativeDefaultModel(type, models);
    if (!defaultModel) {
      continue;
    }

    await updateActiveInvocationRouteModel(
      type,
      createModelRef(CREATIVE_MANAGED_PROFILE_ID, defaultModel.id)
    );
  }
}

function reconcilePersistedCreativeModelSelections(models: ModelConfig[]): void {
  reconcilePersistedModelSelectionsWithAvailableModels(models, {
    text: getCreativeDefaultModel('text', models),
    agent: getCreativeDefaultModel('text', models),
    image: getCreativeDefaultModel('image', models),
    video: getCreativeDefaultModel('video', models),
    audio: getCreativeDefaultModel('audio', models),
  });
}

async function initializeCreativeManagedSessionBrokerInternal(
  fetcher: typeof fetch = fetch
): Promise<CreativeBootstrapResult> {
  if (!isCreativeEmbeddedMode()) {
    return { status: 'skipped' };
  }

  await settingsManager.waitForInitialization();

  try {
    clearCreativeSessionAuthMaterial();
    // Bootstrap is intentionally fetched for session/user readiness, but any
    // model display policy fields returned by the server are discarded.
    const bootstrapPayload = await fetchCreativeJson(
      CREATIVE_BOOTSTRAP_ENDPOINT,
      fetcher
    );
    applyCreativeBootstrapAuthMaterial(bootstrapPayload);
    applyCreativeBootstrapAssetSyncConfig(bootstrapPayload);
    const capabilities = getCreativeBootstrapCapabilities(bootstrapPayload);
    const modelsPayload = await fetchCreativeJson(CREATIVE_MODELS_ENDPOINT, fetcher);
    const models = filterModelsByCreativeCapabilities(
      extractModelItems(modelsPayload)
        .map(normalizeCreativeModel)
        .filter(Boolean) as ModelConfig[],
      capabilities
    );

    if (models.length === 0) {
      throw new Error('creative models pool is empty');
    }

    await upsertManagedProfile(capabilities);
    await upsertManagedCatalog(models);
    reconcilePersistedCreativeModelSelections(models);
    await applyManagedDefaults(models);
    await initializeCreativeModelPreferenceSync();
    // Cloud preferences are applied during sync; reconcile again so a synced
    // model that vanished from the current creative pool is visibly marked and
    // replaced with the opentu-owned fallback before direct use.
    reconcilePersistedCreativeModelSelections(models);

    return {
      status: 'ready',
      profileId: CREATIVE_MANAGED_PROFILE_ID,
      models,
    };
  } catch (error) {
    clearCreativeSessionAuthMaterial();
    setCreativeAssetSyncConfig({
      assetSyncEnabled: false,
      disabledReason: 'bootstrap_error',
    });
    const message = error instanceof Error ? error.message : String(error);
    try {
      await ensureManagedUnavailableProfile();
    } catch (fallbackError) {
      console.warn(
        '[CreativeSessionBroker] failed to install managed unavailable profile:',
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      );
    }
    console.warn('[CreativeSessionBroker] initialization failed:', message);
    return {
      status: 'error',
      profileId: CREATIVE_MANAGED_PROFILE_ID,
      error: message,
    };
  }
}

export function initializeCreativeManagedSessionBroker(
  fetcher: typeof fetch = fetch
): Promise<CreativeBootstrapResult> {
  initializationPromise ||= initializeCreativeManagedSessionBrokerInternal(fetcher);
  return initializationPromise;
}

export function resetCreativeManagedSessionBrokerForTests(): void {
  initializationPromise = null;
}
