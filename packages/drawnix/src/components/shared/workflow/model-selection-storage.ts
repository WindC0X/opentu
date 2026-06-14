import type { ModelRef } from '../../../utils/settings-manager';
import {
  CREATIVE_MANAGED_PROFILE_ID,
  isCreativeEmbeddedMode,
} from '../../../services/creative-mode';

export interface StoredModelSelection {
  modelId: string;
  modelRef: ModelRef | null;
}

export function readStoredModelSelection(
  key: string,
  fallbackModel: string,
  fallbackModelRef: ModelRef | null = null
): StoredModelSelection {
  const embeddedCreative = isCreativeEmbeddedMode();
  const safeFallbackModel = embeddedCreative ? '' : fallbackModel;
  const safeFallbackModelRef = embeddedCreative ? null : fallbackModelRef;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return { modelId: safeFallbackModel, modelRef: safeFallbackModelRef };
    }

    const parsed = JSON.parse(raw) as {
      modelId?: string;
      profileId?: string | null;
    };

    if (typeof parsed.modelId === 'string' && parsed.modelId.trim()) {
      const modelId = parsed.modelId.trim();
      if (
        embeddedCreative &&
        parsed.profileId !== CREATIVE_MANAGED_PROFILE_ID
      ) {
        return { modelId: safeFallbackModel, modelRef: safeFallbackModelRef };
      }
      return {
        modelId,
        modelRef: {
          profileId: parsed.profileId || null,
          modelId,
        },
      };
    }
  } catch {
    // 兼容旧格式：直接存储 modelId 字符串
  }

  let legacyModelId: string | null = null;
  try {
    legacyModelId = localStorage.getItem(key);
  } catch {
    // localStorage 不可用时静默降级
  }

  if (embeddedCreative) {
    return { modelId: safeFallbackModel, modelRef: safeFallbackModelRef };
  }

  return {
    modelId: legacyModelId || safeFallbackModel,
    modelRef: legacyModelId ? null : safeFallbackModelRef,
  };
}

export function writeStoredModelSelection(
  key: string,
  modelId: string,
  modelRef?: ModelRef | null
): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        modelId,
        profileId: modelRef?.profileId || null,
      })
    );
  } catch {
    // localStorage 不可用时静默降级
  }
}
