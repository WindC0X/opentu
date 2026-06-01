import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    cancelTask: vi.fn(),
    clearCompletedTasks: vi.fn(),
    clearFailedTasks: vi.fn(),
    createTask: vi.fn(),
    deleteTask: vi.fn(),
    getAllTasks: vi.fn(() => []),
    getTask: vi.fn(),
    observeTaskUpdates: vi.fn(() => ({ subscribe: vi.fn() })),
    restoreTasks: vi.fn(),
    retryTask: vi.fn(),
  },
}));

vi.mock('../../services/task-storage-reader', () => ({
  taskStorageReader: {
    getAllTasks: vi.fn(() => Promise.resolve([])),
    isAvailable: vi.fn(() => Promise.resolve(false)),
  },
}));

vi.mock('../../services/asset-integration-service', () => ({
  getCurrentPlatformProjectId: vi.fn(() => null),
}));

import { filterScopedTaskQueueTasks } from '../useTaskQueue';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';

describe('filterScopedTaskQueueTasks', () => {
  it('keeps non-platform local tasks when no platform project context exists', () => {
    const localTask = createTask({ id: 'local-task' });

    expect(filterScopedTaskQueueTasks([localTask], null)).toEqual([localTask]);
  });

  it('shows only platform task mirrors matching the current project', () => {
    const matchingTask = createTask({
      id: 'platform-current',
      params: {
        platformManagedImageTask: true,
        platformProjectId: 'project-1',
      },
    });
    const otherProjectTask = createTask({
      id: 'platform-other',
      params: {
        platformManagedImageTask: true,
        platformProjectId: 'project-2',
      },
    });
    const localTask = createTask({ id: 'local-task' });

    expect(
      filterScopedTaskQueueTasks(
        [matchingTask, otherProjectTask, localTask],
        'project-1'
      ).map((task) => task.id)
    ).toEqual(['platform-current']);
  });

  it('hides platform task mirrors when project context is missing', () => {
    const platformTask = createTask({
      id: 'platform-history',
      params: {
        platformManagedImageTask: true,
        platformProjectId: 'project-1',
      },
    });
    const localTask = createTask({ id: 'local-task' });

    expect(
      filterScopedTaskQueueTasks([platformTask, localTask], null).map(
        (task) => task.id
      )
    ).toEqual(['local-task']);
  });
});

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    createdAt: 1,
    id: 'task-1',
    params: {
      prompt: 'test prompt',
      ...(overrides.params ?? {}),
    },
    status: TaskStatus.PENDING,
    type: TaskType.IMAGE,
    updatedAt: 1,
    ...overrides,
  };
}
