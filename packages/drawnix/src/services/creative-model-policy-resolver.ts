import type { ModelConfig, ModelType } from '../constants/model-config';
import { sortModelsByDisplayPriority } from '../utils/model-sort';
import { removeSensitiveCloudFields } from './creative-cloud-sanitizer';

type CreativePolicyModality = ModelType | 'agent';

type CreativeModelPolicyRule = {
  defaults?: Partial<Record<CreativePolicyModality, string>>;
  recommended?: Partial<Record<CreativePolicyModality, string[]>>;
};

export type CreativeEffectiveModelPolicy = CreativeModelPolicyRule & {
  version: number;
  stale?: CreativeModelPolicyRule;
};

export type CreativeModelPolicySnapshot = {
  policy: CreativeEffectiveModelPolicy;
  version: string | null;
};

const EMPTY_POLICY: CreativeEffectiveModelPolicy = { version: 1 };
const POLICY_MODALITIES: CreativePolicyModality[] = [
  'text',
  'agent',
  'image',
  'video',
  'audio',
];
const POLICY_MODALITY_SET = new Set<string>(POLICY_MODALITIES);
const MODEL_TYPE_BY_MODALITY: Record<CreativePolicyModality, ModelType> = {
  text: 'text',
  agent: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
};

let currentPolicy: CreativeEffectiveModelPolicy = EMPTY_POLICY;
let currentPolicyVersion: string | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getBootstrapData(payload: unknown): unknown {
  const stripped = removeSensitiveCloudFields(payload);
  return isRecord(stripped) && isRecord(stripped.data)
    ? stripped.data
    : stripped;
}

function normalizeRule(value: unknown): CreativeModelPolicyRule | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rule: CreativeModelPolicyRule = {};
  if (isRecord(value.defaults)) {
    const defaults: CreativeModelPolicyRule['defaults'] = {};
    for (const modality of POLICY_MODALITIES) {
      const modelId = normalizeString(value.defaults[modality]);
      if (modelId) {
        defaults[modality] = modelId;
      }
    }
    if (Object.keys(defaults).length > 0) {
      rule.defaults = defaults;
    }
  }

  if (isRecord(value.recommended)) {
    const recommended: CreativeModelPolicyRule['recommended'] = {};
    for (const modality of POLICY_MODALITIES) {
      const raw = value.recommended[modality];
      if (!Array.isArray(raw)) {
        continue;
      }
      const seen = new Set<string>();
      const modelIds = raw
        .map((item) => normalizeString(item))
        .filter((modelId): modelId is string => {
          if (!modelId || seen.has(modelId)) {
            return false;
          }
          seen.add(modelId);
          return true;
        });
      if (modelIds.length > 0) {
        recommended[modality] = modelIds;
      }
    }
    if (Object.keys(recommended).length > 0) {
      rule.recommended = recommended;
    }
  }

  return rule.defaults || rule.recommended ? rule : undefined;
}

function normalizeEffectivePolicy(
  value: unknown
): CreativeEffectiveModelPolicy {
  if (!isRecord(value)) {
    return EMPTY_POLICY;
  }

  const version =
    typeof value.version === 'number' && Number.isFinite(value.version)
      ? value.version
      : 1;
  const rule = normalizeRule(value) ?? {};
  const stale = normalizeRule(value.stale);
  return {
    version,
    ...(rule.defaults ? { defaults: rule.defaults } : {}),
    ...(rule.recommended ? { recommended: rule.recommended } : {}),
    ...(stale ? { stale } : {}),
  };
}

function normalizePolicyVersion(value: unknown): string | null {
  return normalizeString(value);
}

export function setCreativeModelPolicySnapshot(
  policy: unknown,
  version?: unknown
): CreativeModelPolicySnapshot {
  currentPolicy = normalizeEffectivePolicy(policy);
  currentPolicyVersion = normalizePolicyVersion(version);
  return getCreativeModelPolicySnapshot();
}

export function setCreativeModelPolicyFromBootstrap(
  payload: unknown
): CreativeModelPolicySnapshot {
  const data = getBootstrapData(payload);
  if (!isRecord(data)) {
    return resetCreativeModelPolicySnapshot();
  }
  return setCreativeModelPolicySnapshot(
    data.modelPolicy,
    data.modelPolicyVersion
  );
}

export function resetCreativeModelPolicySnapshot(): CreativeModelPolicySnapshot {
  currentPolicy = EMPTY_POLICY;
  currentPolicyVersion = null;
  return getCreativeModelPolicySnapshot();
}

export function getCreativeModelPolicySnapshot(): CreativeModelPolicySnapshot {
  return {
    policy: {
      ...currentPolicy,
      defaults: currentPolicy.defaults
        ? { ...currentPolicy.defaults }
        : undefined,
      recommended: currentPolicy.recommended
        ? Object.fromEntries(
            Object.entries(currentPolicy.recommended).map(([key, models]) => [
              key,
              [...models],
            ])
          )
        : undefined,
      stale: currentPolicy.stale
        ? {
            defaults: currentPolicy.stale.defaults
              ? { ...currentPolicy.stale.defaults }
              : undefined,
            recommended: currentPolicy.stale.recommended
              ? Object.fromEntries(
                  Object.entries(currentPolicy.stale.recommended).map(
                    ([key, models]) => [key, [...models]]
                  )
                )
              : undefined,
          }
        : undefined,
    },
    version: currentPolicyVersion,
  };
}

function getModelKey(model: ModelConfig): string {
  return model.selectionKey || `${model.sourceProfileId || ''}::${model.id}`;
}

function uniqueModels(models: ModelConfig[]): ModelConfig[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const key = getModelKey(model);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function policyModelsForModality(
  modality: CreativePolicyModality,
  fullPool: ModelConfig[]
): ModelConfig[] {
  const modelType = MODEL_TYPE_BY_MODALITY[modality];
  const typedPool = fullPool.filter((model) => model.type === modelType);
  if (typedPool.length === 0) {
    return [];
  }

  const byId = new Map<string, ModelConfig[]>();
  typedPool.forEach((model) => {
    const models = byId.get(model.id) ?? [];
    models.push(model);
    byId.set(model.id, models);
  });

  const preferredIds = [
    currentPolicy.defaults?.[modality],
    ...(currentPolicy.recommended?.[modality] ?? []),
  ].filter(Boolean) as string[];

  const preferredModels = preferredIds.flatMap(
    (modelId) => byId.get(modelId) ?? []
  );
  const preferredKeys = new Set(preferredModels.map(getModelKey));
  const remaining = sortModelsByDisplayPriority(typedPool).filter(
    (model) => !preferredKeys.has(getModelKey(model))
  );
  return uniqueModels([...preferredModels, ...remaining]);
}

export function getCreativePolicyModels(
  type: ModelType,
  fullPool: ModelConfig[]
): ModelConfig[] {
  return policyModelsForModality(type, fullPool);
}

export function getCreativePolicyDefaultModel(
  type: ModelType,
  fullPool: ModelConfig[]
): ModelConfig | null {
  return getCreativePolicyModels(type, fullPool)[0] ?? null;
}

export function getCreativePolicyDefaultModelForGenerationType(
  generationType: CreativePolicyModality,
  fullPool: ModelConfig[]
): ModelConfig | null {
  if (!POLICY_MODALITY_SET.has(generationType)) {
    return null;
  }
  return policyModelsForModality(generationType, fullPool)[0] ?? null;
}

export function getCreativePolicyVisibleModels(
  type: ModelType,
  fullPool: ModelConfig[],
  limit = 6
): ModelConfig[] {
  return getCreativePolicyModels(type, fullPool).slice(0, limit);
}
