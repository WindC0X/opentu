import {
  AI_MODEL_SELECTION_CACHE_KEY,
  AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY,
} from '../constants/storage';
import type {
  ModelConfig,
  ModelType,
  ModelVendor,
} from '../constants/model-config';
import type { ModelRef } from './settings-manager';
import type { GenerationType } from './ai-input-parser';

export type PersistedGenerationType = GenerationType;

export interface PersistedModelSelection {
  modelId: string;
  profileId: string | null;
  providerIdHint: string | null;
  vendorHint: ModelVendor | null;
  updatedAt: number;
}

export type PersistedModelSelectionMap = Partial<
  Record<PersistedGenerationType, PersistedModelSelection>
>;

export type UnavailableModelSelectionReason = 'unavailable-in-model-pool';

export interface UnavailableModelSelectionSnapshot {
  modelId: string;
  profileId: string | null;
  providerIdHint: string | null;
  vendorHint: ModelVendor | string | null;
}

export interface UnavailableModelSelectionMarker {
  generationType: PersistedGenerationType;
  original: UnavailableModelSelectionSnapshot;
  fallback: UnavailableModelSelectionSnapshot | null;
  updatedAt: number;
  reason: UnavailableModelSelectionReason;
}

export type UnavailableModelSelectionMarkerMap = Partial<
  Record<PersistedGenerationType, UnavailableModelSelectionMarker>
>;

type PersistedModelSelectionListener = (
  cache: PersistedModelSelectionMap
) => void;
type UnavailableModelSelectionMarkerListener = (
  markers: UnavailableModelSelectionMarkerMap
) => void;

const listeners = new Set<PersistedModelSelectionListener>();
const markerListeners = new Set<UnavailableModelSelectionMarkerListener>();
const PERSISTED_GENERATION_TYPES: PersistedGenerationType[] = [
  'image',
  'video',
  'audio',
  'text',
  'agent',
];
const MODEL_TYPE_BY_GENERATION_TYPE: Record<PersistedGenerationType, ModelType> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'text',
  agent: 'text',
};

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function looksLikeSecretOrAuthMaterial(value: string): boolean {
  return (
    /\bsk-(?:proj-|test-)?[A-Za-z0-9_-]{12,}\b/i.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
    /^https?:\/\//i.test(value) ||
    /\b(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|credential)\b/i.test(
      value
    )
  );
}

function normalizeMarkerString(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized || looksLikeSecretOrAuthMaterial(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeMarkerModelId(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  return looksLikeSecretOrAuthMaterial(normalized) ? '[redacted]' : normalized;
}

function isPersistedGenerationType(
  value: unknown
): value is PersistedGenerationType {
  return (
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'text' ||
    value === 'agent'
  );
}

function isPersistedModelSelection(
  value: unknown
): value is PersistedModelSelection {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const selection = value as Record<string, unknown>;
  return (
    typeof selection.modelId === 'string' &&
    selection.modelId.trim().length > 0 &&
    (selection.profileId === null || typeof selection.profileId === 'string') &&
    (selection.providerIdHint === null ||
      typeof selection.providerIdHint === 'string') &&
    (selection.vendorHint === null || typeof selection.vendorHint === 'string') &&
    typeof selection.updatedAt === 'number' &&
    Number.isFinite(selection.updatedAt)
  );
}

function normalizeUnavailableModelSelectionSnapshot(
  value: unknown
): UnavailableModelSelectionSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const modelId = normalizeMarkerModelId(raw.modelId);
  if (!modelId) {
    return null;
  }

  return {
    modelId,
    profileId: normalizeMarkerString(raw.profileId),
    providerIdHint: normalizeMarkerString(raw.providerIdHint),
    vendorHint: normalizeMarkerString(raw.vendorHint),
  };
}

function normalizeUnavailableModelSelectionMarker(
  type: PersistedGenerationType,
  value: unknown
): UnavailableModelSelectionMarker | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const generationType =
    isPersistedGenerationType(raw.generationType) &&
    raw.generationType === type
      ? raw.generationType
      : type;
  const original = normalizeUnavailableModelSelectionSnapshot(raw.original);
  if (!original) {
    return null;
  }
  const fallback =
    raw.fallback === null || raw.fallback === undefined
      ? null
      : normalizeUnavailableModelSelectionSnapshot(raw.fallback);
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : Date.now();

  return {
    generationType,
    original,
    fallback,
    updatedAt,
    reason: 'unavailable-in-model-pool',
  };
}

