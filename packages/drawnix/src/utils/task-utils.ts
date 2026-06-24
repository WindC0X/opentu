/**
 * Task Utility Functions
 *
 * Provides helper functions for task management including ID generation,
 * status checking, timeout detection, and duration formatting.
 */

import {
  Task,
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
} from '../types/task.types';
import {
  CREATIVE_REMOTE_IMAGE_TIMEOUT_MS,
  TASK_TIMEOUT,
} from '../constants/TASK_CONSTANTS';
import {
  isAsyncImageModel,
  isCreativeManagedImageTask,
} from '../constants/model-config';
import { generateUUID } from './runtime-helpers';

/**
 * Generates a unique task ID using UUID v4 algorithm
 *
 * @returns A unique task identifier string
 *
 * @example
 * generateTaskId() // Returns "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateTaskId(): string {
  return generateUUID();
}

/**
 * Checks if a task is in an active state (pending or processing)
 *
 * @param task - The task to check
 * @returns True if the task is active, false otherwise
 *
 * @example
 * isTaskActive({ status: 'processing' }) // Returns true
 * isTaskActive({ status: 'completed' }) // Returns false
 */
export function isTaskActive(task: Task): boolean {
  return (
    task.status === TaskStatus.PENDING || task.status === TaskStatus.PROCESSING
  );
}

function hasAsyncImageInvocationRoute(
  task: Pick<Task, 'invocationRoute'>
): boolean {
  const binding = task.invocationRoute?.binding;
  return (
    task.invocationRoute?.operation === 'image' &&
    (binding?.protocol === 'openai.async.media' ||
      binding?.requestSchema === 'openai.async.image.form')
  );
}

function hasCreativeManagedImageInvocationRoute(
  task: Pick<Task, 'invocationRoute'>
): boolean {
  const binding = task.invocationRoute?.binding;
  if (task.invocationRoute?.operation !== 'image') {
    return false;
  }
  return (
    task.invocationRoute.providerProfileId === 'new-api-creative' ||
    binding?.protocol === 'session-broker' ||
    binding?.requestSchema === 'new-api.creative.image.task' ||
    binding?.submitPath === '/images/tasks' ||
    binding?.pollPathTemplate === '/images/tasks/{taskId}'
  );
}

function hasCreativeManagedImageParams(task: Pick<Task, 'params'>): boolean {
  return (
    isCreativeManagedImageTask(task.params) ||
    task.params?.modelRef?.profileId === 'new-api-creative'
  );
}

/**
 * Checks whether an image task can resume polling after page reload.
 *
 * Dynamic provider models may not be listed in ASYNC_IMAGE_MODEL_IDS, so the
 * persisted invocation binding is the source of truth once a remoteId exists.
 */
export function isResumableAsyncImageTask(
  task: Pick<Task, 'type' | 'remoteId' | 'params' | 'invocationRoute'>
): boolean {
  return (
    task.type === TaskType.IMAGE &&
    Boolean(task.remoteId) &&
    (isAsyncImageModel(task.params?.model) ||
      hasAsyncImageInvocationRoute(task) ||
      hasCreativeManagedImageInvocationRoute(task) ||
      hasCreativeManagedImageParams(task))
  );
}

export function isCreativeManagedRemoteImageTask(
  task: Pick<Task, 'type' | 'remoteId' | 'params' | 'invocationRoute'>
): boolean {
  return (
    task.type === TaskType.IMAGE &&
    Boolean(task.remoteId) &&
    (hasCreativeManagedImageInvocationRoute(task) ||
      hasCreativeManagedImageParams(task))
  );
}

export function isRecoverableCreativeManagedImageSubmissionTask(
  task: Pick<
    Task,
    | 'status'
    | 'type'
    | 'remoteId'
    | 'executionPhase'
    | 'params'
    | 'invocationRoute'
  >
): boolean {
  return (
    task.status === TaskStatus.PROCESSING &&
    task.type === TaskType.IMAGE &&
    !task.remoteId &&
    task.executionPhase === TaskExecutionPhase.SUBMITTING &&
    (hasCreativeManagedImageInvocationRoute(task) ||
      hasCreativeManagedImageParams(task))
  );
}

