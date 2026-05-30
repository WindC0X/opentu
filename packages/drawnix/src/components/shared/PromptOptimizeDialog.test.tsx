// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptOptimizeDialog } from './PromptOptimizeDialog';
import { LS_KEYS } from '../../constants/storage-keys';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  buildOptimizationPrompt: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  addPromptHistory: vi.fn(),
  refreshPromptHistory: vi.fn(),
  promptHistory: [] as Array<{
    id: string;
    content: string;
    timestamp: number;
    pinned?: boolean;
    modelType?:
      | 'image'
      | 'video'
      | 'audio'
      | 'text'
      | 'agent'
      | 'ppt-common'
      | 'ppt-slide';
  }>,
  textModels: [{ id: 'text-model', name: 'Text Model' }],
}));

vi.mock('tdesign-react', () => ({
  MessagePlugin: {
    success: mocks.success,
    warning: mocks.warning,
    error: mocks.error,
  },
}));

vi.mock('lucide-react', () => ({
  History: () => <span aria-hidden="true" />,
  Lightbulb: () => <span aria-hidden="true" />,
  Pin: () => <span aria-hidden="true" />,
  PinOff: () => <span aria-hidden="true" />,
  Sparkles: () => <span aria-hidden="true" />,
  X: () => <span aria-hidden="true" />,
}));

vi.mock('../../services/media-executor', () => ({
  executorFactory: {
    getFallbackExecutor: () => ({
      generateText: mocks.generateText,
    }),
  },
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {},
  CacheStatus: {},
}));

vi.mock('../../hooks/useCanvasAudioPlayback', () => ({
  useCanvasAudioPlayback: () => ({}),
  useCanvasAudioPlaybackControls: () => ({}),
  useCanvasAudioPlaybackSelector: () => undefined,
}));

vi.mock('../../services/prompt-optimization-service', () => ({
  buildOptimizationPrompt: mocks.buildOptimizationPrompt,
  getPromptOptimizationScenario: (
    scenarioId?: string,
    type: 'image' | 'video' | 'audio' | 'text' | 'agent' = 'image'
  ) => {
    if (scenarioId === 'ppt.common') {
      return {
        id: scenarioId,
        name: 'PPT 公共提示词',
        type: 'image',
        historyType: 'ppt-common',
        defaultMode: 'polish',
        noteTitle: 'PPT-公共提示词',
        focus: '',
      };
    }

    return {
      id: scenarioId || `ai-input.${type}`,
      name: scenarioId || type,
      type,
      historyType: type,
      defaultMode:
        type === 'image' || type === 'video' ? 'structured' : 'polish',
      noteTitle: scenarioId || type,
      focus: '',
    };
  },
  normalizeOptimizedPromptResult: (value: string) => {
    const trimmed = value.trim();
    const codeFenceMatch = trimmed.match(/^```[\w-]*\n?([\s\S]*?)\n?```$/);
    return codeFenceMatch ? codeFenceMatch[1].trim() : trimmed;
  },
}));

vi.mock('../ai-input-bar/ModelDropdown', () => ({
  ModelDropdown: ({
    onSelectModel,
  }: {
    onSelectModel: (model: { id: string; name: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelectModel({ id: 'alternate-text-model', name: 'Alternate Text' })
      }
    >
      mock text model
    </button>
  ),
}));

vi.mock('../winbox', () => ({
  WinBoxWindow: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: React.ReactNode;
  }) => (visible ? <div data-testid="mock-winbox">{children}</div> : null),
}));

vi.mock('../../hooks/use-runtime-models', () => ({
  useSelectableModels: () => mocks.textModels,
}));

vi.mock('../../hooks/usePromptHistory', () => ({
  usePromptHistory: () => ({
    history: mocks.promptHistory,
    addHistory: mocks.addPromptHistory,
    removeHistory: vi.fn(),
    clearHistory: vi.fn(),
    refreshHistory: mocks.refreshPromptHistory,
    togglePinHistory: vi.fn(),
  }),
}));

