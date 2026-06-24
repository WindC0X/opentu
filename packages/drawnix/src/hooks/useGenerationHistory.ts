/**
 * useGenerationHistory Hook
 *
 * Provides generation history from task queue data.
 * Replaces the old localStorage-based history management.
 */

import { useMemo } from 'react';
import { useTaskQueue } from './useTaskQueue';
import { TaskType, TaskStatus } from '../types/task.types';
import {
  ImageHistoryItem,
  VideoHistoryItem,
  HistoryItem
} from '../components/generation-history/generation-history';
import { resolveGeneratedImageContentUrl } from '../utils/generated-media-cache';

function getImageHistoryRehydrateMetadata(task: {
  id: string;
  remoteId?: string;
  params: { prompt: string; model?: string };
  result?: {
    contentUrl?: string;
    remoteTaskId?: string;
    providerTaskId?: string;
    mimeType?: string;
  };
}): { sourceUrl?: string; metadata?: Record<string, unknown> } {
  const contentUrl = resolveGeneratedImageContentUrl({
    contentUrl: task.result?.contentUrl,
    remoteTaskId: task.result?.remoteTaskId,
    providerTaskId: task.result?.providerTaskId,
    taskRemoteId: task.remoteId,
  });
  if (!contentUrl) {
    return {};
  }

  return {
    sourceUrl: contentUrl,
    metadata: {
      taskId: task.id,
      remoteTaskId: task.result?.remoteTaskId || task.remoteId,
      providerTaskId:
        task.result?.providerTaskId || task.result?.remoteTaskId || task.remoteId,
      contentUrl,
      mimeType: task.result?.mimeType,
      prompt: task.params.prompt,
      model: task.params.model,
    },
  };
}

/**
 * Hook for accessing generation history
 * History is derived from completed tasks in the task queue
 *
 * @returns Object containing image and video history arrays
 */
export function useGenerationHistory() {
  const { completedTasks } = useTaskQueue();

  // Convert completed image tasks to history items
  const imageHistory = useMemo((): ImageHistoryItem[] => {
    return completedTasks
      .filter(task => task.type === TaskType.IMAGE && task.result?.url)
      .map(task => {
        const rehydrate = getImageHistoryRehydrateMetadata(task);
        return {
          id: task.id,
          type: 'image' as const,
          prompt: task.params.prompt,
          timestamp: task.completedAt || task.createdAt,
          imageUrl: task.result!.url,
          width: task.result!.width || 1024,
          height: task.result!.height || 1024,
          uploadedImages: task.params.uploadedImages, // 包含参考图片
          rehydrateSourceUrl: rehydrate.sourceUrl,
          rehydrateMetadata: rehydrate.metadata,
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }, [completedTasks]);

  // Convert completed video tasks to history items
  const videoHistory = useMemo((): VideoHistoryItem[] => {
    return completedTasks
      .filter(task => task.type === TaskType.VIDEO && task.result?.url)
      .map(task => ({
        id: task.id,
        type: 'video' as const,
        prompt: task.params.prompt,
        timestamp: task.completedAt || task.createdAt,
        imageUrl:
          task.result!.thumbnailUrl ||
          task.result!.thumbnailUrls?.[0] ||
          task.result!.previewImageUrl, // Use an actual image/poster thumbnail only
        width: task.result!.width || 400,
        height: task.result!.height || 225,
        duration: task.result!.duration,
        previewUrl: task.result!.url,
        downloadUrl: task.result!.url,
        uploadedImage: task.params.uploadedImage, // 包含参考图片
      }))
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }, [completedTasks]);

  // Combined history (both images and videos)
  const allHistory = useMemo((): HistoryItem[] => {
    return [...imageHistory, ...videoHistory]
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [imageHistory, videoHistory]);

  return {
    imageHistory,
    videoHistory,
    allHistory,
  };
}
