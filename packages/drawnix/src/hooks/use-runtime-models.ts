import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ModelVendor,
  type ModelConfig,
  type ParamConfig,
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
    maxBatchSize?: 1 | 2 | 4;
    maxReferenceImages?: number;
    operationType?: PlatformImageOperationType;
    operationTypes?: PlatformImageOperationType[];
    qualityOptions?: PlatformImageQuality[];
    resolutionOptions?: PlatformImageResolution[];
    supportedSizes?: string[];
    supportedRatios?: string[];
    supportsBatch?: boolean;
    supportsMask?: boolean;
    defaultParams?: {
      quality?: PlatformImageQuality;
      ratio?: string;
      resolution?: PlatformImageResolution;
      size?: string;
    };
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

export type PlatformImageOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'inpaint'
  | 'reference_generate'
  | 'prompt_optimize';
export type PlatformImageResolution = '1k' | '2k' | '4k';
export type PlatformImageQuality = 'auto' | 'low' | 'medium' | 'high';

export interface PlatformImageModelCapabilities {
  defaultParams: {
    quality?: PlatformImageQuality;
    ratio: string;
    resolution?: PlatformImageResolution;
    size?: string;
  };
  maxBatchSize: 1 | 2 | 4;
  maxReferenceImages: number;
  operationTypes: PlatformImageOperationType[];
  qualityOptions: PlatformImageQuality[];
  resolutionOptions: PlatformImageResolution[];
  supportedSizes: string[];
  supportedRatios: string[];
  supportsBatch: boolean;
  supportsMask: boolean;
}

export interface PlatformModelConfig extends ModelConfig {
  platformCapabilities: PlatformImageModelCapabilities;
  platformProviderKey: string;
  platformPriceText: string;
}

export interface PlatformSelectableModelsState {
  error: string | null;
  loading: boolean;
  models: ModelConfig[];
}

const PLATFORM_PROVIDER_PROFILE_PREFIX = 'platform:';
const DEFAULT_PLATFORM_OPERATION_TYPES: PlatformImageOperationType[] = [
  'text_to_image',
];
const PLATFORM_RESOLUTION_LABELS: Record<PlatformImageResolution, string> = {
  '1k': '1K',
  '2k': '2K',
  '4k': '4K',
};
const PLATFORM_QUALITY_LABELS: Record<PlatformImageQuality, string> = {
  auto: '自动',
  high: '高清',
  low: '省点',
  medium: '标准',
};
const PLATFORM_PARAM_DISABLED_REASONS = {
  quality: '当前模型暂未声明画质档位',
  resolution: '当前模型暂未声明分辨率档位',
} as const;

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

function normalizePlatformBatchSize(value?: number): 1 | 2 | 4 {
  if (value === 4) {
    return 4;
  }
  if (value === 2) {
    return 2;
  }
  return 1;
}

function normalizePlatformOperationTypes(
  model: PlatformImageModelSummary
): PlatformImageOperationType[] {
  const operationTypes = model.capabilities?.operationTypes?.length
    ? model.capabilities.operationTypes
    : model.capabilities?.operationType
    ? [model.capabilities.operationType]
    : DEFAULT_PLATFORM_OPERATION_TYPES;
  return Array.from(new Set(operationTypes));
}

export function getPlatformCapabilitiesFromModel(
  model: PlatformImageModelSummary | PlatformModelConfig
): PlatformImageModelCapabilities {
  if ('platformCapabilities' in model) {
    return model.platformCapabilities;
  }
  const supportedRatios = model.capabilities?.supportedRatios?.length
    ? model.capabilities.supportedRatios
    : ['1:1'];
  return {
    defaultParams: {
      quality: model.capabilities?.defaultParams?.quality,
      ratio: model.capabilities?.defaultParams?.ratio ?? supportedRatios[0] ?? '1:1',
      resolution: model.capabilities?.defaultParams?.resolution,
      size: model.capabilities?.defaultParams?.size,
    },
    maxBatchSize: normalizePlatformBatchSize(model.capabilities?.maxBatchSize),
    maxReferenceImages: Math.max(0, model.capabilities?.maxReferenceImages ?? 0),
    operationTypes: normalizePlatformOperationTypes(model),
    qualityOptions: model.capabilities?.qualityOptions ?? [],
    resolutionOptions: model.capabilities?.resolutionOptions ?? [],
    supportedRatios,
    supportedSizes: model.capabilities?.supportedSizes ?? [],
    supportsBatch: Boolean(model.capabilities?.supportsBatch),
    supportsMask: Boolean(model.capabilities?.supportsMask),
  };
}

