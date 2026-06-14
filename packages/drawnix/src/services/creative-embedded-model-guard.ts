import type { ModelType } from '../constants/model-config';
import type { ModelRef } from '../utils/settings-manager';
import {
  CREATIVE_MANAGED_PROFILE_ID,
  isCreativeEmbeddedMode,
} from './creative-mode';
import {
  getPinnedSelectableModel,
  getSelectableModels,
} from '../utils/runtime-model-discovery';
import { getCreativePolicyDefaultModel } from './creative-model-policy-resolver';

export interface ResolvedCreativeEmbeddedModel {
  modelId: string;
  modelRef: ModelRef;
}

function createManagedModelRef(
  modelId: string,
  profileId?: string | null
): ModelRef {
  return {
    profileId: profileId || CREATIVE_MANAGED_PROFILE_ID,
    modelId,
  };
}

function getCreativeGenerationUnavailableMessage(type: ModelType): string {
  const article = type === 'audio' || type === 'image' ? 'an' : 'a';
  return `Creative ${type} model is unavailable; refresh the page or ask an administrator to enable ${article} ${type} model in New API.`;
}

export function resolveCreativeEmbeddedModelForGeneration(
  type: ModelType,
  requestedModel?: string | null,
  requestedModelRef?: ModelRef | null
): ResolvedCreativeEmbeddedModel | null {
  if (!isCreativeEmbeddedMode()) {
    return null;
  }

  const requestedModelId =
    requestedModelRef?.modelId?.trim() || requestedModel?.trim() || '';

  if (requestedModelId) {
    const pinned = getPinnedSelectableModel(
      type,
      requestedModelId,
      requestedModelRef || null
    );
    if (!pinned) {
      throw new Error(getCreativeGenerationUnavailableMessage(type));
    }
    return {
      modelId: pinned.id,
      modelRef: createManagedModelRef(pinned.id, pinned.sourceProfileId),
    };
  }

  const selectableModels = getSelectableModels(type);
  const defaultModel =
    getCreativePolicyDefaultModel(type, selectableModels) ||
    selectableModels[0] ||
    null;
  if (!defaultModel) {
    throw new Error(getCreativeGenerationUnavailableMessage(type));
  }

  return {
    modelId: defaultModel.id,
    modelRef: createManagedModelRef(
      defaultModel.id,
      defaultModel.sourceProfileId
    ),
  };
}
