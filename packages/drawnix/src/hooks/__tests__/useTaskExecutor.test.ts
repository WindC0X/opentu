// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskExecutor } from '../useTaskExecutor';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import {
  CREATIVE_REMOTE_IMAGE_TIMEOUT_MS,
  TASK_TIMEOUT,
} from '../../constants/TASK_CONSTANTS';
import { resumeCreativeManagedImageTask } from '../../services/media-executor/fallback-adapter-routes';
import { generationAPIService } from '../../services/generation-api-service';

const mocks = vi.hoisted(() => {
  const taskListeners: Array<(event: any) => void> = [];
  const taskState = {
    task: null as any,
  };

  return {
    taskListeners,
    taskState,
    updateTaskStatus: vi.fn(
      (taskId: string, status: TaskStatus, updates?: Partial<Task>) => {
        if (!taskState.task || taskState.task.id !== taskId) {
          return;
        }
        taskState.task = {
          ...taskState.task,
          ...updates,
          status,
          updatedAt: Date.now(),
          ...(status === TaskStatus.FAILED || status === TaskStatus.COMPLETED
            ? { completedAt: Date.now() }
            : {}),
        };
        taskListeners.forEach((listener) =>
          listener({
            type: 'taskUpdated',
            task: taskState.task,
            timestamp: Date.now(),
          })
        );
      }
    ),
    resumeCreativeManagedImageTask: vi.fn(),
    cancelRequest: vi.fn(),
    abortTaskExecution: vi.fn(),
    registerImageMetadata: vi.fn(async () => undefined),
  };
});

vi.mock('../../services/task-queue', () => {
  const service = {
    getAllTasks: () => (mocks.taskState.task ? [mocks.taskState.task] : []),
    getTask: (taskId: string) =>
      mocks.taskState.task?.id === taskId ? mocks.taskState.task : undefined,
    updateTaskStatus: mocks.updateTaskStatus,
    abortTaskExecution: mocks.abortTaskExecution,
    observeTaskUpdates: () => ({
      subscribe: (listener: (event: any) => void) => {
        mocks.taskListeners.push(listener);
        return {
          unsubscribe: () => {
            const index = mocks.taskListeners.indexOf(listener);
            if (index >= 0) {
              mocks.taskListeners.splice(index, 1);
            }
          },
        };
      },
    }),
  };

  return {
    taskQueueService: service,
    legacyTaskQueueService: service,
  };
});

vi.mock('../../services/generation-api-service', () => ({
  generationAPIService: {
    cancelRequest: mocks.cancelRequest,
    generate: vi.fn(),
    resumeAsyncImageGeneration: vi.fn(),
    resumeAudioGeneration: vi.fn(),
  },
}));

vi.mock('../../services/media-executor/fallback-adapter-routes', () => ({
  resumeCreativeManagedImageTask: mocks.resumeCreativeManagedImageTask,
  isCreativeImageTaskTimeoutError: (error: unknown) =>
    Boolean(
      error &&
        typeof error === 'object' &&
        ((error as { code?: unknown }).code === 'TIMEOUT' ||
          (error as { name?: unknown }).name === 'TIMEOUT')
    ),
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    registerImageMetadata: mocks.registerImageMetadata,
  },
}));

vi.mock('../../services/task-invocation-route', () => ({
  assertTaskInvocationRouteAvailable: vi.fn(),
  resolveTaskInvocationRouteModel: vi.fn((task: Task) => task.params.model),
  shouldUseStrictTaskInvocationRoute: vi.fn(() => false),
}));

vi.mock('../../utils/api-auth-error-event', () => ({
  classifyApiCredentialError: vi.fn(() => null),
}));

function createProcessingCreativeImageTask(
  overrides: Partial<Task> = {}
): Task {
  const now = Date.now();
  return {
    id: 'task-managed-resume',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    remoteId: 'remote-managed-resume',
    executionPhase: TaskExecutionPhase.POLLING,
    params: {
      prompt: 'Resume a managed image',
      model: 'mock:gpt-image-2:preview',
      creativeManaged: true,
    },
    invocationRoute: {
      operation: 'image',
      providerProfileId: 'new-api-creative',
      modelId: 'mock:gpt-image-2:preview',
      binding: {
        id: 'new-api-creative:mock:gpt-image-2:preview:image',
        protocol: 'session-broker',
        requestSchema: 'new-api.creative.image.task',
        submitPath: '/images/tasks',
        pollPathTemplate: '/images/tasks/{taskId}',
      },
    },
    createdAt: now - TASK_TIMEOUT.IMAGE - 1_000,
    startedAt: now - TASK_TIMEOUT.IMAGE - 1_000,
    updatedAt: now - TASK_TIMEOUT.IMAGE - 1_000,
    ...overrides,
  };
}

function createPendingImageTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: 'task-generic-generate',
    type: TaskType.IMAGE,
    status: TaskStatus.PENDING,
    params: {
      prompt: 'Generate a normal image',
      model: 'gpt-image-2',
    },
    createdAt: now - TASK_TIMEOUT.IMAGE - 1_000,
    startedAt: now - TASK_TIMEOUT.IMAGE - 1_000,
    updatedAt: now - TASK_TIMEOUT.IMAGE - 1_000,
    ...overrides,
  };
}

describe('useTaskExecutor managed Creative image resume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T00:00:00.000Z'));
    mocks.taskListeners.length = 0;
    mocks.taskState.task = null;
    mocks.updateTaskStatus.mockClear();
    mocks.resumeCreativeManagedImageTask.mockReset();
    mocks.cancelRequest.mockReset();
    mocks.abortTaskExecution.mockReset();
    vi.mocked(generationAPIService.generate).mockReset();
    mocks.registerImageMetadata.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps managed remote image tasks resumable past the normal image timeout', async () => {
    const task = createProcessingCreativeImageTask();
    mocks.taskState.task = task;
    let finishResume!: () => void;
    let capturedSignal: AbortSignal | undefined;
    mocks.resumeCreativeManagedImageTask.mockImplementationOnce(
      async (_taskId, _remoteId, _params, options) => {
        capturedSignal = options?.signal;
        await new Promise<void>((resolve) => {
          finishResume = resolve;
        });
        return {
          url: '/__aitu_cache__/image/remote-managed-resume.png',
          format: 'png',
          size: 1,
          remoteTaskId: 'remote-managed-resume',
          providerTaskId: 'remote-managed-resume',
          contentUrl:
            '/creative/relay/v1/images/tasks/remote-managed-resume/content',
        };
      }
    );

    renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(resumeCreativeManagedImageTask).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(generationAPIService.cancelRequest).not.toHaveBeenCalledWith(
      task.id
    );
    expect(mocks.abortTaskExecution).not.toHaveBeenCalledWith(task.id);
    expect(capturedSignal?.aborted).toBe(false);
    expect(mocks.taskState.task?.status).toBe(TaskStatus.PROCESSING);

    finishResume();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.taskState.task?.status).toBe(TaskStatus.COMPLETED);
    expect(mocks.taskState.task?.result?.url).toBe(
      '/__aitu_cache__/image/remote-managed-resume.png'
    );
  });

  it('keeps managed remote image tasks recoverable after the remote timeout budget', async () => {
    const now = Date.now();
    const task = createProcessingCreativeImageTask({
      id: 'task-managed-remote-timeout',
      remoteId: 'remote-managed-timeout',
      createdAt: now - CREATIVE_REMOTE_IMAGE_TIMEOUT_MS - 1_000,
      startedAt: now - CREATIVE_REMOTE_IMAGE_TIMEOUT_MS - 1_000,
      updatedAt: now - CREATIVE_REMOTE_IMAGE_TIMEOUT_MS - 1_000,
    });
    mocks.taskState.task = task;
    mocks.resumeCreativeManagedImageTask.mockResolvedValueOnce({
      url: '/__aitu_cache__/image/remote-managed-timeout.png',
      format: 'png',
      size: 1,
      remoteTaskId: 'remote-managed-timeout',
      providerTaskId: 'remote-managed-timeout',
      contentUrl:
        '/creative/relay/v1/images/tasks/remote-managed-timeout/content',
    });

    renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(resumeCreativeManagedImageTask).toHaveBeenCalledTimes(1);
    expect(generationAPIService.cancelRequest).not.toHaveBeenCalledWith(
      task.id
    );
    expect(mocks.abortTaskExecution).not.toHaveBeenCalledWith(task.id);
    expect(mocks.taskState.task?.status).toBe(TaskStatus.COMPLETED);
    expect(mocks.taskState.task?.result?.url).toBe(
      '/__aitu_cache__/image/remote-managed-timeout.png'
    );
  });

  it('keeps managed remote image tasks processing and schedules another resume after the Creative timeout budget', async () => {
    const task = createProcessingCreativeImageTask({
      id: 'task-managed-poll-timeout',
      remoteId: 'remote-managed-poll-timeout',
      progress: 60,
    });
    mocks.taskState.task = task;
    const timeoutError = Object.assign(
      new Error('creative image task timed out'),
      { code: 'TIMEOUT', name: 'TIMEOUT' }
    );
    mocks.resumeCreativeManagedImageTask
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce({
        url: '/__aitu_cache__/image/remote-managed-poll-timeout.png',
        format: 'png',
        size: 1,
        remoteTaskId: 'remote-managed-poll-timeout',
        providerTaskId: 'remote-managed-poll-timeout',
        contentUrl:
          '/creative/relay/v1/images/tasks/remote-managed-poll-timeout/content',
      });

    renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });

    expect(resumeCreativeManagedImageTask).toHaveBeenCalledTimes(1);
    expect(generationAPIService.cancelRequest).not.toHaveBeenCalledWith(
      task.id
    );
    expect(mocks.abortTaskExecution).not.toHaveBeenCalledWith(task.id);
    expect(mocks.taskState.task).toMatchObject({
      status: TaskStatus.PROCESSING,
      executionPhase: TaskExecutionPhase.POLLING,
      progress: 95,
    });
    expect(mocks.taskState.task?.error).toBeUndefined();
    expect(mocks.taskState.task?.completedAt).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
    });

    expect(resumeCreativeManagedImageTask).toHaveBeenCalledTimes(2);
    expect(mocks.taskState.task?.status).toBe(TaskStatus.COMPLETED);
    expect(mocks.taskState.task?.result?.url).toBe(
      '/__aitu_cache__/image/remote-managed-poll-timeout.png'
    );
  });

  it('does not let stale managed resume completion overwrite a newer retry attempt', async () => {
    const task = createProcessingCreativeImageTask({
      params: {
        prompt: 'Resume a managed image',
        model: 'mock:gpt-image-2:preview',
        creativeManaged: true,
        retryAttempt: 0,
      },
    });
    mocks.taskState.task = task;
    let finishResume!: () => void;
    mocks.resumeCreativeManagedImageTask.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishResume = resolve;
      });
      return {
        url: '/__aitu_cache__/image/stale-managed-resume.png',
        format: 'png',
        size: 1,
        remoteTaskId: 'remote-managed-resume',
        providerTaskId: 'remote-managed-resume',
        contentUrl:
          '/creative/relay/v1/images/tasks/remote-managed-resume/content',
      };
    });

    renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(resumeCreativeManagedImageTask).toHaveBeenCalledTimes(1);

    mocks.taskState.task = {
      ...task,
      status: TaskStatus.PROCESSING,
      remoteId: task.remoteId,
      startedAt: task.startedAt! + 1,
      params: {
        ...task.params,
        retryAttempt: 1,
      },
      updatedAt: Date.now(),
    };

    finishResume();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.taskState.task?.status).toBe(TaskStatus.PROCESSING);
    expect(mocks.taskState.task?.params.retryAttempt).toBe(1);
    expect(mocks.taskState.task?.result).toBeUndefined();
  });

  it('does not let ordinary generation late success overwrite a timed-out failed task', async () => {
    const task = createPendingImageTask();
    mocks.taskState.task = task;
    let finishGenerate!: () => void;
    mocks.cancelRequest.mockReset();
    (generationAPIService.generate as any).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishGenerate = resolve;
      });
      return {
        url: '/__aitu_cache__/image/task-generic-generate.png',
        format: 'png',
        size: 1,
      };
    });

    renderHook(() => useTaskExecutor());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(generationAPIService.generate).toHaveBeenCalledTimes(1);
    expect(mocks.taskState.task?.status).toBe(TaskStatus.PROCESSING);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(generationAPIService.cancelRequest).toHaveBeenCalledWith(task.id);
    expect(mocks.taskState.task?.status).toBe(TaskStatus.FAILED);

    finishGenerate();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.taskState.task?.status).toBe(TaskStatus.FAILED);
    expect(mocks.taskState.task?.result).toBeUndefined();
  });
});
