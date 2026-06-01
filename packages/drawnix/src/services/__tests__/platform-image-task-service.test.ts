import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPlatformImageTaskFromLocalTask,
  normalizePlatformImageRatio,
  optimizePlatformPrompt,
  platformImageTaskToTaskPatch,
  quotePlatformImageTask,
  quotePlatformPromptOptimization,
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

  it('keeps the selected platform model when mirroring text-to-image tasks', () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');

    const payload = withPlatformImageTaskMetadata(
      {
        generationMode: 'text_to_image',
        model: 'grsai-image-v1',
        prompt: '一只小猫',
        size: '16x9',
      },
      TaskType.IMAGE
    );

    expect(payload).toMatchObject({
      platformManagedImageTask: true,
      platformModelKey: 'grsai-image-v1',
      platformOperationType: 'text_to_image',
      platformProjectId: 'project-1',
      platformRatio: '16:9',
    });
  });

  it('creates platform image tasks with the selected model key', async () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');
    const requests: Array<{ body?: unknown; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ body: init?.body, url });
        if (url === '/api/image-tasks') {
          const body = JSON.parse(String(init?.body));
          return jsonResponse({
            task: {
              ...createPlatformTaskFixture(),
              actualModelKey: body.modelKey,
              requestedModelKey: body.modelKey,
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
          generationMode: 'text_to_image',
          model: 'grsai-image-v1',
          prompt: '一只小猫',
          size: '16x9',
        },
        TaskType.IMAGE
      ),
      status: TaskStatus.PENDING,
      type: TaskType.IMAGE,
      updatedAt: 1,
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      modelKey: 'grsai-image-v1',
      operationType: 'text_to_image',
      projectId: 'project-1',
      ratio: '16:9',
    });
    expect(task.requestedModelKey).toBe('grsai-image-v1');
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

  it('quotes image tasks with the selected model key and platform parameters', async () => {
    const requests: Array<{ body?: unknown; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ body: init?.body, url });
        if (url === '/api/image-tasks/quote') {
          return jsonResponse({
            quote: {
              amount: 40,
              batchSize: 4,
              modelKey: 'grsai-image-v1',
              operationType: 'text_to_image',
              pricePolicyId: 'price-policy-1',
              priceVersion: 1,
              ratio: '9:16',
              referenceAssets: [],
              sourceAssetId: null,
              unit: 'points',
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const quote = await quotePlatformImageTask({
      batchSize: 4,
      modelKey: 'grsai-image-v1',
      operationType: 'text_to_image',
      projectId: 'project-1',
      ratio: '9:16',
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      batchSize: 4,
      modelKey: 'grsai-image-v1',
      operationType: 'text_to_image',
      projectId: 'project-1',
      ratio: '9:16',
    });
    expect(quote).toMatchObject({
      amount: 40,
      modelKey: 'grsai-image-v1',
      operationType: 'text_to_image',
    });
  });

  it('normalizes platform quote batch size to the platform contract', async () => {
    const requests: Array<{ body?: unknown; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ body: init?.body, url });
        if (url === '/api/image-tasks/quote') {
          const body = JSON.parse(String(init?.body));
          return jsonResponse({
            quote: {
              amount: 20,
              batchSize: body.batchSize,
              modelKey: 'grsai-image-v1',
              operationType: 'text_to_image',
              pricePolicyId: 'price-policy-1',
              priceVersion: 1,
              ratio: '1:1',
              referenceAssets: [],
              sourceAssetId: null,
              unit: 'points',
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const quote = await quotePlatformImageTask({
      batchSize: 3,
      modelKey: 'grsai-image-v1',
      operationType: 'text_to_image',
      projectId: 'project-1',
      ratio: '1:1',
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      batchSize: 1,
      modelKey: 'grsai-image-v1',
    });
    expect(quote.batchSize).toBe(1);
  });

  it('quotes and creates prompt optimization tasks through the Image Task API', async () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');
    const requests: Array<{ body?: unknown; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ body: init?.body, url });
        if (url === '/api/image-tasks/quote') {
          return jsonResponse({
            quote: {
              amount: 2,
              batchSize: 1,
              modelKey: 'mock-image-v1',
              operationType: 'prompt_optimize',
              pricePolicyId: 'price-policy-1',
              priceVersion: 1,
              ratio: '1:1',
              referenceAssets: [],
              sourceAssetId: null,
              unit: 'points',
            },
          });
        }
        if (url === '/api/image-tasks') {
          const body = JSON.parse(String(init?.body));
          return jsonResponse({
            task: {
              ...createPlatformTaskFixture(),
              assets: [],
              canvasSync: null,
              canvasSyncStatus: 'not_required',
              finalPrompt: '平台优化结果',
              id: 'prompt-task-1',
              operationType: body.operationType,
              optimizedPrompt: '平台优化结果',
              quotedPriceAmount: 2,
              settledPriceAmount: 2,
              status: 'succeeded',
              successCount: 1,
              userPrompt: body.prompt,
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const quote = await quotePlatformPromptOptimization({ prompt: '一只小猫' });
    const result = await optimizePlatformPrompt({
      idempotencyKey: 'prompt-optimize-1',
      prompt: '一只小猫',
    });

    expect(quote).toMatchObject({
      amount: 2,
      operationType: 'prompt_optimize',
    });
    expect(result).toMatchObject({
      optimizedPrompt: '平台优化结果',
      taskId: 'prompt-task-1',
    });
    expect(requests.map((request) => JSON.parse(String(request.body)))).toEqual(
      [
        expect.objectContaining({
          operationType: 'prompt_optimize',
          projectId: 'project-1',
        }),
        expect.objectContaining({
          idempotencyKey: 'prompt-optimize-1',
          operationType: 'prompt_optimize',
          prompt: '一只小猫',
          projectId: 'project-1',
        }),
      ]
    );
  });

  it('surfaces prompt optimization task failures without applying a draft', async () => {
    window.history.pushState({}, '', '/canvas?project_id=project-1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          task: {
            ...createPlatformTaskFixture(),
            assets: [],
            canvasSync: null,
            canvasSyncStatus: 'not_required',
            failureMessage: 'Prompt optimization failed',
            operationType: 'prompt_optimize',
            optimizedPrompt: null,
            status: 'failed',
            successCount: 0,
          },
        })
      )
    );

    await expect(
      optimizePlatformPrompt({ prompt: '一只小猫' })
    ).rejects.toThrow('Prompt optimization failed');
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
