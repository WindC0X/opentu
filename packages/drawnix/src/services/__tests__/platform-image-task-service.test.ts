import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPlatformImageTaskFromLocalTask,
  normalizePlatformImageRatio,
  platformImageTaskToTaskPatch,
  resolvePlatformOperationType,
  withPlatformImageTaskMetadata,
  type PlatformImageTaskView,
} from '../platform-image-task-service';
import { TaskStatus, TaskType } from '../../types/task.types';

describe('platform image task service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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

  it('takes over image edit and reference-image tasks with S08 operation metadata', () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');

    const inpaintPayload = withPlatformImageTaskMetadata(
      {
        prompt: '参考图生成',
        generationMode: 'image_edit',
        referenceImages: ['https://example.com/input.png'],
        maskImage: 'https://example.com/mask.png',
      },
      TaskType.IMAGE
    );
    const referencePayload = withPlatformImageTaskMetadata(
      {
        prompt: '多参考图生成',
        referenceImages: [
          'https://example.com/a.png',
          'https://example.com/b.png',
        ],
      },
      TaskType.IMAGE
    );

    expect(inpaintPayload).toMatchObject({
      platformManagedImageTask: true,
      platformOperationType: 'inpaint',
      platformProjectId: 'project-1',
    });
    expect(referencePayload).toMatchObject({
      platformManagedImageTask: true,
      platformOperationType: 'reference_generate',
      platformProjectId: 'project-1',
    });
    expect(
      resolvePlatformOperationType({
        generationMode: 'image_to_image',
        prompt: '图生图',
        referenceImages: ['https://example.com/source.png'],
      })
    ).toBe('image_to_image');
  });

  it('uploads source and mask images before creating an inpaint platform task', async () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');
    const requests: Array<{ body?: unknown; url: string }> = [];
    let uploadCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ body: init?.body, url });
        if (url.startsWith('https://example.com/')) {
          return new Response(new Blob(['png'], { type: 'image/png' }), {
            status: 200,
          });
        }
        if (url === '/api/assets/upload') {
          const form = init?.body as FormData;
          const assetKind = form.get('assetKind') === 'mask' ? 'mask' : 'image';
          uploadCount += 1;
          return jsonResponse({
            asset: createPlatformAssetFixture(
              `${assetKind}-asset-${uploadCount}`,
              assetKind
            ),
          });
        }
        if (url === '/api/image-tasks') {
          const body = JSON.parse(String(init?.body));
          return jsonResponse({
            task: {
              ...createPlatformTaskFixture(),
              maskAssetId: body.maskAssetId,
              operationType: body.operationType,
              referenceAssets: body.referenceAssets,
              sourceAssetId: body.sourceAssetId,
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const task = await createPlatformImageTaskFromLocalTask({
      createdAt: 1,
      id: 'local-task-1',
      params: withPlatformImageTaskMetadata(
        {
          generationMode: 'image_edit',
          maskImage: 'https://example.com/mask.png',
          prompt: '局部重绘',
          referenceImages: ['https://example.com/source.png'],
        },
        TaskType.IMAGE
      ),
      status: TaskStatus.PENDING,
      type: TaskType.IMAGE,
      updatedAt: 1,
    });

    const createRequest = requests.find(
      (request) => request.url === '/api/image-tasks'
    );
    expect(JSON.parse(String(createRequest?.body))).toMatchObject({
      maskAssetId: 'mask-asset-2',
      operationType: 'inpaint',
      sourceAssetId: 'image-asset-1',
    });
    expect(task).toMatchObject({
      maskAssetId: 'mask-asset-2',
      operationType: 'inpaint',
      sourceAssetId: 'image-asset-1',
    });
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
    maskAssetId: null,
    operationType: 'text_to_image',
    optimizedPrompt: null,
    ownerUserId: 'user-1',
    priceVersion: 1,
    projectId: 'project-1',
    quotedPriceAmount: 10,
    quotedPriceUnit: 'points',
    ratio: '1:1',
    referenceAssets: [],
    requestedModelKey: 'mock-image-v1',
    requestedProvider: 'mock',
    settledAt: '2026-05-27T00:00:00.000Z',
    settledPriceAmount: 10,
    sourceAssetId: null,
    status: 'succeeded',
    successCount: 1,
    updatedAt: '2026-05-27T00:00:00.000Z',
    userPrompt: '一只小猫',
  };
}

function createPlatformAssetFixture(
  id: string,
  assetKind: 'image' | 'mask'
): PlatformImageTaskView['assets'][number] {
  return {
    aiGenerated: false,
    assetKind,
    createdAt: '2026-05-27T00:00:00.000Z',
    deletedAt: null,
    favorite: false,
    height: 512,
    id,
    mimeType: 'image/png',
    origin: assetKind === 'mask' ? 'mask' : 'upload',
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
        url: `/api/assets/${id}/variants/original`,
        width: 512,
      },
    ],
    visibilityStatus: 'normal',
    width: 512,
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(
    JSON.stringify({ data, error: null, request_id: 'test-request' }),
    {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }
  );
}
