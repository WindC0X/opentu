import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelConfig, ModelType } from '../constants/model-config';
import {
  getProfilePreferredModels,
  getPreferredModels,
  getSelectableModels,
  runtimeModelDiscovery,
  type RuntimeModelDiscoveryState,
} from '../utils/runtime-model-discovery';
import { LEGACY_DEFAULT_PROVIDER_PROFILE_ID } from '../utils/settings-manager';
import {
  CREATIVE_MANAGED_CATALOG_UPDATED_EVENT,
  CREATIVE_MANAGED_PROFILE_ID,
  isCreativeEmbeddedMode,
} from '../services/creative-mode';

export function useRuntimeModelDiscoveryState(
  profileId = LEGACY_DEFAULT_PROVIDER_PROFILE_ID
): RuntimeModelDiscoveryState {
  const [state, setState] = useState<RuntimeModelDiscoveryState>(() =>
    runtimeModelDiscovery.getState(profileId)
  );

  useEffect(() => {
    const refresh = () => {
      runtimeModelDiscovery.refreshFromSettings({
        reloadFromStorage: isCreativeEmbeddedMode(),
      });
      setState(runtimeModelDiscovery.getState(profileId));
    };
    const unsubscribe = runtimeModelDiscovery.subscribe(() => {
      setState(runtimeModelDiscovery.getState(profileId));
    });
    // Creative's startup/session broker and deferred UI can live in different
    // build chunks with separate in-memory module instances. Rehydrate from
    // localStorage both on mount and when the broker announces that the managed
    // catalog was persisted, so selectors do not stay on an empty discovery
    // store after a successful /creative/api/models bootstrap.
    refresh();
    window.addEventListener(CREATIVE_MANAGED_CATALOG_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(CREATIVE_MANAGED_CATALOG_UPDATED_EVENT, refresh);
      unsubscribe();
    };
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
  const state = useRuntimeModelDiscoveryState(
    isCreativeEmbeddedMode()
      ? CREATIVE_MANAGED_PROFILE_ID
      : LEGACY_DEFAULT_PROVIDER_PROFILE_ID
  );
  const prevRef = useRef<ModelConfig[]>([]);
  return useMemo(() => {
    const next = getPreferredModels(modelType);
    if (areModelListsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  }, [modelType, state]);
}

export function useSelectableModels(modelType: ModelType): ModelConfig[] {
  const state = useRuntimeModelDiscoveryState(
    isCreativeEmbeddedMode()
      ? CREATIVE_MANAGED_PROFILE_ID
      : LEGACY_DEFAULT_PROVIDER_PROFILE_ID
  );
  const prevRef = useRef<ModelConfig[]>([]);
  return useMemo(() => {
    const next = getSelectableModels(modelType);
    if (areModelListsEqual(prevRef.current, next)) return prevRef.current;
    prevRef.current = next;
    return next;
  }, [modelType, state]);
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
