// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { CREATIVE_MANAGED_PROFILE_ID } from '../../../services/creative-mode';
import {
  readStoredModelSelection,
  writeStoredModelSelection,
} from './model-selection-storage';

describe('model-selection-storage', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    localStorage.clear();
  });

  it('writes profile-aware model selection and reads it back', () => {
    writeStoredModelSelection('workflow:model', 'veo3', {
      profileId: 'profile_a',
      modelId: 'veo3',
    });

    expect(readStoredModelSelection('workflow:model', 'fallback')).toEqual({
      modelId: 'veo3',
      modelRef: {
        profileId: 'profile_a',
        modelId: 'veo3',
      },
    });
  });

  it('falls back to legacy plain-string storage', () => {
    localStorage.setItem('workflow:model', 'legacy-model');

    expect(readStoredModelSelection('workflow:model', 'fallback')).toEqual({
      modelId: 'legacy-model',
      modelRef: null,
    });
  });

  it('does not use standalone fallback or legacy profile selections in embedded creative mode', () => {
    window.history.pushState({}, '', '/creative/');

    expect(readStoredModelSelection('workflow:missing', 'veo3')).toEqual({
      modelId: '',
      modelRef: null,
    });

    writeStoredModelSelection('workflow:model', 'veo3', {
      profileId: 'legacy-profile',
      modelId: 'veo3',
    });
    expect(readStoredModelSelection('workflow:model', 'fallback')).toEqual({
      modelId: '',
      modelRef: null,
    });

    writeStoredModelSelection('workflow:model', 'managed-video', {
      profileId: CREATIVE_MANAGED_PROFILE_ID,
      modelId: 'managed-video',
    });
    expect(readStoredModelSelection('workflow:model', 'fallback')).toEqual({
      modelId: 'managed-video',
      modelRef: {
        profileId: CREATIVE_MANAGED_PROFILE_ID,
        modelId: 'managed-video',
      },
    });
  });
});
