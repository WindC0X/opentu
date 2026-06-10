// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_MODEL_SELECTION_CACHE_KEY,
  AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY,
} from '../../constants/storage';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';

describe('ai-model-selection-storage', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('按类型写入并读取最近选择', async () => {
    const { getPersistedModelSelection, setPersistedModelSelection } =
      await import('../ai-model-selection-storage');

    setPersistedModelSelection('image', {
      modelId: 'gemini-image',
      modelRef: { profileId: 'provider-a', modelId: 'gemini-image' },
      providerIdHint: 'provider-a',
      vendorHint: ModelVendor.GEMINI,
    });
    setPersistedModelSelection('video', {
      modelId: 'veo3',
      modelRef: { profileId: 'provider-b', modelId: 'veo3' },
      providerIdHint: 'provider-b',
      vendorHint: ModelVendor.GOOGLE,
    });

    expect(getPersistedModelSelection('image')).toMatchObject({
      modelId: 'gemini-image',
      profileId: 'provider-a',
      providerIdHint: 'provider-a',
      vendorHint: 'GEMINI',
    });
    expect(getPersistedModelSelection('video')).toMatchObject({
      modelId: 'veo3',
      profileId: 'provider-b',
      providerIdHint: 'provider-b',
      vendorHint: 'GOOGLE',
    });

    setPersistedModelSelection('text', {
      modelId: 'deepseek-v3.2',
      modelRef: { profileId: 'provider-c', modelId: 'deepseek-v3.2' },
      providerIdHint: 'provider-c',
      vendorHint: ModelVendor.DEEPSEEK,
    });

    expect(getPersistedModelSelection('text')).toMatchObject({
      modelId: 'deepseek-v3.2',
      profileId: 'provider-c',
      providerIdHint: 'provider-c',
      vendorHint: 'DEEPSEEK',
    });
  });

  it('agent 选择应优先使用独立缓存，不与 text 混写', async () => {
    const { getPersistedModelSelection, setPersistedModelSelection } =
      await import('../ai-model-selection-storage');

    setPersistedModelSelection('text', {
      modelId: 'deepseek-v3.2',
      modelRef: { profileId: 'provider-text', modelId: 'deepseek-v3.2' },
      providerIdHint: 'provider-text',
      vendorHint: ModelVendor.DEEPSEEK,
    });
    setPersistedModelSelection('agent', {
      modelId: 'gemini-2.5-pro',
      modelRef: { profileId: 'provider-agent', modelId: 'gemini-2.5-pro' },
      providerIdHint: 'provider-agent',
      vendorHint: ModelVendor.GEMINI,
    });

    expect(getPersistedModelSelection('agent')).toMatchObject({
      modelId: 'gemini-2.5-pro',
      profileId: 'provider-agent',
      providerIdHint: 'provider-agent',
      vendorHint: 'GEMINI',
    });
    expect(getPersistedModelSelection('text')).toMatchObject({
      modelId: 'deepseek-v3.2',
      profileId: 'provider-text',
    });
  });

  it('清理损坏数据并返回空结果', async () => {
    localStorage.setItem(
      AI_MODEL_SELECTION_CACHE_KEY,
      '{"image":{"modelId":123},"video":"bad"}'
    );

    const { getPersistedModelSelection } = await import(
      '../ai-model-selection-storage'
    );

    expect(getPersistedModelSelection('image')).toBeNull();
    expect(getPersistedModelSelection('video')).toBeNull();
  });

  it('支持删除单个类型缓存', async () => {
    const {
      clearPersistedModelSelection,
      getPersistedModelSelection,
      setPersistedModelSelection,
    } = await import('../ai-model-selection-storage');

    setPersistedModelSelection('image', {
      modelId: 'flux',
      modelRef: { profileId: null, modelId: 'flux' },
      vendorHint: ModelVendor.OTHER,
    });
    setPersistedModelSelection('video', {
      modelId: 'kling-video',
      modelRef: { profileId: 'provider-k', modelId: 'kling-video' },
      vendorHint: ModelVendor.KLING,
    });

    clearPersistedModelSelection('image');

    expect(getPersistedModelSelection('image')).toBeNull();
    expect(getPersistedModelSelection('video')).toMatchObject({
      modelId: 'kling-video',
    });
  });

  it('将不可用的持久化模型切换到 fallback 时写入可读标记且不携带密钥字段', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456);
    const fallbackModel: ModelConfig = {
      id: 'gpt-image-2-vip',
      label: 'GPT Image 2 VIP',
      type: 'image',
      vendor: ModelVendor.GPT,
      sourceProfileId: 'new-api-creative',
      sourceProfileName: 'New API Creative',
      selectionKey: 'new-api-creative::gpt-image-2-vip',
    };
    localStorage.setItem(
      AI_MODEL_SELECTION_CACHE_KEY,
      JSON.stringify({
        image: {
          modelId: 'stale-image-model',
          profileId: 'remote-profile',
          providerIdHint: 'remote-provider',
          vendorHint: 'OTHER',
          updatedAt: 100,
          apiKey: 'sk-stale-secret-abcdefghijklmnopqrstuvwxyz',
          baseUrl: 'https://secret.example/v1',
          Authorization: 'Bearer stale-secret-token-abcdefghijklmnopqrstuvwxyz',
          providerOverride: 'secret-provider-override',
        },
      })
    );
    const markerSnapshots: unknown[] = [];
    const {
      getPersistedModelSelection,
      getUnavailableModelSelectionMarker,
      reconcilePersistedModelSelectionsWithAvailableModels,
      setPersistedModelSelection,
      subscribeUnavailableModelSelectionMarkerChange,
    } = await import('../ai-model-selection-storage');

    const unsubscribe = subscribeUnavailableModelSelectionMarkerChange(
      (markers) => markerSnapshots.push(markers)
    );

    const reconciled = reconcilePersistedModelSelectionsWithAvailableModels(
      [fallbackModel],
      { image: fallbackModel }
    );

    expect(reconciled.image).toMatchObject({
      modelId: 'gpt-image-2-vip',
      profileId: 'new-api-creative',
      providerIdHint: 'new-api-creative',
      vendorHint: 'GPT',
      updatedAt: 123456,
    });
    expect(getPersistedModelSelection('image')).toMatchObject({
      modelId: 'gpt-image-2-vip',
      profileId: 'new-api-creative',
    });
    expect(getUnavailableModelSelectionMarker('image')).toEqual({
      generationType: 'image',
      reason: 'unavailable-in-model-pool',
      updatedAt: 123456,
      original: {
        modelId: 'stale-image-model',
        profileId: 'remote-profile',
        providerIdHint: 'remote-provider',
        vendorHint: 'OTHER',
      },
      fallback: {
        modelId: 'gpt-image-2-vip',
        profileId: 'new-api-creative',
        providerIdHint: 'new-api-creative',
        vendorHint: 'GPT',
      },
    });
    expect(markerSnapshots).toHaveLength(1);
    expect(JSON.stringify(markerSnapshots[0])).toContain('stale-image-model');
    expect(
      localStorage.getItem(AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY) || ''
    ).not.toMatch(
      /sk-stale-secret|secret\.example|Authorization|Bearer|baseUrl|apiKey|providerOverride|secret-provider-override/i
    );

    setPersistedModelSelection('image', {
      modelId: 'gpt-image-2-vip',
      modelRef: { profileId: 'new-api-creative', modelId: 'gpt-image-2-vip' },
      providerIdHint: 'new-api-creative',
      vendorHint: ModelVendor.GPT,
    });

    expect(getUnavailableModelSelectionMarker('image')).toBeNull();
    unsubscribe();
  });

  it('删除没有 fallback 的不可用模型时保留可清理的不可用标记', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(987654);
    localStorage.setItem(
      AI_MODEL_SELECTION_CACHE_KEY,
      JSON.stringify({
        video: {
          modelId: 'vanished-video',
          profileId: 'remote-profile',
          providerIdHint: 'remote-profile',
          vendorHint: 'VEO',
          updatedAt: 200,
          auth: 'Bearer stale-secret-token-abcdefghijklmnopqrstuvwxyz',
          url: 'https://secret.example/v1',
        },
      })
    );
    const {
      clearUnavailableModelSelectionMarker,
      getPersistedModelSelection,
      getUnavailableModelSelectionMarker,
      reconcilePersistedModelSelectionsWithAvailableModels,
    } = await import('../ai-model-selection-storage');

    const reconciled = reconcilePersistedModelSelectionsWithAvailableModels([]);

    expect(reconciled.video).toBeUndefined();
    expect(getPersistedModelSelection('video')).toBeNull();
    expect(getUnavailableModelSelectionMarker('video')).toEqual({
      generationType: 'video',
      reason: 'unavailable-in-model-pool',
      updatedAt: 987654,
      original: {
        modelId: 'vanished-video',
        profileId: 'remote-profile',
        providerIdHint: 'remote-profile',
        vendorHint: 'VEO',
      },
      fallback: null,
    });
    expect(
      localStorage.getItem(AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY) || ''
    ).not.toMatch(/Bearer|secret\.example|auth|url/i);

    clearUnavailableModelSelectionMarker('video');

    expect(getUnavailableModelSelectionMarker('video')).toBeNull();
    expect(localStorage.getItem(AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY)).toBeNull();
  });
});