vi.mock('../../utils/settings-manager', () => ({
  createModelRef: (profileId: string | null, modelId: string | null) =>
    modelId ? { profileId, modelId } : null,
  resolveInvocationRoute: () => ({
    profileId: null,
    modelId: 'text-model',
  }),
  providerPricingCacheSettings: {
    get: () => [],
    set: vi.fn(),
  },
  ttsSettings: {
    get: () => ({ rate: 1 }),
    set: vi.fn(),
    update: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('../../utils/runtime-model-discovery', () => ({
  getPinnedSelectableModel: () => null,
}));

vi.mock('../../utils/model-selection', () => ({
  findMatchingSelectableModel: (
    models: Array<{ id: string }>,
    modelId: string
  ) => models.find((model) => model.id === modelId) || null,
  getModelRefFromConfig: (model: { id: string }) => ({
    profileId: null,
    modelId: model.id,
  }),
  getSelectionKey: (modelId: string) => modelId,
}));

let roots: Root[] = [];

const waitFor = async (assertion: () => void) => {
  const deadline = Date.now() + 1000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const getByLabelText = (labelText: string): HTMLTextAreaElement => {
  const labels = Array.from(document.body.querySelectorAll('label'));
  const label = labels.find((candidate) => candidate.textContent === labelText);
  const controlId = label?.getAttribute('for');
  const control = controlId ? document.getElementById(controlId) : null;

  if (!(control instanceof HTMLTextAreaElement)) {
    throw new Error(`Unable to find textarea labeled "${labelText}"`);
  }

  return control;
};

const getButton = (name: string | RegExp): HTMLButtonElement => {
  const buttons = Array.from(document.body.querySelectorAll('button'));
  const button = buttons.find((candidate) => {
    const text = candidate.textContent || '';
    return typeof name === 'string' ? text === name : name.test(text);
  });

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Unable to find button "${String(name)}"`);
  }

  return button;
};

const queryButton = (name: string | RegExp): HTMLButtonElement | null => {
  const buttons = Array.from(document.body.querySelectorAll('button'));
  const button = buttons.find((candidate) => {
    const text = candidate.textContent || '';
    return typeof name === 'string' ? text === name : name.test(text);
  });

  return button instanceof HTMLButtonElement ? button : null;
};

const getOptimizeButton = (): HTMLButtonElement =>
  getButton(/^(开始优化|生成结构化提示词)$/);

const changeTextarea = (element: HTMLTextAreaElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

const renderDialog = (
  props: Partial<React.ComponentProps<typeof PromptOptimizeDialog>> = {}
) => {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(
      <PromptOptimizeDialog
        open
        onOpenChange={onOpenChange}
        originalPrompt="原始提示词"
        language="zh"
        type="image"
        onApply={onApply}
        {...props}
      />
    );
  });

  return { onApply, onOpenChange };
};

describe('PromptOptimizeDialog', () => {
  beforeEach(() => {
    mocks.generateText.mockReset();
    mocks.buildOptimizationPrompt.mockReset();
    mocks.buildOptimizationPrompt.mockImplementation(
      async ({ originalPrompt, optimizationRequirements }) =>
        [
          'mock optimization request',
          '【原始提示词】',
          originalPrompt,
          '【优化要求】',
          optimizationRequirements || '无',
        ].join('\n')
    );
    mocks.success.mockReset();
    mocks.warning.mockReset();
    mocks.error.mockReset();
    mocks.addPromptHistory.mockReset();
    mocks.refreshPromptHistory.mockReset();
    mocks.promptHistory = [];
    mocks.textModels = [{ id: 'text-model', name: 'Text Model' }];
    localStorage.clear();
  });

  afterEach(() => {
    roots.forEach((root) => {
      act(() => root.unmount());
    });
    roots = [];
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('opens with empty prompt and keeps optimization disabled until prompt exists', async () => {
    renderDialog({ originalPrompt: '' });

    expect(getByLabelText('当前提示词').value).toBe('');
    expect(getOptimizeButton().disabled).toBe(true);
    expect(queryButton('回填')).not.toBeNull();
    expect(getButton('回填').disabled).toBe(true);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('fills back the current prompt before an optimized draft exists', () => {
    const { onApply, onOpenChange } = renderDialog();

    expect(() => getByLabelText('优化结果草稿')).toThrow();
    expect(getButton('回填').disabled).toBe(false);

    act(() => {
      changeTextarea(getByLabelText('当前提示词'), '人工修改后的提示词');
    });

    act(() => {
      getButton('回填').click();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('人工修改后的提示词');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('keeps optimized output as a draft and applies only on fill back', async () => {
    mocks.generateText.mockResolvedValueOnce({ content: '第一轮优化结果' });
    const { onApply, onOpenChange } = renderDialog();

    await act(async () => {
      changeTextarea(getByLabelText('当前提示词'), '手动改写后的提示词');
      changeTextarea(getByLabelText('补充要求'), '补充电影感');
      getOptimizeButton().click();
      await flushPromises();
    });

    await waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    expect(mocks.addPromptHistory).toHaveBeenCalledWith(
      '手动改写后的提示词',
      false,
      'image'
    );
    expect(
      JSON.parse(
        localStorage.getItem(LS_KEYS.PROMPT_OPTIMIZE_REQUIREMENTS_HISTORY) ||
          '[]'
      )[0]
    ).toMatchObject({
      content: '补充电影感',
    });
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain(
      '【原始提示词】\n手动改写后的提示词'
    );
    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await waitFor(() =>
      expect(getByLabelText('优化结果草稿')).toHaveProperty(
        'value',
        '第一轮优化结果'
      )
    );
    expect(queryButton('回填')).not.toBeNull();
    expect(getByLabelText('当前提示词').value).toBe('手动改写后的提示词');

    act(() => {
      getButton('回填').click();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('第一轮优化结果');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('uses the draft as the next editable prompt for another optimization round', async () => {
    mocks.generateText
      .mockResolvedValueOnce({ content: '第一轮优化结果' })
      .mockResolvedValueOnce({ content: '第二轮优化结果' });
    const { onApply } = renderDialog();

    await act(async () => {
      changeTextarea(getByLabelText('当前提示词'), '手动改写后的提示词');
      changeTextarea(getByLabelText('补充要求'), '补充电影感');
      getOptimizeButton().click();
      await flushPromises();
    });

    await waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    expect(mocks.generateText.mock.calls[0][0].prompt).toContain(
      '【原始提示词】\n手动改写后的提示词'
    );
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(getByLabelText('优化结果草稿')).toHaveProperty(
        'value',
        '第一轮优化结果'
      )
    );

    act(() => {
      getButton('用结果继续优化').click();
    });
    expect(getByLabelText('当前提示词').value).toBe('第一轮优化结果');

    await act(async () => {
      changeTextarea(getByLabelText('补充要求'), '继续压缩冗余');
      getOptimizeButton().click();
      await flushPromises();
    });

    await waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(2));
    expect(mocks.generateText.mock.calls[1][0].prompt).toContain(
      '【原始提示词】\n第一轮优化结果'
    );
    await waitFor(() =>
      expect(getByLabelText('优化结果草稿')).toHaveProperty(
        'value',
        '第二轮优化结果'
      )
    );
    expect(onApply).not.toHaveBeenCalled();

    act(() => {
      getButton('回填').click();
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('第二轮优化结果');
  });

  it('remembers the selected optimizer text model', async () => {
    mocks.textModels = [
      { id: 'text-model', name: 'Text Model' },
      { id: 'alternate-text-model', name: 'Alternate Text' },
    ];
    mocks.generateText.mockResolvedValueOnce({ content: '优化结果' });
    renderDialog();

    act(() => {
      getButton('mock text model').click();
    });

    expect(
      JSON.parse(
        localStorage.getItem(LS_KEYS.PROMPT_OPTIMIZE_TEXT_MODEL) || '{}'
      )
    ).toMatchObject({
      modelId: 'alternate-text-model',
      profileId: null,
    });

    await act(async () => {
      getOptimizeButton().click();
      await flushPromises();
    });

    expect(mocks.generateText.mock.calls[0][0]).toMatchObject({
      model: 'alternate-text-model',
      modelRef: {
        profileId: null,
        modelId: 'alternate-text-model',
      },
    });
  });

  it('uses scenario defaults for prompt history and request building', async () => {
    mocks.generateText.mockResolvedValueOnce({ content: '优化结果' });
    renderDialog({
      scenarioId: 'ppt.common',
      type: undefined,
      historyType: undefined,
      allowStructuredMode: true,
      originalPrompt: '统一视觉方向',
    });

    await act(async () => {
      getOptimizeButton().click();
      await flushPromises();
    });

    await waitFor(() => expect(mocks.generateText).toHaveBeenCalledTimes(1));
    expect(mocks.addPromptHistory).toHaveBeenCalledWith(
      '统一视觉方向',
      false,
      'ppt-common'
    );
    expect(mocks.buildOptimizationPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: 'ppt.common',
        type: 'image',
        mode: 'polish',
      })
    );
  });

  it('uses the platform prompt optimizer only after fixed-cost confirmation', async () => {
    const platformOptimization = {
      quote: vi.fn().mockResolvedValue({ amount: 2, unit: 'points' as const }),
      optimize: vi.fn().mockResolvedValue({
        optimizedPrompt: '平台优化结果',
        taskId: 'task-1',
      }),
    };
    const { onApply } = renderDialog({ platformOptimization });
    await act(async () => {
      await flushPromises();
    });

    await waitFor(() =>
      expect(document.body.textContent).toContain('本次优化消耗 2 点')
    );
    expect(queryButton('mock text model')).toBeNull();
    expect(getButton(/确认并优化/).disabled).toBe(true);

    const confirm = document.body.querySelector<HTMLInputElement>(
      '.prompt-optimize-dialog__platform-confirm input'
    );
    expect(confirm).not.toBeNull();
    act(() => {
      confirm!.click();
    });
    await act(async () => {
      getButton(/确认并优化/).click();
      await flushPromises();
    });

    await waitFor(() =>
      expect(platformOptimization.optimize).toHaveBeenCalled()
    );
    expect(platformOptimization.optimize).toHaveBeenCalledWith({
      prompt: '原始提示词',
    });
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(getByLabelText('优化结果草稿')).toHaveProperty(
        'value',
        '平台优化结果'
      )
    );

    act(() => {
      getButton('回填').click();
    });
    expect(onApply).toHaveBeenCalledWith('平台优化结果');
  });

  it('keeps the original platform prompt editable when optimization fails', async () => {
    const platformOptimization = {
      quote: vi.fn().mockResolvedValue({ amount: 2, unit: 'points' as const }),
      optimize: vi
        .fn()
        .mockRejectedValue(new Error('Prompt optimization failed')),
    };
    renderDialog({ platformOptimization });
    await act(async () => {
      await flushPromises();
    });

    await waitFor(() =>
      expect(document.body.textContent).toContain('本次优化消耗 2 点')
    );
    const confirm = document.body.querySelector<HTMLInputElement>(
      '.prompt-optimize-dialog__platform-confirm input'
    );
    act(() => {
      confirm!.click();
    });
    await act(async () => {
      getButton(/确认并优化/).click();
      await flushPromises();
    });

    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(document.body.textContent).toContain('Prompt optimization failed');
    expect(getByLabelText('当前提示词').value).toBe('原始提示词');
    expect(() => getByLabelText('优化结果草稿')).toThrow();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('uses the previously stored optimizer text model on open', async () => {
    mocks.textModels = [
      { id: 'text-model', name: 'Text Model' },
      { id: 'stored-text-model', name: 'Stored Text' },
    ];
    localStorage.setItem(
      LS_KEYS.PROMPT_OPTIMIZE_TEXT_MODEL,
      JSON.stringify({
        modelId: 'stored-text-model',
        profileId: 'profile-1',
      })
    );
    mocks.generateText.mockResolvedValueOnce({ content: '优化结果' });
    renderDialog();

    await act(async () => {
      getOptimizeButton().click();
      await flushPromises();
    });

    expect(mocks.generateText.mock.calls[0][0]).toMatchObject({
      model: 'stored-text-model',
      modelRef: {
        profileId: null,
        modelId: 'stored-text-model',
      },
    });
  });
});