export function isRecoverableCreativeManagedImageSubmitFailure(
  task: Pick<
    Task,
    | 'status'
    | 'type'
    | 'remoteId'
    | 'executionPhase'
    | 'params'
    | 'invocationRoute'
    | 'error'
  >
): boolean {
  return (
    task.status === TaskStatus.FAILED &&
    task.type === TaskType.IMAGE &&
    !task.remoteId &&
    task.executionPhase === TaskExecutionPhase.SUBMITTING &&
    task.error?.code === 'INTERRUPTED_DURING_SUBMISSION' &&
    (hasCreativeManagedImageInvocationRoute(task) ||
      hasCreativeManagedImageParams(task))
  );
}

/**
 * Checks if a task has exceeded its timeout limit
 *
 * @param task - The task to check
 * @returns True if the task has timed out, false otherwise
 *
 * @example
 * const task = { type: 'image', startedAt: Date.now() - 16 * 60 * 1000 };
 * isTaskTimeout(task) // Returns true (started > 15 minutes ago)
 */
export function isTaskTimeout(task: Task): boolean {
  if (!task.startedAt || task.status !== TaskStatus.PROCESSING) {
    return false;
  }

  if (isCreativeManagedRemoteImageTask(task)) {
    return false;
  }

  if (isRecoverableCreativeManagedImageSubmissionTask(task)) {
    return false;
  }

  const timeout =
    task.type === TaskType.IMAGE && isResumableAsyncImageTask(task)
      ? CREATIVE_REMOTE_IMAGE_TIMEOUT_MS
      : getTaskTimeout(task.type);
  const elapsed = Date.now() - task.startedAt;

  return elapsed > timeout;
}

export function isRecoverableRemoteTaskFailure(
  task: Pick<
    Task,
    'status' | 'type' | 'remoteId' | 'params' | 'invocationRoute' | 'error'
  >
): boolean {
  if (task.status !== TaskStatus.FAILED || !task.remoteId) {
    return false;
  }
  const errorCode = task.error?.code || '';
  if (
    errorCode === 'INTERRUPTED' ||
    errorCode === 'INTERRUPTED_DURING_SUBMISSION' ||
    errorCode === 'RESUME_FAILED'
  ) {
    return (
      task.type === TaskType.VIDEO ||
      task.type === TaskType.AUDIO ||
      isResumableAsyncImageTask(task)
    );
  }

  return (
    errorCode === 'TIMEOUT' &&
    ((task.type === TaskType.IMAGE && isCreativeManagedRemoteImageTask(task)) ||
      task.type === TaskType.VIDEO ||
      task.type === TaskType.AUDIO)
  );
}

/**
 * Gets the timeout duration for a specific task type
 *
 * @param taskType - The type of task
 * @returns Timeout duration in milliseconds
 *
 * @example
 * getTaskTimeout('image') // Returns 900000 (15 minutes)
 * getTaskTimeout('video') // Returns 1800000 (30 minutes)
 */
export function getTaskTimeout(taskType: TaskType): number {
  return (
    TASK_TIMEOUT[taskType.toUpperCase() as keyof typeof TASK_TIMEOUT] ||
    TASK_TIMEOUT.IMAGE
  );
}

/**
 * Formats a duration in milliseconds to a human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 *
 * @example
 * formatTaskDuration(1500) // Returns "1s"
 * formatTaskDuration(65000) // Returns "1m 5s"
 * formatTaskDuration(3665000) // Returns "1h 1m 5s"
 */
export function formatTaskDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Calculates the elapsed time since a task was created
 *
 * @param task - The task to calculate elapsed time for
 * @returns Elapsed time in milliseconds
 */
export function getTaskElapsedTime(task: Task): number {
  if (task.completedAt) {
    return task.completedAt - task.createdAt;
  }
  return Date.now() - task.createdAt;
}

/**
 * Formats a timestamp to a localized date-time string
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted date-time string (e.g., "2025-12-18 14:30:25")
 *
 * @example
 * formatDateTime(Date.now()) // Returns "2025-12-18 14:30:25"
 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
