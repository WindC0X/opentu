import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SWTask,
  TaskStorageWriteGuard,
} from '../media-executor/task-storage-writer';
import { taskStorageWriter } from '../media-executor/task-storage-writer';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createTask(overrides: Partial<SWTask> = {}): SWTask {
  return {
    id: 'task-1',
    type: 'image',
    status: 'processing',
    params: {
      prompt: 'A cat',
      retryAttempt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    progress: 10,
    executionPhase: 'submitting',
    ...overrides,
  };
}

describe('taskStorageWriter guarded progress writes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips stale progress writes when retryAttempt guard no longer matches', async () => {
    const saveTask = vi
      .spyOn(taskStorageWriter, 'saveTask')
      .mockResolvedValue(undefined);
    vi.spyOn(taskStorageWriter, 'getTask').mockResolvedValue(createTask());

    await taskStorageWriter.updateProgress('task-1', 95, 'polling', {
      expectedRetryAttempt: 0,
    });

    expect(saveTask).not.toHaveBeenCalled();
  });

  it('applies guarded progress writes when retryAttempt still matches', async () => {
    const saveTask = vi
      .spyOn(taskStorageWriter, 'saveTask')
      .mockResolvedValue(undefined);
    vi.spyOn(taskStorageWriter, 'getTask').mockResolvedValue(createTask());

    await taskStorageWriter.updateProgress('task-1', 95, 'polling', {
      expectedRetryAttempt: 1,
    });

    expect(saveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        progress: 95,
        executionPhase: 'polling',
      })
    );
  });

  it('does not let late progress writes mutate terminal tasks', async () => {
    const saveTask = vi
      .spyOn(taskStorageWriter, 'saveTask')
      .mockResolvedValue(undefined);
    vi.spyOn(taskStorageWriter, 'getTask').mockResolvedValue(
      createTask({
        status: 'completed',
        progress: 100,
        executionPhase: 'completed',
      })
    );

    await taskStorageWriter.updateProgress('task-1', 95, 'polling');

    expect(saveTask).not.toHaveBeenCalled();
  });

  it('skips stale progress writes when startedAt guard no longer matches', async () => {
    const saveTask = vi
      .spyOn(taskStorageWriter, 'saveTask')
      .mockResolvedValue(undefined);
    vi.spyOn(taskStorageWriter, 'getTask').mockResolvedValue(
      createTask({
        startedAt: 200,
      })
    );

    const guard: TaskStorageWriteGuard = {
      expectedRetryAttempt: 1,
      expectedStartedAt: 100,
    };

    await taskStorageWriter.updateProgress('task-1', 95, 'polling', guard);

    expect(saveTask).not.toHaveBeenCalled();
  });

  it('returns false and skips stale status writes when startedAt guard no longer matches', async () => {
    const saveTask = vi
      .spyOn(taskStorageWriter, 'saveTask')
      .mockResolvedValue(undefined);
    vi.spyOn(taskStorageWriter, 'getTask').mockResolvedValue(
      createTask({
        startedAt: 200,
      })
    );

    const guard: TaskStorageWriteGuard = {
      expectedRetryAttempt: 1,
      expectedStartedAt: 100,
    };

    const written = await taskStorageWriter.updateStatus(
      'task-1',
      'processing',
      guard
    );

    expect(written).toBe(false);
    expect(saveTask).not.toHaveBeenCalled();
  });

  it('returns false and does not reopen terminal tasks on late status writes', async () => {
    const saveTask = vi
      .spyOn(taskStorageWriter, 'saveTask')
      .mockResolvedValue(undefined);
    vi.spyOn(taskStorageWriter, 'getTask').mockResolvedValue(
      createTask({
        status: 'completed',
        progress: 100,
        executionPhase: 'completed',
      })
    );

    const written = await taskStorageWriter.updateStatus(
      'task-1',
      'processing'
    );

    expect(written).toBe(false);
    expect(saveTask).not.toHaveBeenCalled();
  });

  it('returns true when a guarded status write matches the active attempt', async () => {
    const saveTask = vi
      .spyOn(taskStorageWriter, 'saveTask')
      .mockResolvedValue(undefined);
    vi.spyOn(taskStorageWriter, 'getTask').mockResolvedValue(
      createTask({
        startedAt: 100,
      })
    );

    const guard: TaskStorageWriteGuard = {
      expectedRetryAttempt: 1,
      expectedStartedAt: 100,
    };

    const written = await taskStorageWriter.updateStatus(
      'task-1',
      'processing',
      guard
    );

    expect(written).toBe(true);
    expect(saveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-1',
        status: 'processing',
        startedAt: 100,
      })
    );
  });

  it('serializes concurrent terminal writes so the first terminal state wins', async () => {
    let storedTask = createTask({ startedAt: 100 });
    vi.spyOn(taskStorageWriter, 'getTask').mockImplementation(async () =>
      clone(storedTask)
    );
    vi.spyOn(taskStorageWriter, 'saveTask').mockImplementation(async (task) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      storedTask = clone(task);
    });

    const completePromise = taskStorageWriter.completeTask(
      'task-1',
      {
        url: '/__aitu_cache__/image/task-1.png',
        format: 'png',
        size: 1,
      },
      {
        expectedRetryAttempt: 1,
        expectedStartedAt: 100,
      }
    );
    const failPromise = taskStorageWriter.failTask(
      'task-1',
      {
        code: 'LATE_FAILURE',
        message: 'late provider failure',
      },
      {
        expectedRetryAttempt: 1,
        expectedStartedAt: 100,
      }
    );

    await expect(Promise.all([completePromise, failPromise])).resolves.toEqual([
      true,
      false,
    ]);
    expect(storedTask.status).toBe('completed');
    expect(storedTask.result?.url).toBe('/__aitu_cache__/image/task-1.png');
    expect(storedTask.error).toBeUndefined();
  });
});
