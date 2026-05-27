import { useEffect, useRef } from 'react';
import { taskQueueService } from '../services/task-queue';
import {
  createPlatformImageTaskFromLocalTask,
  getPlatformImageTask,
  isPlatformManagedImageTask,
  platformImageTaskToTaskPatch,
} from '../services/platform-image-task-service';
import { TaskStatus, type Task } from '../types/task.types';

const POLL_INTERVAL_MS = 1500;

export function usePlatformImageTaskSync(): void {
  const inflightTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let isActive = true;

    const applyPlatformTask = (
      localTaskId: string,
      platformTask: Parameters<typeof platformImageTaskToTaskPatch>[0]
    ) => {
      if (!isActive) {
        return;
      }
      const localTask = taskQueueService.getTask(localTaskId);
      if (!localTask) {
        return;
      }
      const patch = platformImageTaskToTaskPatch(platformTask);
      if (
        localTask.status === TaskStatus.CANCELLED &&
        patch.status !== TaskStatus.CANCELLED
      ) {
        return;
      }
      taskQueueService.updateTaskStatus(localTaskId, patch.status, patch.updates);
    };

    const failLocalTask = (task: Task, error: unknown) => {
      if (!isActive) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      taskQueueService.updateTaskStatus(task.id, TaskStatus.FAILED, {
        canvasSyncStatus: 'not_required',
        error: {
          code: 'PLATFORM_IMAGE_TASK_SYNC_FAILED',
          message,
          details: {
            originalError: message,
            timestamp: Date.now(),
          },
        },
      });
    };

    const syncTask = async (task: Task) => {
      if (!shouldSyncPlatformTask(task)) {
        return;
      }
      if (inflightTaskIdsRef.current.has(task.id)) {
        return;
      }

      inflightTaskIdsRef.current.add(task.id);
      try {
        const platformTask = task.platformTaskId
          ? await getPlatformImageTask(task.platformTaskId)
          : await createPlatformImageTaskFromLocalTask(task);
        applyPlatformTask(task.id, platformTask);
      } catch (error) {
        failLocalTask(task, error);
      } finally {
        inflightTaskIdsRef.current.delete(task.id);
      }
    };

    const scanTasks = () => {
      if (!isActive) {
        return;
      }
      taskQueueService.getAllTasks().forEach((task) => {
        syncTask(task).catch((error) => failLocalTask(task, error));
      });
    };

    const subscription = taskQueueService.observeTaskUpdates().subscribe((event) => {
      syncTask(event.task).catch((error) => failLocalTask(event.task, error));
    });
    const timer = window.setInterval(scanTasks, POLL_INTERVAL_MS);
    scanTasks();

    return () => {
      isActive = false;
      subscription.unsubscribe();
      window.clearInterval(timer);
      inflightTaskIdsRef.current.clear();
    };
  }, []);
}

function shouldSyncPlatformTask(task: Task): boolean {
  if (!isPlatformManagedImageTask(task)) {
    return false;
  }
  if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.PROCESSING) {
    return false;
  }
  return true;
}
