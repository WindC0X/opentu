// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import { CREATIVE_MANAGED_PROFILE_ID } from '../../services/creative-mode';
import {
  getCreativeDefaultModel,
  getCreativeDefaultVisibleModels,
  getCreativeMoreModels,
  stripCreativeServerUiPolicy,
} from '../../services/creative-display-policy';
import { ModelDropdown } from './ModelDropdown';

vi.mock('tdesign-react', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  MessagePlugin: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../hooks/use-drawnix', () => ({
  useDrawnix: () => ({ setAppState: vi.fn() }),
}));

vi.mock('../../hooks/use-provider-profiles', () => ({
  useProviderProfiles: () => [
    {
      id: 'tuzi-provider',
      name: 'Tuzi Provider',
      enabled: true,
    },
  ],
}));

vi.mock('../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  TUZI_ORIGINAL_PROVIDER_PROFILE_ID: 'tuzi-original',
  TUZI_DEFAULT_PROVIDER_NAME: 'Tuzi',
  TUZI_PROVIDER_ICON_URL: 'https://tuzi.example/icon.png',
  createModelRef: (profileId: string | null, modelId: string) => ({
    profileId,
    modelId,
  }),
}));

vi.mock('../../hooks/use-model-pricing', () => ({
  useFormattedModelPrice: () => '',
  useModelPriceText: () => ({ summary: '', detail: '' }),
  useModelMeta: () => null,
}));

vi.mock('../../utils/model-pricing-service', () => ({
  modelPricingService: {
    getModelPrice: vi.fn(() => null),
  },
}));

vi.mock('../shared/ModelHealthBadge', () => ({
  ModelHealthBadge: () => null,
}));

vi.mock('../shared/ModelBenchmarkBadge', () => ({
  ModelBenchmarkBadge: () => null,
}));