export function getPlatformModelConfigCapabilities(
  model?: ModelConfig | null
): PlatformImageModelCapabilities | null {
  if (!model || !('platformCapabilities' in model)) {
    return null;
  }
  return (model as PlatformModelConfig).platformCapabilities;
}

export function getPlatformRatioParamConfig(
  model?: ModelConfig | null
): ParamConfig | null {
  const capabilities = getPlatformModelConfigCapabilities(model);
  if (!model || !capabilities) {
    return null;
  }
  const ratios = capabilities.supportedRatios.length
    ? capabilities.supportedRatios
    : ['1:1'];
  return {
    compatibleModels: [model.id],
    defaultValue: ratios[0] ?? '1:1',
    description: '平台模型支持的图片比例；提交前会按该比例报价。',
    id: 'size',
    label: '比例',
    modelType: 'image',
    options: ratios.map((ratio) => ({ label: ratio, value: ratio })),
    shortLabel: '比例',
    valueType: 'enum',
  };
}

export function getPlatformCompatibleParams(
  model?: ModelConfig | null
): ParamConfig[] {
  const capabilities = getPlatformModelConfigCapabilities(model);
  if (!model || !capabilities) {
    return [];
  }

  const supportedRatios = capabilities.supportedRatios.length
    ? capabilities.supportedRatios
    : ['1:1'];
  const params: ParamConfig[] = [];

  params.push({
    compatibleModels: [model.id],
    defaultValue: normalizePlatformRatioOptionValue(
      capabilities.defaultParams.ratio || supportedRatios[0] || '1:1'
    ),
    description: '平台模型支持的图片比例；提交前会按该比例报价。',
    id: 'size',
    label: '比例',
    modelType: 'image',
    options: supportedRatios.map((ratio) => ({
      label: ratio,
      value: normalizePlatformRatioOptionValue(ratio),
    })),
    shortLabel: '比例',
    valueType: 'enum',
  });

  params.push(buildPlatformResolutionParam(model, capabilities));
  params.push(buildPlatformQualityParam(model, capabilities));

  return params;
}

function normalizePlatformRatioOptionValue(ratio: string): string {
  return ratio.replace(':', 'x');
}

function buildPlatformResolutionParam(
  model: ModelConfig,
  capabilities: PlatformImageModelCapabilities
): ParamConfig {
  const options = capabilities.resolutionOptions.map((resolution) => ({
    label: PLATFORM_RESOLUTION_LABELS[resolution],
    value: resolution,
  }));
  if (options.length === 0) {
    return {
      compatibleModels: [model.id],
      defaultValue: 'default',
      description: PLATFORM_PARAM_DISABLED_REASONS.resolution,
      disabledReason: PLATFORM_PARAM_DISABLED_REASONS.resolution,
      id: 'resolution',
      label: '分辨率',
      modelType: 'image',
      options: [{ label: '随模型默认', value: 'default' }],
      shortLabel: '分辨率',
      valueType: 'enum',
    };
  }
  return {
    compatibleModels: [model.id],
    defaultValue: capabilities.defaultParams.resolution ?? options[0]?.value,
    description: '平台模型声明的输出分辨率。',
    id: 'resolution',
    label: '分辨率',
    modelType: 'image',
    options,
    shortLabel: '分辨率',
    valueType: 'enum',
  };
}

