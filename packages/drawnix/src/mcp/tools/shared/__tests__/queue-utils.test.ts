import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus, TaskType } from '../../../../types/task.types';
import { createQueueTask, type QueueTaskConfig } from '../queue-utils';

const { createTaskMock, retryTaskMock, getTaskMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  retryTaskMock: vi.fn(),
  getTaskMock: vi.fn(),
}));

vi.mock('../../../../services/task-queue', () => ({
  taskQueueService: {
    createTask: createTaskMock,
    retryTask: retryTaskMock,
    getTask: getTaskMock,
  },
}));

function createConfig(): QueueTaskConfig {
  return {
    taskType: TaskType.IMAGE,
    resultType: 'image',
    getDefaultModel: () => 'test-model',
    buildTaskPayload: () => ({
      prompt: 'test prompt',
      size: '1x1',
      model: 'test-model',
    }),
  };
}

describe('queue-utils', () => {
  beforeEach(() => {
    createTaskMock.mockReset();
    retryTaskMock.mockReset();
    getTaskMock.mockReset();
    createTaskMock.mockImplementation((params, type) => ({
      id: `task-${createTaskMock.mock.calls.length}`,
      type,
      status: TaskStatus.PROCESSING,
      params,
      createdAt: 1,
      updatedAt: 1,
      insertedToCanvas: false,
    }));
  });

  it('preserves workflowId for workflow-batch tasks', () => {
    createQueueTask(
      {
        prompt: 'test prompt',
        workflowId: 'wf-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      },
      {},
      createConfig()
    );

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'wf-1',
        batchId: 'wf_batch_wf-1',
        batchIndex: 2,
        batchTotal: 4,
      }),
      TaskType.IMAGE
    );
  });

  it('preserves workflowId for direct-count tasks', () => {
    createQueueTask(
      {
        prompt: 'test prompt',
        workflowId: 'wf-2',
        count: 2,
      },
      {},
      createConfig()
    );

    expect(createTaskMock).toHaveBeenCalledTimes(2);
    createTaskMock.mock.calls.forEach(([params], index) => {
      expect(params).toMatchObject({
        workflowId: 'wf-2',
        batchIndex: index + 1,
        batchTotal: 2,
      });
    });
  });

  it('adds S08 platform metadata for image edit queue tasks', () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');
    createQueueTask(
      {
        prompt: 'edit prompt',
      },
      {},
      {
        ...createConfig(),
        buildTaskPayload: () => ({
          generationMode: 'image_edit',
          maskImage: 'https://example.com/mask.png',
          prompt: 'edit prompt',
          referenceImages: ['https://example.com/source.png'],
          size: '1x1',
        }),
      }
    );

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformManagedImageTask: true,
        platformOperationType: 'inpaint',
        platformProjectId: 'project-1',
      }),
      TaskType.IMAGE
    );
  });

  it('passes selected image model into platform task metadata', () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');
    createQueueTask(
      {
        prompt: 'test prompt',
      },
      {},
      {
        ...createConfig(),
        buildTaskPayload: () => ({
          generationMode: 'text_to_image',
          model: 'grsai-image-v1',
          prompt: 'test prompt',
          size: '1x1',
        }),
      }
    );

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformManagedImageTask: true,
        platformModelKey: 'grsai-image-v1',
        platformOperationType: 'text_to_image',
        platformProjectId: 'project-1',
      }),
      TaskType.IMAGE
    );
  });
});
