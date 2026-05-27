import { describe, expect, it } from 'vitest';

import {
  normalizePlatformImageRatio,
  platformImageTaskToTaskPatch,
  withPlatformImageTaskMetadata,
  type PlatformImageTaskView,
} from '../platform-image-task-service';
import { TaskStatus, TaskType } from '../../types/task.types';

describe('platform image task service', () => {
  it('marks text-to-image queue payloads as platform task mirrors', () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');

    const payload = withPlatformImageTaskMetadata(
      {
        prompt: '一只小猫',
        generationMode: 'text_to_image',
        size: '16x9',
      },
      TaskType.IMAGE
    );

    expect(payload).toMatchObject({
      platformManagedImageTask: true,
      platformModelKey: 'mock-image-v1',
      platformOperationType: 'text_to_image',
      platformProjectId: 'project-1',
      platformRatio: '16:9',
    });
  });

  it('does not take over image edit or reference-image tasks', () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');

    const payload = withPlatformImageTaskMetadata(
      {
        prompt: '参考图生成',
        generationMode: 'image_edit',
        referenceImages: ['https://example.com/input.png'],
      },
      TaskType.IMAGE
    );

    expect(payload.platformManagedImageTask).toBeUndefined();
  });

  it('maps succeeded platform tasks into completed local task results', () => {
    const patch = platformImageTaskToTaskPatch(createPlatformTaskFixture());

    expect(patch.status).toBe(TaskStatus.COMPLETED);
    expect(patch.updates).toMatchObject({
      canvasSyncStatus: 'succeeded',
      platformAssetIds: ['asset-1'],
      platformTaskId: 'task-1',
      progress: 100,
      remoteId: 'task-1',
      result: {
        format: 'png',
        height: 512,
        resultKind: 'image',
        url: '/api/assets/asset-1/variants/original',
        urls: ['/api/assets/asset-1/variants/original'],
        width: 512,
      },
    });
  });

  it('normalizes platform ratios without expanding the supported contract', () => {
    expect(normalizePlatformImageRatio('9x16')).toBe('9:16');
    expect(normalizePlatformImageRatio('4x3')).toBe('1:1');
  });
});

function createPlatformTaskFixture(): PlatformImageTaskView {
  return {
    actualModelKey: 'mock-image-v1',
    actualProvider: 'mock',
    assets: [
      {
        aiGenerated: true,
        assetKind: 'image',
        createdAt: '2026-05-27T00:00:00.000Z',
        deletedAt: null,
        favorite: false,
        height: 512,
        id: 'asset-1',
        mimeType: 'image/png',
        origin: 'generated',
        projectId: 'project-1',
        selected: false,
        sha256: 'sha',
        sizeBytes: 68,
        updatedAt: '2026-05-27T00:00:00.000Z',
        variants: [
          {
            exifRemoved: true,
            height: 512,
            mimeType: 'image/png',
            sizeBytes: 68,
            type: 'original',
            url: '/api/assets/asset-1/variants/original',
            width: 512,
          },
          {
            exifRemoved: true,
            height: 128,
            mimeType: 'image/png',
            sizeBytes: 68,
            type: 'thumb',
            url: '/api/assets/asset-1/variants/thumb',
            width: 128,
          },
        ],
        visibilityStatus: 'normal',
        width: 512,
      },
    ],
    batchSize: 1,
    canvasSync: {
      assetIds: ['asset-1'],
      imageTaskId: 'task-1',
      projectId: 'project-1',
      retryCount: 0,
      status: 'succeeded',
    },
    canvasSyncStatus: 'succeeded',
    createdAt: '2026-05-27T00:00:00.000Z',
    failureCode: null,
    failureCount: 0,
    failureMessage: null,
    finalPrompt: '一只小猫',
    id: 'task-1',
    modelFamily: 'mock',
    modelVersion: '2026-05-27',
    operationType: 'text_to_image',
    optimizedPrompt: null,
    ownerUserId: 'user-1',
    priceVersion: 1,
    projectId: 'project-1',
    quotedPriceAmount: 10,
    quotedPriceUnit: 'points',
    ratio: '1:1',
    requestedModelKey: 'mock-image-v1',
    requestedProvider: 'mock',
    settledAt: '2026-05-27T00:00:00.000Z',
    settledPriceAmount: 10,
    status: 'succeeded',
    successCount: 1,
    updatedAt: '2026-05-27T00:00:00.000Z',
    userPrompt: '一只小猫',
  };
}
