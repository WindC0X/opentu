import type { ModelVendor } from '../constants/model-config';
import {
  getAllPersistedModelSelections,
  setPersistedModelSelection,
  subscribePersistedModelSelectionChange,
  type PersistedGenerationType,
  type PersistedModelSelection,
} from '../utils/ai-model-selection-storage';
import { createModelRef } from '../utils/settings-manager';
import {
  CREATIVE_MODEL_PREFERENCE_ENDPOINT,
  getCreativeSessionAuthHeaders,
  isCreativeEmbeddedMode,
} from './creative-mode';
import { removeSensitiveCloudFields } from './creative-cloud-sanitizer';

export type CreativeModelDisplayMode = 'default' | 'compact' | 'advanced';

export interface CreativeCloudModelSelection {
  modelId: string;
  profileId?: string | null;
  providerIdHint?: string | null;
  vendorHint?: ModelVendor | string | null;
  updatedAt?: number;
}

export interface CreativeModelPreference {
  default?: Partial<Record<PersistedGenerationType, CreativeCloudModelSelection>>;
  pinned?: CreativeCloudModelSelection[];
  recent?: CreativeCloudModelSelection[];
  displayMode?: CreativeModelDisplayMode;
  customOrder?: string[];
  revision?: number | null;
}

export interface CreativeModelPreferencePatch {
  baseRevision?: number;
  preference: Omit<CreativeModelPreference, 'revision'>;
}

const GENERATION_TYPES: PersistedGenerationType[] = [
  'image',
  'video',
  'audio',
  'text',
  'agent',
];
const GENERATION_TYPE_SET = new Set<string>(GENERATION_TYPES);
const DISPLAY_MODES = new Set<CreativeModelDisplayMode>([
  'default',
  'compact',
  'advanced',
]);

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeRevision(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeSelection(
  value: unknown
): CreativeCloudModelSelection | null {
  const stripped = removeSensitiveCloudFields(value);
  if (!stripped || typeof stripped !== 'object') {
    return null;
  }

  const raw = stripped as Record<string, unknown>;
  const modelId = normalizeString(raw.modelId);
  if (!modelId) {
    return null;
  }

  const selection: CreativeCloudModelSelection = { modelId };
  const profileId = normalizeString(raw.profileId);
  if (profileId) selection.profileId = profileId;
  const providerIdHint = normalizeString(raw.providerIdHint);
  if (providerIdHint) selection.providerIdHint = providerIdHint;
  const vendorHint = normalizeString(raw.vendorHint);
  if (vendorHint) selection.vendorHint = vendorHint;
  const updatedAt = normalizeNumber(raw.updatedAt);
  if (updatedAt !== undefined) selection.updatedAt = updatedAt;
  return selection;
}

function sanitizeSelectionArray(value: unknown): CreativeCloudModelSelection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => sanitizeSelection(item))
    .filter(Boolean) as CreativeCloudModelSelection[];
}

