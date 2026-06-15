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
import { refreshRuntimeModelDiscoveryFromSettings } from '../utils/runtime-model-discovery';
import { reconcilePersistedModelSelectionsWithAvailableModels } from '../utils/ai-model-selection-storage';
import {
  getCreativeDefaultModel,
  stripCreativeServerUiPolicy,
} from './creative-display-policy';
import {
  CREATIVE_BOOTSTRAP_ENDPOINT,
  CREATIVE_MANAGED_CATALOG_UPDATED_EVENT,
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
import {
  getCreativePolicyDefaultModelForGenerationType,
  resetCreativeModelPolicySnapshot,
  setCreativeModelPolicyFromBootstrap,
} from './creative-model-policy-resolver';

type CreativeModelEndpointItem = {
  id?: unknown;
  object?: unknown;
  owned_by?: unknown;
  ownedBy?: unknown;
  vendor?: unknown;
  type?: unknown;
  modality?: unknown;
  modalities?: unknown;
  supported_endpoint_types?: unknown;
  label?: unknown;
  name?: unknown;
  displayName?: unknown;
  shortLabel?: unknown;
  shortCode?: unknown;
  short_code?: unknown;
  description?: unknown;
  tags?: unknown;
};

export interface CreativeBootstrapResult {
  status: 'skipped' | 'ready' | 'error';
  profileId?: string;
  models?: ModelConfig[];
  error?: string;
}

let initializationPromise: Promise<CreativeBootstrapResult> | null = null;

function dispatchManagedCatalogUpdated(status: 'ready' | 'error'): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(CREATIVE_MANAGED_CATALOG_UPDATED_EVENT, {
      detail: { profileId: CREATIVE_MANAGED_PROFILE_ID, status },
    })
  );
}

function cloneStaticModel(model: ModelConfig): ModelConfig {
  return JSON.parse(JSON.stringify(model)) as ModelConfig;
}

function inferVendor(modelId: string, owner?: string | null): ModelVendor {
  const lower = `${modelId} ${owner || ''}`.toLowerCase();
  if (lower.includes('gpt') || lower.includes('openai')) return ModelVendor.GPT;
  if (lower.includes('gemini') || lower.includes('google'))
    return ModelVendor.GEMINI;
  if (lower.includes('claude') || lower.includes('anthropic'))
    return ModelVendor.ANTHROPIC;
  if (lower.includes('deepseek')) return ModelVendor.DEEPSEEK;
  if (lower.includes('grok') || lower.includes('xai')) return ModelVendor.GROK;
  if (lower.includes('qwen')) return ModelVendor.QWEN;
  if (lower.includes('suno') || lower.includes('chirp'))
    return ModelVendor.SUNO;
  if (
    lower.includes('seedance') ||
    lower.includes('seedream') ||
    lower.includes('doubao')
  ) {
    return ModelVendor.DOUBAO;
  }
  if (lower.includes('kling')) return ModelVendor.KLING;
  if (lower.includes('veo')) return ModelVendor.VEO;
  if (lower.includes('sora')) return ModelVendor.SORA;
  return ModelVendor.OTHER;
}

function normalizeServerString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeServerVendor(value: unknown): ModelVendor | null {
  const normalized = normalizeServerString(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }
  const vendorEntries: Array<[string, ModelVendor]> = [
    ['gemini', ModelVendor.GEMINI],
    ['google', ModelVendor.GOOGLE],
    ['flux', ModelVendor.FLUX],
    ['midjourney', ModelVendor.MIDJOURNEY],
    ['mj', ModelVendor.MIDJOURNEY],
    ['suno', ModelVendor.SUNO],
    ['openai', ModelVendor.GPT],
    ['gpt', ModelVendor.GPT],
    ['grok', ModelVendor.GROK],
    ['xai', ModelVendor.GROK],
    ['qwen', ModelVendor.QWEN],
    ['glm', ModelVendor.GLM],
    ['zhipu', ModelVendor.GLM],
    ['minimax', ModelVendor.MINIMAX],
    ['mistral', ModelVendor.MISTRAL],
    ['llama', ModelVendor.LLAMA],
    ['veo', ModelVendor.VEO],
    ['sora', ModelVendor.SORA],
    ['runway', ModelVendor.RUNWAY],
    ['pika', ModelVendor.PIKA],
    ['kling', ModelVendor.KLING],
    ['hunyuan', ModelVendor.HUNYUAN],
    ['stepfun', ModelVendor.STEPFUN],
    ['deepseek', ModelVendor.DEEPSEEK],
    ['anthropic', ModelVendor.ANTHROPIC],
    ['claude', ModelVendor.ANTHROPIC],
    ['doubao', ModelVendor.DOUBAO],
    ['volc', ModelVendor.DOUBAO],
    ['happyhorse', ModelVendor.HAPPYHORSE],
  ];
  for (const [keyword, vendor] of vendorEntries) {
    if (normalized.includes(keyword)) {
      return vendor;
    }
  }
  return null;
}

function buildShortCode(modelId: string, type: ModelType): string {
  const compact = modelId
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => part[0]?.toLowerCase() || '')
    .join('');
  if (compact) return compact.slice(0, 6);
  if (type === 'audio') return 'aud';
  if (type === 'video') return 'vid';
  if (type === 'text') return 'txt';
  return 'img';
}

function normalizeServerTags(value: unknown): string[] {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === 'string'
    ? value.split(/[,;|\s]+/)
    : [];
  const tags = new Set<string>();
  for (const rawTag of rawTags) {
    if (typeof rawTag !== 'string') {
      continue;
    }
    const tag = rawTag.trim().toLowerCase();
    if (!tag || /https?:|api[_-]?key|base[_-]?url|secret|token|channel[_-]?id/.test(tag)) {
      continue;
    }
    tags.add(tag.slice(0, 48));
  }
  return Array.from(tags);
}

