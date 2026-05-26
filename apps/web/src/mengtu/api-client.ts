import type {
  ApiEnvelope,
  AssetSummary,
  CanvasBootContext,
  HomeSummary,
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
  const search = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  const result = await request<{ assets: AssetSummary[] }>(`/api/assets${search}`);
  return result.assets;
}

export async function uploadAsset(
  projectId: string,
  file: File
): Promise<AssetSummary> {
  const form = new FormData();
  form.append('projectId', projectId);
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
