import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowEvent } from '../workflow-submission-service';

const mocks = vi.hoisted(() => ({
  isAvailable: vi.fn(async () => true),
  getAllWorkflows: vi.fn(async () => [] as any[]),
}));

vi.mock('../workflow-storage-reader', () => ({
  workflowStorageReader: {
    isAvailable: mocks.isAvailable,
    getAllWorkflows: mocks.getAllWorkflows,
  },
}));

vi.mock('../sw-capabilities', () => ({
  swCapabilitiesHandler: {
    execute: vi.fn(),
  },
}));

vi.mock('../media-executor', () => ({
  executorFactory: {},
}));

vi.mock('../workflow-engine', () => ({
  WorkflowEngine: class {
    getWorkflow() {
      return undefined;
    }
    async resumeWorkflow() {
      return undefined;
    }
  },
}));

vi.mock('../../utils/settings-manager', () => ({
  geminiSettings: {
    get: vi.fn(() => ({})),
  },
}));

describe('workflowSubmissionService recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.isAvailable.mockReset();
    mocks.isAvailable.mockResolvedValue(true);
    mocks.getAllWorkflows.mockReset();
  });

  it('emits recovered events for active persisted workflows returned from IndexedDB', async () => {
    const recoveredWorkflow = {
      id: 'workflow-recovered-taskid',
      name: 'Recovered workflow',
      status: 'running' as const,
      createdAt: 1,
      updatedAt: 2,
      steps: [
        {
          id: 'step-image',
          mcp: 'generate_image',
          args: { prompt: 'recover cat' },
          description: 'Generate image',
          status: 'running' as const,
          result: { taskId: 'task-recovered-image-1' },
        },
      ],
    };
    mocks.getAllWorkflows.mockResolvedValue([recoveredWorkflow]);

    const { workflowSubmissionService } = await import(
      '../workflow-submission-service'
    );
    const events: WorkflowEvent[] = [];
    const subscription = workflowSubmissionService.subscribeToAllEvents((event) => {
      events.push(event);
    });

    try {
      const recovered = await workflowSubmissionService.recoverWorkflows();

      expect(recovered).toEqual([recoveredWorkflow]);
      expect(events).toContainEqual({
        type: 'recovered',
        workflowId: 'workflow-recovered-taskid',
        workflow: recoveredWorkflow,
      });
    } finally {
      subscription.unsubscribe();
    }
  });
});
