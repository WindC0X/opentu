import { beforeEach, describe, expect, it } from 'vitest';
import { ModelVendor, type ModelConfig } from '../constants/model-config';
import {
  getCreativeModelPolicySnapshot,
  getCreativePolicyDefaultModel,
  getCreativePolicyDefaultModelForGenerationType,
  getCreativePolicyVisibleModels,
  resetCreativeModelPolicySnapshot,
  setCreativeModelPolicyFromBootstrap,
  setCreativeModelPolicySnapshot,
} from './creative-model-policy-resolver';

const pool: ModelConfig[] = [
  {
    id: 'text-available',
    label: 'Text Available',
    type: 'text',
    vendor: ModelVendor.OTHER,
    sourceProfileId: 'new-api-creative',
    selectionKey: 'new-api-creative::text-available',
  },
  {
    id: 'text-fallback',
    label: 'Text Fallback',
    type: 'text',
    vendor: ModelVendor.OTHER,
    sourceProfileId: 'new-api-creative',
    selectionKey: 'new-api-creative::text-fallback',
  },
  {
    id: 'image-available',
    label: 'Image Available',
    type: 'image',
    vendor: ModelVendor.GPT,
    sourceProfileId: 'new-api-creative',
    selectionKey: 'new-api-creative::image-available',
  },
];

describe('creative model policy resolver', () => {
  beforeEach(() => {
    resetCreativeModelPolicySnapshot();
  });

  it('orders defaults and recommendations only when they are present in the managed pool', () => {
    setCreativeModelPolicySnapshot(
      {
        version: 1,
        defaults: {
          text: 'static-only-text',
          image: 'image-available',
        },
        recommended: {
          text: ['text-fallback', 'static-only-text', 'text-available'],
          image: ['static-only-image'],
        },
      },
      'policy-version'
    );

    expect(getCreativeModelPolicySnapshot().version).toBe('policy-version');
    expect(getCreativePolicyDefaultModel('text', pool)?.id).toBe(
      'text-fallback'
    );
    expect(
      getCreativePolicyVisibleModels('text', pool).map((model) => model.id)
    ).toEqual(['text-fallback', 'text-available']);
    expect(getCreativePolicyDefaultModel('image', pool)?.id).toBe(
      'image-available'
    );
    expect(
      getCreativePolicyVisibleModels('image', pool).map((model) => model.id)
    ).toEqual(['image-available']);
  });

  it('maps agent policy to the text model pool without allowing static-only models', () => {
    setCreativeModelPolicySnapshot({
      version: 1,
      defaults: {
        agent: 'static-only-agent',
      },
      recommended: {
        agent: ['text-available'],
      },
    });

    expect(
      getCreativePolicyDefaultModelForGenerationType('agent', pool)?.id
    ).toBe('text-available');
  });

  it('ingests bootstrap data and strips unsafe fields before storing the policy snapshot', () => {
    setCreativeModelPolicyFromBootstrap({
      data: {
        modelPolicyVersion: 'safe-version',
        modelPolicy: {
          version: 1,
          defaults: {
            text: 'text-available',
          },
          apiKey: 'sk-should-not-survive',
          baseUrl: 'https://provider.example/v1',
          channelId: 123,
        },
      },
    });

    const snapshotText = JSON.stringify(getCreativeModelPolicySnapshot());
    expect(snapshotText).toContain('text-available');
    expect(snapshotText).not.toMatch(
      /sk-should-not-survive|provider\.example|channelId/i
    );
  });
});