function readCache(): PersistedModelSelectionMap {
  try {
    const raw = window.localStorage.getItem(AI_MODEL_SELECTION_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const next: PersistedModelSelectionMap = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (isPersistedGenerationType(key) && isPersistedModelSelection(value)) {
        next[key] = {
          modelId: value.modelId.trim(),
          profileId: normalizeString(value.profileId),
          providerIdHint: normalizeString(value.providerIdHint),
          vendorHint: normalizeString(value.vendorHint) as ModelVendor | null,
          updatedAt: value.updatedAt,
        };
      }
    });
    return next;
  } catch {
    return {};
  }
}

function writeCache(cache: PersistedModelSelectionMap): void {
  try {
    const hasEntries = Object.values(cache).some(Boolean);
    if (!hasEntries) {
      window.localStorage.removeItem(AI_MODEL_SELECTION_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(
      AI_MODEL_SELECTION_CACHE_KEY,
      JSON.stringify(cache)
    );
  } catch {
    // localStorage 不可用时静默降级
  }
}

function readUnavailableMarkerCache(): UnavailableModelSelectionMarkerMap {
  try {
    const raw = window.localStorage.getItem(
      AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY
    );
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    const next: UnavailableModelSelectionMarkerMap = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (!isPersistedGenerationType(key)) {
        return;
      }
      const marker = normalizeUnavailableModelSelectionMarker(key, value);
      if (marker) {
        next[key] = marker;
      }
    });
    return next;
  } catch {
    return {};
  }
}

function writeUnavailableMarkerCache(
  markers: UnavailableModelSelectionMarkerMap
): void {
  try {
    const hasEntries = Object.values(markers).some(Boolean);
    if (!hasEntries) {
      window.localStorage.removeItem(AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY);
      return;
    }
    window.localStorage.setItem(
      AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY,
      JSON.stringify(markers)
    );
  } catch {
    // localStorage 不可用时静默降级
  }
}

function getSelectionKey(
  modelId: string,
  profileId?: string | null
): string {
  const normalizedProfileId = normalizeString(profileId);
  return normalizedProfileId ? `${normalizedProfileId}::${modelId}` : modelId;
}

function getSelectionKeyForModel(
  model: Pick<ModelConfig, 'id' | 'selectionKey' | 'sourceProfileId'>
): string {
  return (
    model.selectionKey ||
    (model.sourceProfileId ? `${model.sourceProfileId}::${model.id}` : model.id)
  );
}

function isSelectionAvailableInModelPool(
  selection: PersistedModelSelection,
  models: ModelConfig[]
): boolean {
  const expectedKey = getSelectionKey(selection.modelId, selection.profileId);
  const expectedProfileId = selection.profileId || null;
  return models.some(
    (model) =>
      getSelectionKeyForModel(model) === expectedKey ||
      (model.id === selection.modelId &&
        (model.sourceProfileId || null) === expectedProfileId) ||
      (expectedProfileId === null &&
        model.id === selection.modelId &&
        !model.sourceProfileId)
  );
}

function toPersistedSelection(
  model: ModelConfig,
  updatedAt = Date.now()
): PersistedModelSelection {
  return {
    modelId: model.id,
    profileId: normalizeString(model.sourceProfileId),
    providerIdHint: normalizeString(model.sourceProfileId),
    vendorHint: model.vendor,
    updatedAt,
  };
}

function toUnavailableModelSelectionSnapshot(
  selection: Pick<
    PersistedModelSelection,
    'modelId' | 'profileId' | 'providerIdHint' | 'vendorHint'
  >
): UnavailableModelSelectionSnapshot {
  return {
    modelId: normalizeMarkerModelId(selection.modelId) || '[redacted]',
    profileId: normalizeMarkerString(selection.profileId),
    providerIdHint: normalizeMarkerString(selection.providerIdHint),
    vendorHint: normalizeMarkerString(selection.vendorHint),
  };
}