export function sanitizeCreativeModelPreference(
  value: unknown
): CreativeModelPreference {
  const stripped = removeSensitiveCloudFields(value);
  if (!stripped || typeof stripped !== 'object') {
    return {};
  }

  const raw = stripped as Record<string, unknown>;
  const result: CreativeModelPreference = {};
  if (raw.default && typeof raw.default === 'object') {
    const defaults: CreativeModelPreference['default'] = {};
    Object.entries(raw.default as Record<string, unknown>).forEach(
      ([type, selection]) => {
        if (!GENERATION_TYPE_SET.has(type)) {
          return;
        }
        const safeSelection = sanitizeSelection(selection);
        if (safeSelection) {
          defaults[type as PersistedGenerationType] = safeSelection;
        }
      }
    );
    if (Object.keys(defaults).length > 0) {
      result.default = defaults;
    }
  }

  const pinned = sanitizeSelectionArray(raw.pinned);
  if (pinned.length > 0) {
    result.pinned = pinned;
  }

  const recent = sanitizeSelectionArray(raw.recent);
  if (recent.length > 0) {
    result.recent = recent;
  }

  if (typeof raw.displayMode === 'string' && DISPLAY_MODES.has(raw.displayMode as CreativeModelDisplayMode)) {
    result.displayMode = raw.displayMode as CreativeModelDisplayMode;
  }

  if (Array.isArray(raw.customOrder)) {
    const customOrder = raw.customOrder
      .map((item) => normalizeString(item))
      .filter(Boolean) as string[];
    if (customOrder.length > 0) {
      result.customOrder = customOrder;
    }
  }

  const revision = normalizeRevision(raw.revision);
  if (revision !== null) {
    result.revision = revision;
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeCreativeModelPreferenceResponse(
  payload: unknown
): CreativeModelPreference {
  let preferencePayload = payload;
  let responseRevision: unknown;

  if (isRecord(payload)) {
    const data = isRecord(payload.data) ? payload.data : payload;
    if ('preference' in data) {
      preferencePayload = data.preference;
      responseRevision = data.revision;
    }
  }

  const preference = sanitizeCreativeModelPreference(preferencePayload);
  const revision = normalizeRevision(responseRevision ?? preference.revision);
  if (revision !== null) {
    preference.revision = revision;
  }
  return preference;
}

export function buildCreativeModelPreferencePatch(
  value: unknown,
  baseRevision?: string | number | null
): CreativeModelPreferencePatch {
  const sanitized = sanitizeCreativeModelPreference(value);
  const { revision: _revision, ...safePreference } = sanitized;
  const patch: CreativeModelPreferencePatch = { preference: safePreference };
  const normalizedBaseRevision = normalizeRevision(baseRevision);
  if (normalizedBaseRevision !== null) {
    patch.baseRevision = normalizedBaseRevision;
  }
  return patch;
}

function withoutRevision(
  preference: CreativeModelPreference
): Omit<CreativeModelPreference, 'revision'> {
  const { revision: _revision, ...rest } = preference;
  return rest;
}

function rebaseCreativeModelPreference(
  remotePreference: CreativeModelPreference | null,
  localPreference: Omit<CreativeModelPreference, 'revision'>
): Omit<CreativeModelPreference, 'revision'> {
  const remote = remotePreference
    ? withoutRevision(sanitizeCreativeModelPreference(remotePreference))
    : {};
  const local = withoutRevision(sanitizeCreativeModelPreference(localPreference));
  const rebased: Omit<CreativeModelPreference, 'revision'> = { ...remote };

  if (local.default) {
    rebased.default = {
      ...(remote.default || {}),
      ...local.default,
    };
  }
  if (local.pinned) {
    rebased.pinned = local.pinned;
  }
  if (local.recent) {
    rebased.recent = local.recent;
  }
  if (local.displayMode) {
    rebased.displayMode = local.displayMode;
  }
  if (local.customOrder) {
    rebased.customOrder = local.customOrder;
  }

  return rebased;
}

function toCloudSelection(
  selection: PersistedModelSelection
): CreativeCloudModelSelection {
  return {
    modelId: selection.modelId,
    profileId: selection.profileId,
    providerIdHint: selection.providerIdHint,
    vendorHint: selection.vendorHint,
    updatedAt: selection.updatedAt,
  };
}

function buildPreferenceFromLocalCache(): CreativeModelPreference {
  const cache = getAllPersistedModelSelections();
  const defaults: CreativeModelPreference['default'] = {};

  GENERATION_TYPES.forEach((type) => {
    const selection = cache[type];
    if (selection) {
      defaults[type] = toCloudSelection(selection);
    }
  });

  const recent = Object.values(cache)
    .filter(Boolean)
    .map((selection) => toCloudSelection(selection as PersistedModelSelection))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));

  return {
    ...(Object.keys(defaults).length > 0 ? { default: defaults } : {}),
    ...(recent.length > 0 ? { recent } : {}),
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

function getDefaultCreativeFetch(): typeof fetch {
  const fetchOwner =
    typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? window
      : globalThis;
  const fetcher = fetchOwner.fetch;
  if (typeof fetcher !== 'function') {
    throw new Error('fetch is not available for Creative model sync');
  }
  return fetcher.bind(fetchOwner) as typeof fetch;
}

export class CreativeModelPreferenceSyncService {
  private revision: number | null = null;
  private unsubscribeLocal: (() => void) | null = null;
  private applyingRemote = false;
  private pendingTimer: number | null = null;

  constructor(
    private readonly fetcher: typeof fetch = getDefaultCreativeFetch()
  ) {}

  private async sendPatch(
    patch: CreativeModelPreferencePatch
  ): Promise<Response> {
    return this.fetcher(CREATIVE_MODEL_PREFERENCE_ENDPOINT, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...getCreativeSessionAuthHeaders(),
      },
      body: JSON.stringify(patch),
    });
  }

  async fetchPreference(): Promise<CreativeModelPreference | null> {
    const response = await this.fetcher(CREATIVE_MODEL_PREFERENCE_ENDPOINT, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`模型偏好同步失败: HTTP ${response.status}`);
    }

    const preference = sanitizeCreativeModelPreferenceResponse(
      await readJsonResponse(response)
    );
    this.revision = normalizeRevision(preference.revision);
    return preference;
  }

  async patchPreference(
    preference: unknown = buildPreferenceFromLocalCache()
  ): Promise<CreativeModelPreference> {
    const patch = buildCreativeModelPreferencePatch(preference, this.revision);
    let response = await this.sendPatch(patch);

    if (response.status === 409) {
      const latestPreference = await this.fetchPreference();
      const latestRevision = normalizeRevision(latestPreference?.revision);
      if (latestRevision !== null) {
        const rebasedPreference = rebaseCreativeModelPreference(
          latestPreference,
          patch.preference
        );
        response = await this.sendPatch(
          buildCreativeModelPreferencePatch(rebasedPreference, latestRevision)
        );
      }
    }

    if (!response.ok) {
      throw new Error(`模型偏好保存失败: HTTP ${response.status}`);
    }

    const next = sanitizeCreativeModelPreferenceResponse(
      await readJsonResponse(response)
    );
    const nextRevision = normalizeRevision(next.revision);
    if (nextRevision !== null) {
      this.revision = nextRevision;
    }
    return next;
  }

  applyPreferenceToLocal(preference: CreativeModelPreference | null): void {
    if (!preference?.default) {
      return;
    }

    this.applyingRemote = true;
    try {
      Object.entries(preference.default).forEach(([type, selection]) => {
        if (!selection || !GENERATION_TYPE_SET.has(type)) {
          return;
        }
        setPersistedModelSelection(type as PersistedGenerationType, {
          modelId: selection.modelId,
          modelRef: createModelRef(selection.profileId || null, selection.modelId),
          providerIdHint: selection.providerIdHint || selection.profileId || null,
          vendorHint: (selection.vendorHint as ModelVendor | null) || null,
        });
      });
    } finally {
      this.applyingRemote = false;
    }
  }

  startLocalAutoSync(): void {
    if (this.unsubscribeLocal) {
      return;
    }
    this.unsubscribeLocal = subscribePersistedModelSelectionChange(() => {
      if (this.applyingRemote) {
        return;
      }
      this.schedulePatch();
    });
  }

  stopLocalAutoSync(): void {
    this.unsubscribeLocal?.();
    this.unsubscribeLocal = null;
    if (this.pendingTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private schedulePatch(): void {
    if (typeof window === 'undefined') {
      void this.patchPreference().catch((error) => {
        console.warn('[CreativeModelPreferenceSync] sync failed:', error);
      });
      return;
    }

    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      void this.patchPreference().catch((error) => {
        console.warn('[CreativeModelPreferenceSync] sync failed:', error);
      });
    }, 600);
  }
}

let singletonService: CreativeModelPreferenceSyncService | null = null;

export async function initializeCreativeModelPreferenceSync(): Promise<void> {
  if (!isCreativeEmbeddedMode()) {
    return;
  }

  singletonService ||= new CreativeModelPreferenceSyncService();
  try {
    const preference = await singletonService.fetchPreference();
    singletonService.applyPreferenceToLocal(preference);
  } catch (error) {
    console.warn('[CreativeModelPreferenceSync] initial fetch failed:', error);
  }
  singletonService.startLocalAutoSync();
}
