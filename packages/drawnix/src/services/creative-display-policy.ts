import {
  DEFAULT_AUDIO_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_TEXT_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  type ModelConfig,
  type ModelType,
} from '../constants/model-config';
import { sortModelsByDisplayPriority } from '../utils/model-sort';
import { isCreativeEmbeddedMode } from './creative-mode';
import {
  getCreativePolicyDefaultModel,
  getCreativePolicyVisibleModels,
} from './creative-model-policy-resolver';

export const CREATIVE_MODEL_POLICY_FIELDS = [
  'defaultModel',
  'defaultModelId',
  'defaultVisible',
  'defaultVisibleModels',
  'defaultVisibleModelIds',
  'order',
  'group',
  'groups',
  'displayPolicy',
  'uiPolicy',
] as const;

const SERVER_POLICY_FIELD_SET = new Set<string>(
  CREATIVE_MODEL_POLICY_FIELDS.map((field) => field.toLowerCase())
);

const DEFAULT_VISIBLE_MODEL_IDS: Record<ModelType, string[]> = {
  text: [
    DEFAULT_TEXT_MODEL_ID,
    'deepseek-v3.2',
    'gemini-3.1-pro-preview',
    'claude-sonnet-4-6',
    'gpt-5.4',
    'grok-4.2',
  ],
  image: [
    DEFAULT_IMAGE_MODEL_ID,
    'gpt-image-2',
    'gemini-3.1-flash-image-preview',
    'doubao-seedream-4-0-250828',
  ],
  video: [DEFAULT_VIDEO_MODEL_ID, 'seedance-1.0-pro-fast', 'veo3', 'sora-2'],
  audio: [DEFAULT_AUDIO_MODEL_ID],
};

const DEFAULT_MODEL_ID_BY_TYPE: Record<ModelType, string> = {
  text: DEFAULT_TEXT_MODEL_ID,
  image: DEFAULT_IMAGE_MODEL_ID,
  video: DEFAULT_VIDEO_MODEL_ID,
  audio: DEFAULT_AUDIO_MODEL_ID,
};

function getModelKey(model: ModelConfig): string {
  return model.selectionKey || `${model.sourceProfileId || ''}::${model.id}`;
}

export function stripCreativeServerUiPolicy<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripCreativeServerUiPolicy(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, unknown>
  >((acc, [key, entry]) => {
    if (!SERVER_POLICY_FIELD_SET.has(key.toLowerCase())) {
      acc[key] = stripCreativeServerUiPolicy(entry);
    }
    return acc;
  }, {}) as T;
}

export function getCreativeDefaultVisibleModelIds(type: ModelType): string[] {
  return [...DEFAULT_VISIBLE_MODEL_IDS[type]];
}

export function getCreativeDefaultModel(
  type: ModelType,
  fullPool: ModelConfig[]
): ModelConfig | null {
  const typedPool = fullPool.filter((model) => model.type === type);
  if (typedPool.length === 0) {
    return null;
  }

  if (isCreativeEmbeddedMode()) {
    return getCreativePolicyDefaultModel(type, fullPool);
  }

  const preferredIds = [
    DEFAULT_MODEL_ID_BY_TYPE[type],
    ...DEFAULT_VISIBLE_MODEL_IDS[type],
  ];
  for (const modelId of preferredIds) {
    const match = typedPool.find((model) => model.id === modelId);
    if (match) {
      return match;
    }
  }

  return sortModelsByDisplayPriority(typedPool)[0] || typedPool[0] || null;
}

export function getCreativeDefaultVisibleModels(
  type: ModelType,
  fullPool: ModelConfig[]
): ModelConfig[] {
  const typedPool = fullPool.filter((model) => model.type === type);

  if (isCreativeEmbeddedMode()) {
    return getCreativePolicyVisibleModels(type, fullPool);
  }

  const byId = new Map(typedPool.map((model) => [model.id, model]));
  const visible = DEFAULT_VISIBLE_MODEL_IDS[type]
    .map((modelId) => byId.get(modelId))
    .filter(Boolean) as ModelConfig[];

  if (visible.length > 0) {
    return visible;
  }

  return sortModelsByDisplayPriority(typedPool).slice(0, 6);
}

export function getCreativeMoreModels(
  type: ModelType,
  fullPool: ModelConfig[]
): ModelConfig[] {
  const visibleKeys = new Set(
    getCreativeDefaultVisibleModels(type, fullPool).map(getModelKey)
  );
  return fullPool.filter(
    (model) => model.type === type && !visibleKeys.has(getModelKey(model))
  );
}