export function reconcilePersistedModelSelectionsWithAvailableModels(
  models: ModelConfig[],
  fallbackByGenerationType: Partial<
    Record<PersistedGenerationType, ModelConfig | null | undefined>
  > = {}
): PersistedModelSelectionMap {
  const cache = readCache();
  const markers = readUnavailableMarkerCache();
  const next: PersistedModelSelectionMap = { ...cache };
  let changed = false;
  let markersChanged = false;

  PERSISTED_GENERATION_TYPES.forEach((type) => {
    const selection = next[type];
    if (!selection) {
      return;
    }

    const modelType = MODEL_TYPE_BY_GENERATION_TYPE[type];
    const availableModels = models.filter((model) => model.type === modelType);
    if (isSelectionAvailableInModelPool(selection, availableModels)) {
      return;
    }

    const fallback = fallbackByGenerationType[type];
    const updatedAt = Date.now();
    let fallbackSelection: PersistedModelSelection | null = null;
    if (
      fallback &&
      fallback.type === modelType &&
      availableModels.some(
        (model) => getSelectionKeyForModel(model) === getSelectionKeyForModel(fallback)
      )
    ) {
      fallbackSelection = toPersistedSelection(fallback, updatedAt);
      next[type] = fallbackSelection;
    } else {
      delete next[type];
    }
    markers[type] = {
      generationType: type,
      original: toUnavailableModelSelectionSnapshot(selection),
      fallback: fallbackSelection
        ? toUnavailableModelSelectionSnapshot(fallbackSelection)
        : null,
      updatedAt,
      reason: 'unavailable-in-model-pool',
    };
    changed = true;
    markersChanged = true;
  });

  if (changed) {
    writeCache(next);
    emitCacheChange(next);
  }
  if (markersChanged) {
    writeUnavailableMarkerCache(markers);
    emitUnavailableMarkerChange(markers);
  }

  return next;
}

function emitCacheChange(cache: PersistedModelSelectionMap): void {
  const snapshot = JSON.parse(
    JSON.stringify(cache)
  ) as PersistedModelSelectionMap;
  listeners.forEach((listener) => {
    listener(snapshot);
  });
}

function emitUnavailableMarkerChange(
  markers: UnavailableModelSelectionMarkerMap
): void {
  const snapshot = JSON.parse(
    JSON.stringify(markers)
  ) as UnavailableModelSelectionMarkerMap;
  markerListeners.forEach((listener) => {
    listener(snapshot);
  });
}

function clearUnavailableModelSelectionMarkerInternal(
  type?: PersistedGenerationType
): void {
  const markers = readUnavailableMarkerCache();
  const hadEntries = Object.values(markers).some(Boolean);
  if (!hadEntries) {
    return;
  }

  if (type) {
    if (!markers[type]) {
      return;
    }
    delete markers[type];
  } else {
    PERSISTED_GENERATION_TYPES.forEach((generationType) => {
      delete markers[generationType];
    });
  }

  writeUnavailableMarkerCache(markers);
  emitUnavailableMarkerChange(markers);
}

export function getAllPersistedModelSelections(): PersistedModelSelectionMap {
  return readCache();
}

export function getAllUnavailableModelSelectionMarkers(): UnavailableModelSelectionMarkerMap {
  return readUnavailableMarkerCache();
}

export function subscribePersistedModelSelectionChange(
  listener: PersistedModelSelectionListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeUnavailableModelSelectionMarkerChange(
  listener: UnavailableModelSelectionMarkerListener
): () => void {
  markerListeners.add(listener);
  return () => {
    markerListeners.delete(listener);
  };
}

export function getPersistedModelSelection(
  type: PersistedGenerationType
): PersistedModelSelection | null {
  const cache = readCache();
  if (cache[type]) {
    return cache[type] || null;
  }

  if (type === 'agent') {
    return cache.text || null;
  }

  return null;
}

export function getUnavailableModelSelectionMarker(
  type: PersistedGenerationType
): UnavailableModelSelectionMarker | null {
  const markers = readUnavailableMarkerCache();
  return markers[type] || null;
}

export function setPersistedModelSelection(
  type: PersistedGenerationType,
  selection: {
    modelId: string;
    modelRef?: ModelRef | null;
    providerIdHint?: string | null;
    vendorHint?: ModelVendor | null;
  }
): void {
  const modelId = normalizeString(selection.modelId);
  if (!modelId) {
    clearPersistedModelSelection(type);
    return;
  }

  const cache = readCache();
  cache[type] = {
    modelId,
    profileId: normalizeString(selection.modelRef?.profileId),
    providerIdHint: normalizeString(selection.providerIdHint),
    vendorHint: normalizeString(selection.vendorHint) as ModelVendor | null,
    updatedAt: Date.now(),
  };
  writeCache(cache);
  emitCacheChange(cache);
  clearUnavailableModelSelectionMarkerInternal(type);
}

export function clearPersistedModelSelection(
  type: PersistedGenerationType
): void {
  const cache = readCache();
  if (!cache[type]) {
    clearUnavailableModelSelectionMarkerInternal(type);
    return;
  }
  delete cache[type];
  writeCache(cache);
  emitCacheChange(cache);
  clearUnavailableModelSelectionMarkerInternal(type);
}

export function clearUnavailableModelSelectionMarker(
  type?: PersistedGenerationType
): void {
  clearUnavailableModelSelectionMarkerInternal(type);
}
