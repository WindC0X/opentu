import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowEvent } from '../workflow-engine/types';

const mocks = vi.hoisted(() => ({
  durableTaskIdSaved: false,
  callbackReturnedPromise: false,
  providerContinuedAfterDurableSave: false,
  saveWorkflow: vi.fn(),
  generateImage: vi.fn(),
}));

vi.mock('../media-executor', () => ({
  executorFactory: {
    getFallbackExecutor: () => ({
      generateText: async () => ({ content: 'test' }),
    }),
  },
  taskStorageWriter: {},
}));

vi.mock('../workflow-engine/workflow-storage-writer', () => ({
  workflowStorageWriter: {
    saveWorkflow: mocks.saveWorkflow,
    getWorkflow: async () => null,
  },
}));

vi.mock('../media-generation', () => ({
  TaskStatus: {
    FAILED: 'failed',
    COMPLETED: 'completed',
  },
  generateImage: mocks.generateImage,
  generateVideo: async () => ({
    task: { id: 'video-task', status: 'completed', result: {} },
  }),
}));

describe('WorkflowEngine durable media task id persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.durableTaskIdSaved = false;
    mocks.callbackReturnedPromise = false;
    mocks.providerContinuedAfterDurableSave = false;

    mocks.saveWorkflow.mockImplementation((workflow: Workflow) => {
      const hasDurableTaskId = workflow.steps.some(
        (step) => (step.result as { taskId?: string } | undefined)?.taskId === 'task-durable-1'
      );
      if (!hasDurableTaskId) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          mocks.durableTaskIdSaved = true;
          resolve();
        }, 0);
      });
    });

    mocks.generateImage.mockImplementation(async (_prompt: string, options: any) => {
      const callbackResult = options.onTaskCreated?.('task-durable-1');
      mocks.callbackReturnedPromise = !!callbackResult && typeof callbackResult.then === 'function';
      await callbackResult;
      mocks.providerContinuedAfterDurableSave = mocks.durableTaskIdSaved;
      return {
        task: {
          id: 'task-durable-1',
          status: 'completed',
          result: {
            url: '/__aitu_cache__/image/task-durable-1.png',
            format: 'png',
            size: 1,
          },
        },
      };
    });
  });

  it('awaits workflow save from onTaskCreated before provider execution continues', async () => {
    const { WorkflowEngine } = await import('../workflow-engine/engine');
    const events: WorkflowEvent[] = [];
    const engine = new WorkflowEngine({ onEvent: (event) => events.push(event) });
    const workflow: Workflow = {
      id: 'workflow-durable-taskid',
      name: 'Durable task id workflow',
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
      steps: [
        {
          id: 'step-image',
          mcp: 'generate_image',
          args: { prompt: 'durable cat' },
          description: 'Generate image',
          status: 'pending',
        },
      ],
    };

    await engine.submitWorkflow(workflow);

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'completed')).toBe(true);
    });
    expect(mocks.callbackReturnedPromise).toBe(true);
    expect(mocks.providerContinuedAfterDurableSave).toBe(true);
    expect(mocks.saveWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            result: expect.objectContaining({ taskId: 'task-durable-1' }),
          }),
        ],
      })
    );
  });
});
