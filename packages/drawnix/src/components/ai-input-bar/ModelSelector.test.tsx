// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import { CREATIVE_MANAGED_PROFILE_ID } from '../../services/creative-mode';
import {
  getCreativeDefaultVisibleModels,
  getCreativeMoreModels,
  stripCreativeServerUiPolicy,
} from '../../services/creative-display-policy';
import { ModelSelector } from './ModelSelector';

vi.mock('tdesign-react', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../hooks/use-provider-profiles', () => ({
  useProviderProfiles: () => [
    {
      id: CREATIVE_MANAGED_PROFILE_ID,
      name: 'New API Creative',
      enabled: true,
    },
  ],
}));

vi.mock('../shared/ModelHealthBadge', () => ({
  ModelHealthBadge: () => null,
}));

describe('ModelSelector', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('keeps creative default-visible policy local while searched More Models remain selectable', () => {
    const sanitizedPayload = stripCreativeServerUiPolicy({
      defaultVisible: ['server-image-default'],
      displayPolicy: { defaultVisibleModels: ['server-image-default'] },
      data: [
        {
          id: 'server-image-default',
          label: 'Server Image Default',
          shortLabel: 'Server Image',
          type: 'image',
          vendor: ModelVendor.OTHER,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::server-image-default`,
          defaultVisible: true,
        },
        {
          id: 'gpt-image-2-vip',
          label: 'GPT Image 2 VIP',
          shortLabel: 'GPT Image VIP',
          type: 'image',
          vendor: ModelVendor.GPT,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::gpt-image-2-vip`,
        },
        {
          id: 'gpt-image-2',
          label: 'GPT Image 2',
          shortLabel: 'GPT Image',
          type: 'image',
          vendor: ModelVendor.GPT,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::gpt-image-2`,
        },
        {
          id: 'image-extra-long-tail',
          label: 'Image Extra Long Tail',
          shortLabel: 'Image Extra',
          type: 'image',
          vendor: ModelVendor.OTHER,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::image-extra-long-tail`,
        },
        {
          id: 'seedance-1.0-pro-fast',
          label: 'Seedance 1.0 Pro Fast',
          shortLabel: 'Seedance Fast',
          type: 'video',
          vendor: ModelVendor.DOUBAO,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::seedance-1.0-pro-fast`,
        },
      ],
    }) as { data: ModelConfig[] };
    const fullPool = sanitizedPayload.data;
    const onSelect = vi.fn();

    expect(JSON.stringify(sanitizedPayload)).not.toMatch(
      /defaultVisible|displayPolicy/i
    );
    expect(getCreativeDefaultVisibleModels('image', fullPool).map((model) => model.id)).toEqual([
      'gpt-image-2-vip',
      'gpt-image-2',
    ]);
    expect(getCreativeMoreModels('image', fullPool).map((model) => model.id)).toEqual(
      expect.arrayContaining(['server-image-default', 'image-extra-long-tail'])
    );

    const { rerender } = render(
      <ModelSelector
        visible
        filterKeyword=""
        selectedImageModel="gpt-image-2-vip"
        selectedVideoModel={undefined}
        models={fullPool}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('listbox').textContent).toContain('Seedance Fast');
    expect(screen.getByRole('listbox').textContent).not.toContain(
      'Image Extra'
    );

    rerender(
      <ModelSelector
        visible
        filterKeyword="image-extra"
        selectedImageModel={undefined}
        selectedVideoModel={undefined}
        models={fullPool}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    const moreModelOption = screen.getByText('Image Extra').closest(
      '.ai-model-selector__item'
    ) as HTMLElement;
    expect(moreModelOption?.textContent).toContain('#image-extra-long-tail');

    fireEvent.click(moreModelOption);

    expect(onSelect).toHaveBeenCalledWith('image-extra-long-tail');
  });
});
