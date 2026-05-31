import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ModelVendor,
  type ModelConfig,
  type ModelType,
} from '../constants/model-config';
import {
  getProfilePreferredModels,
  getPreferredModels,
  getSelectableModels,
  runtimeModelDiscovery,
  type RuntimeModelDiscoveryState,
} from '../utils/runtime-model-discovery';
import { LEGACY_DEFAULT_PROVIDER_PROFILE_ID } from '../utils/settings-manager';

interface ApiEnvelope<T> {
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
  request_id: string;
}

export interface PlatformImageModelSummary {
  capabilities?: {
    supportedRatios?: string[];
  };
  displayName: string;
  modelKey: string;
  price?: {
    amount: number;
    unit: 'per_image';
    version: number;
  };
  providerKey: string;
}

export interface PlatformSelectableModelsState {
  error: string | null;
  loading: boolean;
  models: ModelConfig[];
}

const PLATFORM_PROVIDER_PROFILE_PREFIX = 'platform:';

function normalizePlatformProviderKey(providerKey: string): string {
  return providerKey.trim() || 'platform';
}

function inferPlatformVendor(providerKey: string): ModelVendor {
  const normalized = providerKey.toLowerCase();
  if (normalized.includes('doubao') || normalized.includes('jimeng')) {
    return ModelVendor.DOUBAO;
  }
  if (normalized.includes('qwen')) {
    return ModelVendor.QWEN;
  }
  if (normalized.includes('hunyuan')) {
    return ModelVendor.HUNYUAN;
  }
  if (normalized.includes('step')) {
    return ModelVendor.STEPFUN;
  }
  if (normalized.includes('flux')) {
    return ModelVendor.FLUX;
  }
  return ModelVendor.OTHER;
}

function platformModelShortCode(modelKey: string, providerKey: string): string {
  const source = modelKey || providerKey || 'mt';
  return source
    .replace(/[^a-z0-9]+/gi, '-')
    .split('-')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 6)
    .toLowerCase() || 'mt';
}

export function mapPlatformImageModelToModelConfig(
  model: PlatformImageModelSummary
): ModelConfig {
  const providerKey = normalizePlatformProviderKey(model.providerKey);
  const supportedRatios = model.capabilities?.supportedRatios ?? ['1:1'];
  const priceText =
    typeof model.price?.amount === 'number'
      ? `平台价 ${model.price.amount} 点/张`
      : '平台模型';

  return {
    description: `${providerKey} · ${priceText}`,
    id: model.modelKey,
    imageDefaults: {
      aspectRatio: supportedRatios[0] ?? '1:1',
      height: 1024,
      width: 1024,
    },
    label: model.displayName || model.modelKey,
    selectionKey: `${PLATFORM_PROVIDER_PROFILE_PREFIX}${providerKey}::${model.modelKey}`,
    shortCode: platformModelShortCode(model.modelKey, providerKey),
    shortLabel: model.displayName || model.modelKey,
    sourceProfileId: `${PLATFORM_PROVIDER_PROFILE_PREFIX}${providerKey}`,
    sourceProfileName: `平台 ${providerKey}`,
    tags: ['platform-image-task'],
    type: 'image',
    vendor: inferPlatformVendor(providerKey),
  };
}

async function fetchPlatformImageModels(): Promise<ModelConfig[]> {
  const response = await fetch('/api/models', { credentials: 'include' });
  const envelope = (await response.json()) as ApiEnvelope<{
    models: PlatformImageModelSummary[];
  }>;

  if (!response.ok || envelope.error || !envelope.data) {
    throw new Error(envelope.error?.message ?? '平台模型列表加载失败');
  }

  return envelope.data.models.map(mapPlatformImageModelToModelConfig);
}

export function useRuntimeModelDiscoveryState(
  profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID
): RuntimeModelDiscoveryState {
  const [state, setState] = useState<RuntimeModelDiscoveryState>(() =>
    runtimeModelDiscovery.getState(profileId)
  );

  useEffect(() => {
    setState(runtimeModelDiscovery.getState(profileId));
    return runtimeModelDiscovery.subscribe(() => {
      setState(runtimeModelDiscovery.getState(profileId));
    });
  }, [profileId]);

  return state;
}

/**
 * 比较两个 ModelConfig 数组是否内容相同（按 id + selectionKey）
 */
function areModelListsEqual(a: ModelConfig[], b: ModelConfig[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].selectionKey !== b[i].selectionKey) return false;
  }
  return true;
}

export function usePreferredModels(modelType: ModelType): ModelConfig[] {
  const state = useRuntimeModelDiscoveryState();
  const prevRef = useRef<ModelConfig[]>([]);
  return useMemo(() => {
    const next = getPreferredModels(modelType);
    if (areModelListsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  }, [modelType, state]);
}

export function useSelectableModels(modelType: ModelType): ModelConfig[] {
  const state = useRuntimeModelDiscoveryState();
  const prevRef = useRef<ModelConfig[]>([]);
  return useMemo(() => {
    const next = getSelectableModels(modelType);
    if (areModelListsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  }, [modelType, state]);
}

export function usePlatformSelectableImageModels(
  enabled: boolean
): PlatformSelectableModelsState {
  const [state, setState] = useState<PlatformSelectableModelsState>({
    error: null,
    loading: enabled,
    models: [],
  });

  useEffect(() => {
    if (!enabled) {
      setState({ error: null, loading: false, models: [] });
      return;
    }

    let cancelled = false;
    setState((current) => ({
      error: null,
      loading: true,
      models: current.models,
    }));

    fetchPlatformImageModels()
      .then((models) => {
        if (!cancelled) {
          setState({ error: null, loading: false, models });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            error: error instanceof Error ? error.message : '平台模型列表加载失败',
            loading: false,
            models: [],
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

export function useProfilePreferredModels(
  profileId: string,
  modelType: ModelType
): ModelConfig[] {
  const state = useRuntimeModelDiscoveryState(profileId);
  const prevRef = useRef<ModelConfig[]>([]);
  return useMemo(() => {
    const next = getProfilePreferredModels(profileId, modelType);
    if (areModelListsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  }, [profileId, modelType, state]);
}
