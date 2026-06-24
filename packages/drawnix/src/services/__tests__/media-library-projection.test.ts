import { describe, expect, it } from 'vitest';
import {
  assetTaskRecordToAssets,
  assetToUnifiedMediaItem,
} from '../../components/media-library/media-library-projection';
import { TaskType } from '../../types/task.types';
import type { AssetTaskRecord } from '../task-storage-reader';

describe('media library generated image projection', () => {
  it('preserves Creative image contentUrl metadata through asset and preview item projection', () => {
    const record: AssetTaskRecord = {
      id: 'task-creative-image-1',
      type: TaskType.IMAGE,
      createdAt: 1,
      updatedAt: 2,
      completedAt: 3,
      remoteId: 'remote-creative-image-1',
      params: {
        prompt: '生成可恢复图片',
        model: 'mock:gpt-image-2:preview',
      },
      result: {
        url: '/__aitu_cache__/image/remote-creative-image-1.png',
        contentUrl:
          '/creative/relay/v1/images/tasks/remote-creative-image-1/content',
        mimeType: 'image/png',
        remoteTaskId: 'remote-creative-image-1',
        format: 'png',
        size: 123,
      },
    };

    const [asset] = assetTaskRecordToAssets(record);

    expect(asset).toMatchObject({
      id: 'task-creative-image-1',
      taskId: 'task-creative-image-1',
      url: '/__aitu_cache__/image/remote-creative-image-1.png',
      contentUrl:
        '/creative/relay/v1/images/tasks/remote-creative-image-1/content',
      remoteTaskId: 'remote-creative-image-1',
      providerTaskId: 'remote-creative-image-1',
      mimeType: 'image/png',
    });

    const preview = assetToUnifiedMediaItem(asset);

    expect(preview).toMatchObject({
      id: 'task-creative-image-1',
      url: '/__aitu_cache__/image/remote-creative-image-1.png',
      rehydrateCacheUrl: '/__aitu_cache__/image/remote-creative-image-1.png',
      rehydrateSourceUrl:
        '/creative/relay/v1/images/tasks/remote-creative-image-1/content',
      rehydrateMetadata: {
        taskId: 'task-creative-image-1',
        remoteTaskId: 'remote-creative-image-1',
        providerTaskId: 'remote-creative-image-1',
        contentUrl:
          '/creative/relay/v1/images/tasks/remote-creative-image-1/content',
        mimeType: 'image/png',
      },
    });
  });

  it('derives preview rehydrate content URL from remoteTaskId when contentUrl is missing', () => {
    const record: AssetTaskRecord = {
      id: 'task-creative-image-remote-only',
      type: TaskType.IMAGE,
      createdAt: 1,
      updatedAt: 2,
      completedAt: 3,
      remoteId: 'remote-creative-image-only',
      params: {
        prompt: '生成可恢复图片',
        model: 'mock:gpt-image-2:preview',
      },
      result: {
        url: '/__aitu_cache__/image/remote-creative-image-only.png',
        mimeType: 'image/png',
        remoteTaskId: 'remote-creative-image-only',
        format: 'png',
        size: 123,
      },
    };

    const [asset] = assetTaskRecordToAssets(record);
    expect(asset.contentUrl).toBeUndefined();
    expect(asset.remoteTaskId).toBe('remote-creative-image-only');

    const preview = assetToUnifiedMediaItem(asset);

    expect(preview).toMatchObject({
      rehydrateCacheUrl: '/__aitu_cache__/image/remote-creative-image-only.png',
      rehydrateSourceUrl:
        '/creative/relay/v1/images/tasks/remote-creative-image-only/content',
      rehydrateMetadata: expect.objectContaining({
        remoteTaskId: 'remote-creative-image-only',
        contentUrl:
          '/creative/relay/v1/images/tasks/remote-creative-image-only/content',
      }),
    });
  });

  it('uses thumbnailUrls before thumbnailUrl and previewImageUrl for projected image previews', () => {
    const record: AssetTaskRecord = {
      id: 'task-creative-image-thumb',
      type: TaskType.IMAGE,
      createdAt: 1,
      updatedAt: 2,
      completedAt: 3,
      params: {
        prompt: '生成缩略图',
        model: 'mock:gpt-image-2:preview',
      },
      result: {
        url: '/__aitu_cache__/image/original.png',
        thumbnailUrls: ['/__aitu_cache__/image/thumb-small.png'],
        thumbnailUrl: '/__aitu_cache__/image/thumb-single.png',
        previewImageUrl: '/__aitu_cache__/image/preview.png',
        format: 'png',
        size: 123,
      },
    };

    const [asset] = assetTaskRecordToAssets(record);
    const preview = assetToUnifiedMediaItem(asset);

    expect(asset.thumbnail).toBe('/__aitu_cache__/image/thumb-small.png');
    expect(preview.posterUrl).toBe('/__aitu_cache__/image/thumb-small.png');
  });

  it('preserves Creative video content metadata through preview projection', () => {
    const record: AssetTaskRecord = {
      id: 'task-creative-video-1',
      type: TaskType.VIDEO,
      createdAt: 1,
      updatedAt: 2,
      completedAt: 3,
      remoteId: 'remote-creative-video-1',
      params: {
        prompt: '生成可恢复视频',
        model: 'mock:sora:preview',
      },
      result: {
        url: '/__aitu_cache__/video/remote-creative-video-1.mp4',
        contentUrl: '/creative/relay/v1/videos/remote-creative-video-1/content',
        mimeType: 'video/mp4',
        remoteTaskId: 'remote-creative-video-1',
        providerTaskId: 'provider-creative-video-1',
        format: 'mp4',
        size: 123,
      },
    };

    const [asset] = assetTaskRecordToAssets(record);

    expect(asset).toMatchObject({
      id: 'task-creative-video-1',
      taskId: 'task-creative-video-1',
      type: 'VIDEO',
      url: '/__aitu_cache__/video/remote-creative-video-1.mp4',
      contentUrl: '/creative/relay/v1/videos/remote-creative-video-1/content',
      remoteTaskId: 'remote-creative-video-1',
      providerTaskId: 'provider-creative-video-1',
      mimeType: 'video/mp4',
    });

    const preview = assetToUnifiedMediaItem(asset);

    expect(preview).toMatchObject({
      id: 'task-creative-video-1',
      type: 'video',
      url: '/__aitu_cache__/video/remote-creative-video-1.mp4',
      rehydrateCacheUrl: '/__aitu_cache__/video/remote-creative-video-1.mp4',
      rehydrateSourceUrl:
        '/creative/relay/v1/videos/remote-creative-video-1/content',
      rehydrateMetadata: {
        taskId: 'task-creative-video-1',
        remoteTaskId: 'remote-creative-video-1',
        providerTaskId: 'provider-creative-video-1',
        contentUrl: '/creative/relay/v1/videos/remote-creative-video-1/content',
        mimeType: 'video/mp4',
      },
    });
  });
});
