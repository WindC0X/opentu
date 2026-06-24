import { describe, expect, it } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
  type Task,
} from '../../types/task.types';
import {
  isCreativeManagedRemoteImageTask,
  isRecoverableCreativeManagedImageSubmissionTask,
  isRecoverableRemoteTaskFailure,
  isResumableAsyncImageTask,
  isTaskTimeout,
} from '../task-utils';

function createImageTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.PROCESSING,
    params: {
      prompt: 'draw a cat',
      model: 'custom-dynamic-image-model',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('task-utils', () => {
  describe('isResumableAsyncImageTask', () => {
    it('uses persisted async image binding as resumable source of truth', () => {
      const task = createImageTask({
        remoteId: 'remote-task-1',
        invocationRoute: {
          operation: 'image',
          modelId: 'custom-dynamic-image-model',
          binding: {
            protocol: 'openai.async.media',
            requestSchema: 'openai.async.image.form',
            pollPathTemplate: '/videos/{taskId}',
          },
        },
      });

      expect(isResumableAsyncImageTask(task)).toBe(true);
    });

    it('does not resume ordinary image tasks without a remote task id', () => {
      const task = createImageTask({
        invocationRoute: {
          operation: 'image',
          binding: {
            protocol: 'openai.async.media',
            requestSchema: 'openai.async.image.form',
          },
        },
      });

      expect(isResumableAsyncImageTask(task)).toBe(false);
    });

    it('does not treat sync image bindings as resumable async work', () => {
      const task = createImageTask({
        remoteId: 'remote-task-1',
        invocationRoute: {
          operation: 'image',
          binding: {
            protocol: 'openai.images.generations',
            requestSchema: 'openai.image.basic-json',
          },
        },
      });

      expect(isResumableAsyncImageTask(task)).toBe(false);
    });

    it('recognizes Creative managed session-broker image tasks with remote ids as resumable', () => {
      const task = createImageTask({
        remoteId: 'creative-remote-task-1',
        params: {
          prompt: 'draw a cat',
          model: 'managed-image-binding',
          modelRef: {
            profileId: 'new-api-creative',
            modelId: 'managed-image-binding',
          },
          creativeManaged: true,
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
      });

      expect(isResumableAsyncImageTask(task)).toBe(true);
      expect(isCreativeManagedRemoteImageTask(task)).toBe(true);
      expect(
        isTaskTimeout({
          ...task,
          startedAt: Date.now() - 48 * 60 * 60 * 1000,
        })
      ).toBe(false);
    });
  });

  describe('isRecoverableRemoteTaskFailure', () => {
    it('treats Creative managed TIMEOUT failures with remote ids as recoverable', () => {
      const task = createImageTask({
        status: TaskStatus.FAILED,
        remoteId: 'creative-remote-task-1',
        error: {
          code: 'TIMEOUT',
          message: '任务执行超时',
        },
        params: {
          prompt: 'draw a cat',
          model: 'managed-image-binding',
          creativeManaged: true,
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
      });

      expect(isRecoverableRemoteTaskFailure(task)).toBe(true);
    });

    it('does not recover ordinary provider failures with remote ids', () => {
      const task = createImageTask({
        status: TaskStatus.FAILED,
        remoteId: 'creative-remote-task-1',
        error: {
          code: 'HTTP_400',
          message: 'provider rejected request',
        },
        params: {
          prompt: 'draw a cat',
          model: 'managed-image-binding',
          creativeManaged: true,
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
      });

      expect(isRecoverableRemoteTaskFailure(task)).toBe(false);
    });
  });

  describe('isRecoverableCreativeManagedImageSubmissionTask', () => {
    it('treats refresh during Creative managed image submit as recoverable by original idempotency key', () => {
      const task = createImageTask({
        status: TaskStatus.PROCESSING,
        remoteId: undefined,
        executionPhase: TaskExecutionPhase.SUBMITTING,
        params: {
          prompt: 'draw a cat',
          model: 'managed-image-binding',
          creativeManaged: true,
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
      });

      expect(isRecoverableCreativeManagedImageSubmissionTask(task)).toBe(true);
      expect(
        isTaskTimeout({
          ...task,
          startedAt: Date.now() - 48 * 60 * 60 * 1000,
        })
      ).toBe(false);
    });

    it('does not recover ordinary image submit interruptions without Creative managed identity', () => {
      const task = createImageTask({
        status: TaskStatus.PROCESSING,
        remoteId: undefined,
        executionPhase: TaskExecutionPhase.SUBMITTING,
      });

      expect(isRecoverableCreativeManagedImageSubmissionTask(task)).toBe(false);
    });
  });
});
