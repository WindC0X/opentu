import {
  buildCreativeUserParams,
  getCompatibleParams,
  hasRuntimeParameterSchema,
  type CreativeUserParams,
  type ModelConfig,
  type ParamConfig,
} from '../../constants/model-config';
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  convertAspectRatioToSize,
} from '../../constants/image-aspect-ratios';

type ModelIdOrConfig = string | ModelConfig;

const KNOWN_ASPECT_RATIOS = new Set(
  ASPECT_RATIO_OPTIONS.map((option) => option.value)
);

function normalizeAspectRatioValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed === DEFAULT_ASPECT_RATIO) {
    return DEFAULT_ASPECT_RATIO;
  }

  const normalized = trimmed.replace(/[xX]/g, ':');
  return KNOWN_ASPECT_RATIOS.has(normalized) ? normalized : undefined;
}

function optionSupportsAspectRatio(
  param: ParamConfig | undefined,
  aspectRatio: string
): boolean {
  if (!param) {
    return false;
  }
  if (!param.options || param.options.length === 0) {
    return param.valueType !== 'enum';
  }
  return param.options.some((option) => option.value === aspectRatio);
}

function getAspectRatioParam(
  modelIdOrConfig: ModelIdOrConfig
): ParamConfig | undefined {
  return getCompatibleParams(modelIdOrConfig).find(
    (param) => param.id === 'aspectRatio'
  );
}

function getSizeParam(modelIdOrConfig: ModelIdOrConfig): ParamConfig | undefined {
  return getCompatibleParams(modelIdOrConfig).find((param) => param.id === 'size');
}

function getAspectRatioFromSizeParam(size?: string): string | undefined {
  if (!size) return undefined;
  if (size === 'auto') return DEFAULT_ASPECT_RATIO;
  return normalizeAspectRatioValue(size);
}

export interface CreativeImageRuntimeTaskParams {
  schemaBacked: boolean;
  taskParams: {
    userParams?: CreativeUserParams;
    creativeManaged?: true;
  };
}

export function normalizeCreativeImageEditableUserParams(
  value: unknown
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, string>
  >((acc, [key, item]) => {
    if (typeof item === 'string') {
      acc[key] = item;
    } else if (typeof item === 'number' || typeof item === 'boolean') {
      acc[key] = String(item);
    }
    return acc;
  }, {});
}

export function mergeCreativeImageEditableTaskParams(taskParams: {
  params?: Record<string, unknown>;
  userParams?: unknown;
  size?: unknown;
  resolution?: unknown;
  quality?: unknown;
}): Record<string, string> {
  const legacyParams = normalizeCreativeImageEditableUserParams(
    taskParams.params || {}
  );
  const topLevelParams = normalizeCreativeImageEditableUserParams({
    ...(taskParams.size !== undefined ? { size: taskParams.size } : {}),
    ...(taskParams.resolution !== undefined
      ? { resolution: taskParams.resolution }
      : {}),
    ...(taskParams.quality !== undefined ? { quality: taskParams.quality } : {}),
  });
  const userParams = normalizeCreativeImageEditableUserParams(
    taskParams.userParams
  );

  return {
    ...legacyParams,
    ...topLevelParams,
    ...userParams,
  };
}

export function buildCreativeImageRuntimeTaskParams(
  modelIdOrConfig: ModelIdOrConfig,
  selectedParams?: Record<string, string>
): CreativeImageRuntimeTaskParams {
  if (!hasRuntimeParameterSchema(modelIdOrConfig)) {
    return { schemaBacked: false, taskParams: {} };
  }

  return {
    schemaBacked: true,
    taskParams: {
      userParams:
        buildCreativeUserParams(modelIdOrConfig, selectedParams) || {},
      creativeManaged: true,
    },
  };
}

export function getCreativeImageAspectRatioFromParams(
  modelIdOrConfig: ModelIdOrConfig,
  params: Record<string, string>,
  fallbackAspectRatio?: string
): string {
  const aspectRatioParam = getAspectRatioParam(modelIdOrConfig);
  const explicitAspectRatio = normalizeAspectRatioValue(
    aspectRatioParam ? params[aspectRatioParam.id] : params.aspectRatio
  );
  if (
    explicitAspectRatio &&
    (!aspectRatioParam ||
      optionSupportsAspectRatio(aspectRatioParam, explicitAspectRatio))
  ) {
    return explicitAspectRatio;
  }

  return (
    getAspectRatioFromSizeParam(params.size) ||
    normalizeAspectRatioValue(fallbackAspectRatio) ||
    DEFAULT_ASPECT_RATIO
  );
}

export function applyCreativeImageAspectRatioToParams(
  modelIdOrConfig: ModelIdOrConfig,
  params: Record<string, string>,
  nextAspectRatio?: string
): Record<string, string> {
  const modelId =
    typeof modelIdOrConfig === 'string' ? modelIdOrConfig : modelIdOrConfig.id;
  const normalizedAspectRatio = normalizeAspectRatioValue(nextAspectRatio);
  if (modelId.startsWith('mj') || !normalizedAspectRatio) {
    return params;
  }

  const aspectRatioParam = getAspectRatioParam(modelIdOrConfig);
  if (optionSupportsAspectRatio(aspectRatioParam, normalizedAspectRatio)) {
    return params[aspectRatioParam!.id] === normalizedAspectRatio
      ? params
      : { ...params, [aspectRatioParam!.id]: normalizedAspectRatio };
  }

  const nextSize =
    normalizedAspectRatio === DEFAULT_ASPECT_RATIO
      ? 'auto'
      : convertAspectRatioToSize(normalizedAspectRatio);
  const sizeParam = getSizeParam(modelIdOrConfig);
  if (
    !nextSize ||
    !sizeParam?.options?.some((option) => option.value === nextSize)
  ) {
    return params;
  }

  return params.size === nextSize ? params : { ...params, size: nextSize };
}
