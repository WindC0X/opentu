import { describe, expect, it } from 'vitest';
import { ModelVendor, type ModelConfig } from '../constants/model-config';
import {
  CREATIVE_MODEL_POLICY_FIELDS,
  getCreativeDefaultModel,
  getCreativeDefaultVisibleModels,
  getCreativeMoreModels,
  stripCreativeServerUiPolicy,
} from './creative-display-policy';

const textModels: ModelConfig[] = [
  { id: 'provider-a-only', label: 'Provider A', type: 'text', vendor: ModelVendor.OTHER },
  { id: 'gpt-5.5', label: 'GPT 5.5', type: 'text', vendor: ModelVendor.GPT },
  { id: 'deepseek-v3.2', label: 'DeepSeek', type: 'text', vendor: ModelVendor.DEEPSEEK },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini', type: 'text', vendor: ModelVendor.GEMINI },
  { id: 'extra-model', label: 'Extra', type: 'text', vendor: ModelVendor.OTHER },
];

describe('creative display policy', () => {
  it('keeps display/default/more-model policy owned by opentu', () => {
    const sanitized = stripCreativeServerUiPolicy({
      data: textModels,
      defaultModel: 'server-choice',
      defaultVisibleModels: ['server-choice'],
      order: ['server-choice'],
      group: 'server-group',
      nested: { defaultModel: 'nested-choice', value: 1 },
    });

    for (const field of CREATIVE_MODEL_POLICY_FIELDS) {
      expect(JSON.stringify(sanitized)).not.toContain(field);
    }
    expect(sanitized).toMatchObject({
      data: textModels,
      nested: { value: 1 },
    });
  });

  it('selects local default and visible subset from the full discovered pool', () => {
    expect(getCreativeDefaultModel('text', textModels)?.id).toBe('gpt-5.5');
    expect(getCreativeDefaultVisibleModels('text', textModels).map((m) => m.id)).toEqual([
      'gpt-5.5',
      'deepseek-v3.2',
      'gemini-3.1-pro-preview',
    ]);
    expect(getCreativeMoreModels('text', textModels).map((m) => m.id)).toEqual([
      'provider-a-only',
      'extra-model',
    ]);
  });

  it('falls back to first available model when local default is unavailable', () => {
    expect(getCreativeDefaultModel('text', [textModels[0]])?.id).toBe('provider-a-only');
  });
});
