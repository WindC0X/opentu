// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';

function createSubmittingCreativeImageTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-submit-refresh-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    executionPhase: TaskExecutionPhase.SUBMITTING,
    params: {
      prompt: 'Refresh during submit',
      model: 'managed-image-binding',
      creativeManaged: true,
      userParams: {},
    },
    invocationRoute: {
      operation: 'image',
      modelId: 'managed-image-binding',
      providerProfileId: 'new-api-creative',
      binding: {
        protocol: 'session-broker',
        requestSchema: 'new-api.creative.image.task',
        submitPath: '/images/tasks',
        pollPathTemplate: '/images/tasks/{taskId}',
      },
    },
    createdAt: 1,
    startedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('useTaskStorage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock('../../services/task-queue');
    vi.doUnmock('../../services/task-storage-reader');
    vi.doUnmock('../../services/app-database');
  });

  it('resumes Creative managed image submit interruptions through the managed executor path', async () => {
    const storedTask = createSubmittingCreativeImageTask();
    const restoreTasks = vi.fn();
    const resumeSubmitInterruptedTask = vi.fn();
    const updateTaskStatus = vi.fn();

    vi.doMock('../../services/task-queue', () => ({
      taskQueueService: {
        restoreTasks,
        resumeSubmitInterruptedTask,
      },
      legacyTaskQueueService: {
        updateTaskStatus,
      },
    }));
    vi.doMock('../../services/task-storage-reader', () => ({
      taskStorageReader: {
        getAllTasks: vi.fn(async () => [storedTask]),
      },
    }));
    vi.doMock('../../services/app-database', () => ({
      migrateFromLegacyDB: vi.fn(async () => undefined),
    }));

    const { useTaskStorage } = await import('../useTaskStorage');
    const { result } = renderHook(() => useTaskStorage());

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current).toBe(true);
    expect(restoreTasks).toHaveBeenCalledWith([storedTask]);
    expect(resumeSubmitInterruptedTask).toHaveBeenCalledWith(storedTask.id);
    expect(updateTaskStatus).not.toHaveBeenCalledWith(
      storedTask.id,
      TaskStatus.PENDING,
      expect.anything()
    );
    expect(updateTaskStatus).not.toHaveBeenCalledWith(
      storedTask.id,
      TaskStatus.FAILED,
      expect.anything()
    );
  });
});
