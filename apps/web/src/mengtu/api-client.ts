import type {
  ApiEnvelope,
  AssetSummary,
  CanvasBootContext,
  HomeSummary,
  ImageModelSummary,
  ImageTaskQuote,
  ImageTaskOperationType,
  ImageTaskReferenceAssetInput,
  ImageTaskSummary,
  ProjectSummary,
} from './types';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function getHomeSummary(): Promise<HomeSummary> {
  return request<HomeSummary>('/api/home/summary');
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const result = await request<{ projects: ProjectSummary[] }>('/api/projects');
  return result.projects;
}

export async function createProject(title: string): Promise<ProjectSummary> {
  const result = await request<{ project: ProjectSummary }>('/api/projects', {
    body: JSON.stringify({ title }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return result.project;
}

export async function openProjectCanvas(
  projectId: string
): Promise<CanvasBootContext> {
  return request<CanvasBootContext>(`/api/projects/${projectId}/open-canvas`, {
    body: JSON.stringify({}),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

export async function listAssets(projectId?: string): Promise<AssetSummary[]> {
  const search = projectId
    ? `?project_id=${encodeURIComponent(projectId)}`
    : '';
  const result = await request<{ assets: AssetSummary[] }>(
    `/api/assets${search}`
  );
  return result.assets;
}

export async function listImageModels(): Promise<ImageModelSummary[]> {
  const result = await request<{ models: ImageModelSummary[] }>('/api/models');
  return result.models;
}

export async function quoteImageTask(input: {
  batchSize: 1 | 2 | 4;
  maskAssetId?: string | null;
  modelKey: string;
  operationType?: ImageTaskOperationType;
  projectId?: string;
  ratio: string;
  referenceAssets?: ImageTaskReferenceAssetInput[];
  sourceAssetId?: string | null;
}): Promise<ImageTaskQuote> {
  const result = await request<{ quote: ImageTaskQuote }>(
    '/api/image-tasks/quote',
    {
      body: JSON.stringify({
        batchSize: input.batchSize,
        maskAssetId: input.maskAssetId ?? null,
        modelKey: input.modelKey,
        operationType: input.operationType ?? 'text_to_image',
        projectId: input.projectId,
        ratio: input.ratio,
        referenceAssets: input.referenceAssets ?? [],
        sourceAssetId: input.sourceAssetId ?? null,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
  return result.quote;
}

export async function createImageTask(input: {
  batchSize: 1 | 2 | 4;
  idempotencyKey: string;
  maskAssetId?: string | null;
  modelKey: string;
  operationType?: ImageTaskOperationType;
  prompt: string;
  projectId: string;
  promptOptimize?: boolean;
  ratio: string;
  referenceAssets?: ImageTaskReferenceAssetInput[];
  sourceAssetId?: string | null;
}): Promise<ImageTaskSummary> {
  const result = await request<{ task: ImageTaskSummary }>('/api/image-tasks', {
    body: JSON.stringify({
      batchSize: input.batchSize,
      idempotencyKey: input.idempotencyKey,
      maskAssetId: input.maskAssetId ?? null,
      modelKey: input.modelKey,
      operationType: input.operationType ?? 'text_to_image',
      prompt: input.prompt,
      projectId: input.projectId,
      promptOptimize: input.promptOptimize ?? false,
      ratio: input.ratio,
      referenceAssets: input.referenceAssets ?? [],
      sourceAssetId: input.sourceAssetId ?? null,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return result.task;
}

export async function getImageTask(taskId: string): Promise<ImageTaskSummary> {
  const result = await request<{ task: ImageTaskSummary }>(
    `/api/image-tasks/${encodeURIComponent(taskId)}`
  );
  return result.task;
}

export async function listProjectImageTasks(
  projectId: string
): Promise<ImageTaskSummary[]> {
  const result = await request<{ tasks: ImageTaskSummary[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/image-tasks`
  );
  return result.tasks;
}

export async function cancelImageTask(
  taskId: string
): Promise<ImageTaskSummary> {
  const result = await request<{ task: ImageTaskSummary }>(
    `/api/image-tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: 'POST' }
  );
  return result.task;
}

export async function retryImageTask(
  taskId: string
): Promise<ImageTaskSummary> {
  const result = await request<{ task: ImageTaskSummary }>(
    `/api/image-tasks/${encodeURIComponent(taskId)}/retry`,
    { method: 'POST' }
  );
  return result.task;
}

export async function insertImageTaskToCanvas(
  taskId: string
): Promise<ImageTaskSummary> {
  const result = await request<{ task: ImageTaskSummary }>(
    `/api/image-tasks/${encodeURIComponent(taskId)}/insert-to-canvas`,
    { method: 'POST' }
  );
  return result.task;
}

export async function uploadAsset(
  projectId: string,
  file: File,
  assetKind?: 'image' | 'mask'
): Promise<AssetSummary> {
  const form = new FormData();
  form.append('projectId', projectId);
  if (assetKind) {
    form.append('assetKind', assetKind);
  }
  form.append('file', file);
  const result = await request<{ asset: AssetSummary }>('/api/assets/upload', {
    body: form,
    method: 'POST',
  });
  return result.asset;
}

export async function deleteAsset(assetId: string): Promise<AssetSummary> {
  const result = await request<{ asset: AssetSummary }>(
    `/api/assets/${assetId}`,
    { method: 'DELETE' }
  );
  return result.asset;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || envelope.error || !envelope.data) {
    throw new ApiClientError(
      envelope.error?.code ?? 'REQUEST_FAILED',
      envelope.error?.message ?? '请求失败',
      response.status
    );
  }

  return envelope.data;
}
