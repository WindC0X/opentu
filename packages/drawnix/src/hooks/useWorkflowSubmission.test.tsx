// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowSubmission } from './useWorkflowSubmission';
import type { WorkflowEvent } from '../services/workflow-submission-service';

const workflowControl = {
  restoreWorkflow: vi.fn(),
  startWorkflow: vi.fn(),
  updateStep: vi.fn(),
  getWorkflow: vi.fn(),
  abortWorkflow: vi.fn(),
  addSteps: vi.fn(),
};

const updateWorkflowMessage = vi.fn();
const sendWorkflowMessage = vi.fn();

let allEventsHandler: ((event: WorkflowEvent) => void) | null = null;

vi.mock('../contexts/WorkflowContext', () => ({
  useWorkflowControl: () => workflowControl,
}));

vi.mock('../contexts/ChatDrawerContext', () => ({
  useChatDrawerControl: () => ({
    sendWorkflowMessage,
    updateWorkflowMessage,
  }),
}));

vi.mock('./useTaskWorkflowSync', () => ({
  useTaskWorkflowSync: vi.fn(),
}));

vi.mock('../services/workflow-submission-service', () => ({
  workflowSubmissionService: {
    init: vi.fn(),
    registerCanvasHandler: vi.fn(),
    recoverWorkflows: vi.fn().mockResolvedValue([]),
    subscribeToAllEvents: vi.fn((handler: (event: WorkflowEvent) => void) => {
      allEventsHandler = handler;
      return { unsubscribe: vi.fn() };
    }),
    subscribeToWorkflow: vi.fn(() => ({ unsubscribe: vi.fn() })),
    cancel: vi.fn(),
  },
}));

vi.mock('../components/ai-input-bar/workflow-converter', () => ({
  convertToWorkflow: vi.fn(),
}));

vi.mock('../plugins/with-workzone', () => ({
  WorkZoneTransforms: {
    updateWorkflow: vi.fn(),
    removeWorkZone: vi.fn(),
  },
}));

vi.mock('../utils/settings-manager', () => ({
  geminiSettings: {
    get: vi.fn(() => ({
      textModelName: 'standalone-text',
      imageModelName: 'standalone-image',
      videoModelName: 'standalone-video',
      audioModelName: 'standalone-audio',
    })),
  },
}));

describe('useWorkflowSubmission recovery', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
    allEventsHandler = null;
    vi.clearAllMocks();
  });

  it('preserves recovered managed model routing and params in retry context', async () => {
    window.history.pushState({}, '', '/creative/');

    renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
      })
    );

    await waitFor(() => expect(allEventsHandler).toBeTruthy());

    allEventsHandler?.({
      type: 'recovered',
      workflowId: 'wf_recovered',
      workflow: {
        id: 'wf_recovered',
        name: 'Recovered image workflow',
        description: 'Recovered image workflow',
        scenarioType: 'direct_generation',
        generationType: 'image',
        status: 'failed',
        steps: [],
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now(),
        metadata: {
          prompt: 'draw a cat',
          userInstruction: 'draw a cat',
          rawInput: '#managed draw a cat',
          modelId: 'managed-image-binding',
          modelRef: {
            profileId: 'new-api-creative',
            modelId: 'managed-image-binding',
          },
          defaultModels: {
            image: 'managed-image-binding',
            video: 'managed-video',
            audio: 'managed-audio',
          },
          defaultModelRefs: {
            image: {
              profileId: 'new-api-creative',
              modelId: 'managed-image-binding',
            },
            video: {
              profileId: 'new-api-creative',
              modelId: 'managed-video',
            },
            audio: {
              profileId: 'new-api-creative',
              modelId: 'managed-audio',
            },
          },
          isModelExplicit: true,
          count: 2,
          size: '1024x1024',
          duration: '5s',
          custom: {
            quality: 'high',
          },
          userParams: {
            seed: 42,
          },
          creativeManaged: true,
          creativeParameterFallbackModelId: 'gpt-image-2',
          selection: { texts: [], images: [], videos: [], graphics: [] },
        },
        context: {
          userInput: '#managed draw a cat',
          model: 'managed-image-binding',
          modelRef: {
            profileId: 'new-api-creative',
            modelId: 'managed-image-binding',
          },
          referenceImages: ['blob://reference'],
        },
      } as any,
    });

    const recoveredMessage = updateWorkflowMessage.mock.calls[0]?.[0];
    expect(recoveredMessage?.retryContext?.aiContext.modelRef).toEqual({
      profileId: 'new-api-creative',
      modelId: 'managed-image-binding',
    });
    expect(
      recoveredMessage?.retryContext?.aiContext.defaultModelRefs?.image
    ).toEqual({
      profileId: 'new-api-creative',
      modelId: 'managed-image-binding',
    });
    expect(recoveredMessage?.retryContext?.aiContext.params.custom).toEqual({
      quality: 'high',
    });
    expect(
      recoveredMessage?.retryContext?.aiContext.params
        .creativeParameterFallbackModelId
    ).toBe('gpt-image-2');
  });

  it('rebuilds retry context from recovered context params and step args when metadata is unavailable', async () => {
    window.history.pushState({}, '', '/creative/');

    renderHook(() =>
      useWorkflowSubmission({
        boardRef: { current: null },
        workZoneIdRef: { current: null },
      })
    );

    await waitFor(() => expect(allEventsHandler).toBeTruthy());

    allEventsHandler?.({
      type: 'recovered',
      workflowId: 'wf_context_only',
      workflow: {
        id: 'wf_context_only',
        name: 'Context only recovered workflow',
        steps: [
          {
            id: 'step_1',
            mcp: 'generate_image',
            description: 'generate image',
            status: 'failed',
            args: {
              params: {
                quality: 'high',
                size: '1024x1024',
              },
            },
          },
        ],
        status: 'failed',
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now(),
        context: {
          userInput: '#managed draw a dog',
          model: 'managed-context-model',
          modelRef: {
            profileId: 'new-api-creative',
            modelId: 'managed-context-model',
          },
          defaultModelRefs: {
            image: {
              profileId: 'new-api-creative',
              modelId: 'managed-context-model',
            },
          },
          params: {
            count: 1,
            size: '1x1',
            userParams: {
              seed: 7,
            },
            creativeManaged: true,
            creativeParameterFallbackModelId: 'gpt-image-2',
          },
          referenceImages: [],
        },
      } as any,
    });

    const recoveredMessage = updateWorkflowMessage.mock.calls[0]?.[0];
    expect(recoveredMessage?.retryContext?.aiContext.modelRef).toEqual({
      profileId: 'new-api-creative',
      modelId: 'managed-context-model',
    });
    expect(
      recoveredMessage?.retryContext?.aiContext.defaultModelRefs?.image
    ).toEqual({
      profileId: 'new-api-creative',
      modelId: 'managed-context-model',
    });
    expect(recoveredMessage?.retryContext?.aiContext.params.custom).toEqual({
      quality: 'high',
      size: '1024x1024',
    });
    expect(recoveredMessage?.retryContext?.aiContext.params.userParams).toEqual(
      {
        seed: 7,
      }
    );
    expect(
      recoveredMessage?.retryContext?.aiContext.params
        .creativeParameterFallbackModelId
    ).toBe('gpt-image-2');
  });
});
