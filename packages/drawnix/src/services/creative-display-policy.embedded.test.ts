import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../constants/model-config';

vi.mock('./creative-mode', () => ({
  isCreativeEmbeddedMode: () => true,
}));

const fullPool: ModelConfig[] = [
  {
    id: 'newapi-image',
    label: 'New API Image',
    type: 'image',
    vendor: ModelVendor.GPT,
    sourceProfileId: 'new-api-creative',
    selectionKey: 'new-api-creative::newapi-image',
  },
  {
    id: 'newapi-image-2',
    label: 'New API Image 2',
    type: 'image',
    vendor: ModelVendor.GPT,
    sourceProfileId: 'new-api-creative',
    selectionKey: 'new-api-creative::newapi-image-2',
  },
];

describe('creative display policy in embedded mode', () => {
  beforeEach(async () => {
    const resolver = await import('./creative-model-policy-resolver');
    resolver.resetCreativeModelPolicySnapshot();
  });

  it('uses admin policy over OpenTU static defaults for embedded visible/default models', async () => {
    const resolver = await import('./creative-model-policy-resolver');
    const display = await import('./creative-display-policy');
    resolver.setCreativeModelPolicySnapshot({
      version: 1,
      defaults: {
        image: 'gpt-image-2-vip',
      },
      recommended: {
        image: ['newapi-image-2', 'gpt-image-2'],
      },
    });

    expect(display.getCreativeDefaultModel('image', fullPool)?.id).toBe(
      'newapi-image-2'
    );
    expect(
      display
        .getCreativeDefaultVisibleModels('image', fullPool)
        .map((model) => model.id)
    ).toEqual(['newapi-image-2', 'newapi-image']);
    expect(
      display.getCreativeMoreModels('image', fullPool).map((model) => model.id)
    ).toEqual([]);
  });
});