function inferModelType(
  item: CreativeModelEndpointItem,
  modelId: string
): ModelType {
  const hints = [
    item.type,
    item.modality,
    item.vendor,
    ...(Array.isArray(item.modalities) ? item.modalities : []),
    ...(Array.isArray(item.supported_endpoint_types)
      ? item.supported_endpoint_types
      : []),
    ...normalizeServerTags(item.tags),
    modelId,
  ]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ');

  if (hints.includes('image') || hints.includes('/images/')) return 'image';
  if (hints.includes('video') || hints.includes('/videos/')) return 'video';
  if (
    hints.includes('audio') ||
    hints.includes('speech') ||
    hints.includes('music')
  ) {
    return 'audio';
  }
  return 'text';
}

function normalizeCreativeModel(
  item: CreativeModelEndpointItem
): ModelConfig | null {
  const id =
    typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null;
  if (!id) {
    return null;
  }

  const staticModel = getStaticModelConfig(id);
  const serverLabel =
    normalizeServerString(item.label) ||
    normalizeServerString(item.displayName) ||
    normalizeServerString(item.name);
  const serverShortLabel =
    normalizeServerString(item.shortLabel) || serverLabel || id;
  const serverShortCode =
    normalizeServerString(item.shortCode) || normalizeServerString(item.short_code);
  const serverDescription = normalizeServerString(item.description);
  const serverTags = normalizeServerTags(item.tags);
  const type = staticModel?.type || inferModelType(item, id);
  const vendor =
    staticModel?.vendor ||
    normalizeServerVendor(item.vendor) ||
    normalizeServerVendor(item.owned_by) ||
    normalizeServerVendor(item.ownedBy) ||
    inferVendor(
      id,
      normalizeServerString(item.owned_by) || normalizeServerString(item.ownedBy)
    );
  const base = staticModel
    ? {
        ...cloneStaticModel(staticModel),
        // Preserve the exact logical model id supplied by new-api. Static
        // metadata can be matched case-insensitively for display/params, but
        // relay submissions must use the administrator-configured channel id.
        id,
      }
    : {
        id,
        label: serverLabel || id,
        shortLabel: serverShortLabel,
        shortCode: serverShortCode || buildShortCode(id, type),
        description: serverDescription || undefined,
        type,
        vendor,
      };
  const mergedTags = staticModel
    ? [...(base.tags || []), 'runtime', 'creative']
    : [...(base.tags || []), ...serverTags, 'runtime', 'creative'];

  return {
    ...base,
    shortLabel: staticModel
      ? base.shortLabel || base.label
      : base.shortLabel || serverShortLabel,
    shortCode: base.shortCode || serverShortCode || buildShortCode(id, type),
    description: base.description || serverDescription || undefined,
    sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
    sourceProfileName: CREATIVE_MANAGED_PROFILE_NAME,
    selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::${id}`,
    tags: Array.from(new Set(mergedTags)),
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
  const data =
    isRecord(sanitized) && isRecord(sanitized.data)
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
    (typeof assetSync?.disabledReason === 'string' &&
      assetSync.disabledReason) ||
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
    ...catalogs.filter(
      (item) => item.profileId !== CREATIVE_MANAGED_PROFILE_ID
    ),
    nextCatalog,
  ]);
  refreshRuntimeModelDiscoveryFromSettings({ reloadFromStorage: true });
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
    ...catalogs.filter(
      (item) => item.profileId !== CREATIVE_MANAGED_PROFILE_ID
    ),
    nextCatalog,
  ]);
  refreshRuntimeModelDiscoveryFromSettings({ reloadFromStorage: true });
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

function reconcilePersistedCreativeModelSelections(
  models: ModelConfig[]
): void {
  reconcilePersistedModelSelectionsWithAvailableModels(models, {
    text: getCreativePolicyDefaultModelForGenerationType('text', models),
    agent: getCreativePolicyDefaultModelForGenerationType('agent', models),
    image: getCreativePolicyDefaultModelForGenerationType('image', models),
    video: getCreativePolicyDefaultModelForGenerationType('video', models),
    audio: getCreativePolicyDefaultModelForGenerationType('audio', models),
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
    const bootstrapPayload = await fetchCreativeJson(
      CREATIVE_BOOTSTRAP_ENDPOINT,
      fetcher
    );
    setCreativeModelPolicyFromBootstrap(bootstrapPayload);
    applyCreativeBootstrapAuthMaterial(bootstrapPayload);
    applyCreativeBootstrapAssetSyncConfig(bootstrapPayload);
    const capabilities = getCreativeBootstrapCapabilities(bootstrapPayload);
    const modelsPayload = await fetchCreativeJson(
      CREATIVE_MODELS_ENDPOINT,
      fetcher
    );
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
    dispatchManagedCatalogUpdated('ready');

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
    resetCreativeModelPolicySnapshot();
    const message = error instanceof Error ? error.message : String(error);
    try {
      await ensureManagedUnavailableProfile();
    } catch (fallbackError) {
      console.warn(
        '[CreativeSessionBroker] failed to install managed unavailable profile:',
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError)
      );
    }
    console.warn('[CreativeSessionBroker] initialization failed:', message);
    dispatchManagedCatalogUpdated('error');
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
  initializationPromise ||=
    initializeCreativeManagedSessionBrokerInternal(fetcher);
  return initializationPromise;
}

export function resetCreativeManagedSessionBrokerForTests(): void {
  initializationPromise = null;
}