describe('ModelDropdown', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
    vi.restoreAllMocks();
    cleanup();
  });

  const baseModel: ModelConfig = {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    shortCode: 'gpt2',
    type: 'image',
    vendor: ModelVendor.GPT,
    sourceProfileId: 'tuzi-provider',
    sourceProfileName: 'Tuzi Provider',
    selectionKey: 'tuzi-provider::gpt-image-2',
  };

  function mockRect(
    element: Element,
    rect: Pick<DOMRect, 'top' | 'left' | 'bottom' | 'width'>
  ) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      x: rect.left,
      y: rect.top,
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.left + rect.width,
      width: rect.width,
      height: rect.bottom - rect.top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  it('外层反显 HappyHorse 时使用模型厂商 logo', () => {
    const happyHorseModel: ModelConfig = {
      id: 'happyhorse-1.0-i2v',
      label: 'HappyHorse 1.0 I2V',
      shortCode: 'h10i',
      type: 'video',
      vendor: ModelVendor.HAPPYHORSE,
      sourceProfileId: 'tuzi-provider',
      sourceProfileName: 'Tuzi Provider',
      selectionKey: 'tuzi-provider::happyhorse-1.0-i2v',
    };

    const { container } = render(
      <ModelDropdown
        selectedModel={happyHorseModel.id}
        selectedSelectionKey={happyHorseModel.selectionKey}
        models={[happyHorseModel]}
        onSelect={vi.fn()}
      />
    );

    const trigger = container.querySelector(
      '.model-dropdown__trigger--minimal'
    );
    const icon = trigger?.querySelector('img');

    expect(trigger?.textContent).toContain('#h10i');
    expect(icon?.getAttribute('src')).toBe('https://happyhorse.app/logo.webp');
  });

  it('placement auto 时可渲染 portal 菜单并自动向上避让底部', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 600,
    });

    const { container } = render(
      <ModelDropdown
        selectedModel={baseModel.id}
        selectedSelectionKey={baseModel.selectionKey}
        models={[baseModel]}
        onSelect={vi.fn()}
      />
    );
    const wrapper = container.querySelector(
      '.model-dropdown'
    ) as HTMLElement;
    mockRect(wrapper, { top: 520, left: 42, bottom: 552, width: 180 });

    fireEvent.mouseDown(
      container.querySelector('.model-dropdown__trigger--minimal') as HTMLElement
    );

    const menu = document.body.querySelector(
      '.model-dropdown__menu'
    ) as HTMLElement;

    expect(menu).toBeTruthy();
    expect(menu.classList.contains('model-dropdown__menu--up')).toBe(true);
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.left).toBe('42px');
    expect(menu.style.bottom).toBe('84px');
  });

  it('form 变体的 portal 菜单宽度不小于触发器宽度', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 800,
    });

    const { container } = render(
      <ModelDropdown
        selectedModel={baseModel.id}
        selectedSelectionKey={baseModel.selectionKey}
        models={[baseModel]}
        onSelect={vi.fn()}
        variant="form"
      />
    );
    const wrapper = screen.getByTestId('model-selector');
    mockRect(wrapper, { top: 100, left: 24, bottom: 140, width: 680 });

    fireEvent.mouseDown(
      container.querySelector('.model-dropdown__trigger--form') as HTMLElement
    );

    const menu = document.body.querySelector(
      '.model-dropdown__menu'
    ) as HTMLElement;

    expect(menu).toBeTruthy();
    expect(menu.style.width).toBe('680px');
    expect(menu.classList.contains('model-dropdown__menu--down')).toBe(true);
  });

  it('renders the full creative model pool through search while opentu owns visible defaults', () => {
    const sanitizedPayload = stripCreativeServerUiPolicy({
      defaultModelId: 'server-owned-default',
      defaultVisible: ['server-owned-default'],
      displayPolicy: {
        defaultVisibleModels: ['server-owned-default'],
      },
      data: [
        {
          id: 'server-owned-default',
          label: 'Server Owned Default',
          shortLabel: 'Server Default',
          type: 'text',
          vendor: ModelVendor.OTHER,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::server-owned-default`,
          defaultVisible: true,
        },
        {
          id: 'gpt-5.5',
          label: 'GPT 5.5',
          shortLabel: 'GPT 5.5',
          shortCode: 'g55',
          type: 'text',
          vendor: ModelVendor.GPT,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::gpt-5.5`,
        },
        {
          id: 'deepseek-v3.2',
          label: 'DeepSeek V3.2',
          shortLabel: 'DeepSeek',
          type: 'text',
          vendor: ModelVendor.DEEPSEEK,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::deepseek-v3.2`,
        },
        {
          id: 'gemini-3.1-pro-preview',
          label: 'Gemini 3.1 Pro Preview',
          shortLabel: 'Gemini 3.1',
          type: 'text',
          vendor: ModelVendor.GEMINI,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::gemini-3.1-pro-preview`,
        },
        {
          id: 'long-tail-model',
          label: 'Long Tail Model',
          shortLabel: 'Long Tail',
          type: 'text',
          vendor: ModelVendor.OTHER,
          sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
          sourceProfileName: 'New API Creative',
          selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::long-tail-model`,
        },
      ],
    }) as { data: ModelConfig[] };
    const fullPool = sanitizedPayload.data;
    const defaultModel = getCreativeDefaultModel('text', fullPool);
    const onSelect = vi.fn();
    const onSelectModel = vi.fn();

    expect(JSON.stringify(sanitizedPayload)).not.toMatch(
      /defaultModel|defaultVisible|displayPolicy/i
    );
    expect(defaultModel?.id).toBe('gpt-5.5');
    expect(getCreativeDefaultVisibleModels('text', fullPool).map((model) => model.id)).toEqual([
      'gpt-5.5',
      'deepseek-v3.2',
      'gemini-3.1-pro-preview',
    ]);
    expect(getCreativeMoreModels('text', fullPool).map((model) => model.id)).toEqual(
      expect.arrayContaining(['server-owned-default', 'long-tail-model'])
    );

    const { container } = render(
      <ModelDropdown
        selectedModel={defaultModel?.id || ''}
        selectedSelectionKey={defaultModel?.selectionKey}
        models={fullPool}
        onSelect={onSelect}
        onSelectModel={onSelectModel}
        showProviderAction={false}
      />
    );
    const wrapper = container.querySelector('.model-dropdown') as HTMLElement;
    mockRect(wrapper, { top: 120, left: 24, bottom: 152, width: 240 });

    fireEvent.mouseDown(
      container.querySelector('.model-dropdown__trigger--minimal') as HTMLElement
    );

    expect(container.textContent).toContain('#g55');
    expect(document.body.textContent).not.toContain('Server Owned Default');

    fireEvent.change(
      document.body.querySelector('.model-dropdown__search-input') as HTMLInputElement,
      { target: { value: 'server-owned-default' } }
    );

    const serverOption = screen.getByText('Server Default').closest(
      '.model-dropdown__item'
    ) as HTMLElement;
    expect(serverOption?.textContent).toContain('#server-owned-default');

    fireEvent.click(serverOption);

    expect(onSelect).toHaveBeenCalledWith(
      'server-owned-default',
      expect.objectContaining({
        profileId: CREATIVE_MANAGED_PROFILE_ID,
        modelId: 'server-owned-default',
      })
    );
    expect(onSelectModel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'server-owned-default',
        sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
      })
    );
  });

  it('renders an accessible marker when a persisted model disappeared and was switched to fallback', () => {
    const fallbackTextModel: ModelConfig = {
      id: 'gpt-5.5',
      label: 'GPT 5.5',
      shortLabel: 'GPT 5.5',
      shortCode: 'g55',
      type: 'text',
      vendor: ModelVendor.GPT,
      sourceProfileId: CREATIVE_MANAGED_PROFILE_ID,
      sourceProfileName: 'New API Creative',
      selectionKey: `${CREATIVE_MANAGED_PROFILE_ID}::gpt-5.5`,
    };

    const { container } = render(
      <ModelDropdown
        selectedModel={fallbackTextModel.id}
        selectedSelectionKey={fallbackTextModel.selectionKey}
        models={[fallbackTextModel]}
        onSelect={vi.fn()}
        language="en"
        showProviderAction={false}
        unavailableModelMarker={{
          generationType: 'text',
          reason: 'unavailable-in-model-pool',
          updatedAt: 123456,
          original: {
            modelId: 'stale-server-model',
            profileId: 'remote-profile',
            providerIdHint: 'remote-profile',
            vendorHint: 'OTHER',
          },
          fallback: {
            modelId: 'gpt-5.5',
            profileId: CREATIVE_MANAGED_PROFILE_ID,
            providerIdHint: CREATIVE_MANAGED_PROFILE_ID,
            vendorHint: 'GPT',
          },
        }}
      />
    );

    const triggerMarker = screen.getByLabelText(
      'Previous model stale-server-model is unavailable; switched to gpt-5.5'
    );
    expect(triggerMarker.classList.contains('model-dropdown__unavailable-marker')).toBe(
      true
    );
    expect(triggerMarker.textContent).toBe('Switched');

    const wrapper = container.querySelector('.model-dropdown') as HTMLElement;
    mockRect(wrapper, { top: 120, left: 24, bottom: 152, width: 240 });
    fireEvent.mouseDown(
      container.querySelector('.model-dropdown__trigger--minimal') as HTMLElement
    );

    const menuNotice = screen.getByText(
      'Previous model stale-server-model is unavailable. Using gpt-5.5 instead.'
    );
    expect(menuNotice.classList.contains('model-dropdown__unavailable-notice')).toBe(
      true
    );
  });

  it('does not fall back to OpenTU static model config for a missing embedded model selection', () => {
    window.history.pushState({}, '', '/creative/');

    const { container } = render(
      <ModelDropdown
        selectedModel="gpt-image-2"
        models={[]}
        onSelect={vi.fn()}
        showProviderAction={false}
      />
    );

    const trigger = container.querySelector(
      '.model-dropdown__trigger--minimal'
    );

    expect(trigger?.textContent).toContain('#img');
    expect(trigger?.textContent).not.toContain('#gpt2');
  });
});