function buildPlatformQualityParam(
  model: ModelConfig,
  capabilities: PlatformImageModelCapabilities
): ParamConfig {
  const options = capabilities.qualityOptions.map((quality) => ({
    label: PLATFORM_QUALITY_LABELS[quality],
    value: quality,
  }));
  if (options.length === 0) {
    return {
      compatibleModels: [model.id],
      defaultValue: 'default',
      description: PLATFORM_PARAM_DISABLED_REASONS.quality,
      disabledReason: PLATFORM_PARAM_DISABLED_REASONS.quality,
      id: 'quality',
      label: '画质',
      modelType: 'image',
      options: [{ label: '随模型默认', value: 'default' }],
      shortLabel: '画质',
      valueType: 'enum',
    };
  }
  return {
    compatibleModels: [model.id],
    defaultValue: capabilities.defaultParams.quality ?? options[0]?.value,
    description: '平台模型声明的画质档位。',
    id: 'quality',
    label: '画质',
    modelType: 'image',
    options,
    shortLabel: '画质',
    valueType: 'enum',
  };
}

function formatPlatformOperationLabel(operationType: PlatformImageOperationType) {
  switch (operationType) {
    case 'text_to_image':
      return '文生图';
    case 'image_to_image':
      return '图生图';
    case 'inpaint':
      return '局部重绘';
    case 'reference_generate':
      return '参考图生成';
    case 'prompt_optimize':
      return '提示词优化';
  }
}

function formatCapabilitySummary(capabilities: PlatformImageModelCapabilities) {
  const operations = capabilities.operationTypes
    .map(formatPlatformOperationLabel)
    .join(' / ');
  const refs =
    capabilities.maxReferenceImages > 0
      ? `参考图≤${capabilities.maxReferenceImages}`
      : '无参考图';
  const batch = capabilities.supportsBatch
    ? `批量≤${capabilities.maxBatchSize}`
    : '单张';
  const resolution = capabilities.resolutionOptions.length
    ? `分辨率 ${capabilities.resolutionOptions
        .map((option) => PLATFORM_RESOLUTION_LABELS[option])
        .join('/')}`
    : '默认分辨率';
  const quality = capabilities.qualityOptions.length
    ? `画质 ${capabilities.qualityOptions
        .map((option) => PLATFORM_QUALITY_LABELS[option])
        .join('/')}`
    : '默认画质';
  return `${operations || '能力未知'} · ${capabilities.supportedRatios.join(
    '/'
  )} · ${resolution} · ${quality} · ${refs} · ${batch}`;
}

export function mapPlatformImageModelToModelConfig(
  model: PlatformImageModelSummary
): PlatformModelConfig {
  const providerKey = normalizePlatformProviderKey(model.providerKey);
  const capabilities = getPlatformCapabilitiesFromModel(model);
  const priceText =
    typeof model.price?.amount === 'number'
      ? `平台价 ${model.price.amount} 点/张`
      : '平台模型';

  return {
    description: `${priceText} · ${formatCapabilitySummary(
      capabilities
    )}`,
    id: model.modelKey,
    imageDefaults: {
      aspectRatio: capabilities.supportedRatios[0] ?? '1:1',
      height: 1024,
      width: 1024,
    },
    label: model.displayName || model.modelKey,
    platformCapabilities: capabilities,
    platformPriceText: priceText,
    platformProviderKey: providerKey,
    selectionKey: `${PLATFORM_PROVIDER_PROFILE_PREFIX}${providerKey}::${model.modelKey}`,
    shortCode: platformModelShortCode(model.modelKey, providerKey),
    shortLabel: model.displayName || model.modelKey,
    sourceProfileId: `${PLATFORM_PROVIDER_PROFILE_PREFIX}${providerKey}`,
    sourceProfileName: '梦图平台',
    tags: [
      'platform-image-task',
      ...capabilities.operationTypes.map(
        (operationType) => `platform-op:${operationType}`
      ),
    ],
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
