/**
 * Asset Integration Service
 *
 * 素材库与任务队列的集成服务
 *
 * 注意：AI 生成的素材不再单独存储到素材库，
 * 而是直接从任务队列中读取已完成的任务。
 * 这样避免了数据重复存储。
 */

import { TaskType, type Task } from '../types/task.types';
import {
  AssetSource,
  AssetType,
  type Asset,
} from '../types/asset.types';

interface ApiEnvelope<T> {
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
  request_id: string;
}

type PlatformAssetVisibilityStatus =
  | 'normal'
  | 'discarded'
  | 'hidden'
  | 'deleted';

interface PlatformAssetVariant {
  exifRemoved: boolean;
  height: number;
  mimeType: string;
  sizeBytes: number;
  type: 'original' | 'provider_input' | 'thumb' | 'preview';
  url: string;
  width: number;
}

export interface PlatformAsset {
  id: string;
  projectId: string;
  assetKind: 'image' | 'mask' | 'preset';
  origin: 'upload' | 'generated' | 'mask' | 'preset';
  visibilityStatus: PlatformAssetVisibilityStatus;
  favorite: boolean;
  selected: boolean;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  variants: PlatformAssetVariant[];
}

export function getCurrentPlatformProjectId(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get('project_id');
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function isPlatformAsset(asset: Pick<Asset, 'platformAssetId'>): boolean {
  return Boolean(asset.platformAssetId);
}

export async function listPlatformAssets(
  projectId?: string | null
): Promise<Asset[]> {
  const search = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  const result = await request<{ assets: PlatformAsset[] }>(`/api/assets${search}`);
  return result.assets.map(platformAssetToAsset);
}

export async function uploadPlatformAsset(
  file: File | Blob,
  projectId: string,
  fallbackName: string
): Promise<Asset> {
  const form = new FormData();
  form.append('projectId', projectId);
  form.append(
    'file',
    file instanceof File ? file : new File([file], fallbackName, { type: file.type })
  );
  const result = await request<{ asset: PlatformAsset }>('/api/assets/upload', {
    body: form,
    method: 'POST',
  });
  return platformAssetToAsset(result.asset);
}

export async function softDeletePlatformAsset(assetId: string): Promise<void> {
  await request<{ asset: PlatformAsset }>(`/api/assets/${assetId}`, {
    method: 'DELETE',
  });
}

function platformAssetToAsset(asset: PlatformAsset): Asset {
  const original = asset.variants.find((variant) => variant.type === 'original');
  const providerInput = asset.variants.find(
    (variant) => variant.type === 'provider_input'
  );
  const thumb = asset.variants.find((variant) => variant.type === 'thumb');
  const preview = asset.variants.find((variant) => variant.type === 'preview');
  const displayVariant = thumb || preview || providerInput || original;

  return {
    contentHash: asset.sha256,
    createdAt: Date.parse(asset.createdAt),
    id: asset.id,
    mimeType: asset.mimeType,
    name: `平台资产 ${asset.id.slice(0, 8)}`,
    platformAssetId: asset.id,
    platformProjectId: asset.projectId,
    platformVisibilityStatus: asset.visibilityStatus,
    selected: asset.selected,
    size: asset.sizeBytes,
    source: asset.aiGenerated ? AssetSource.AI_GENERATED : AssetSource.LOCAL,
    thumbnail: thumb?.url,
    type: AssetType.IMAGE,
    url: displayVariant?.url || `/api/assets/${asset.id}/variants/original`,
    variantUrls: {
      original: original?.url,
      preview: preview?.url,
      providerInput: providerInput?.url,
      thumb: thumb?.url,
    },
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || envelope.error || !envelope.data) {
    throw new Error(envelope.error?.message ?? '平台资产请求失败');
  }
  return envelope.data;
}

/**
 * Generate a descriptive name for an AI-generated asset
 * 为 AI 生成的素材生成描述性名称
 */
export function generateAssetName(task: Task): string {
  const timestamp = new Date(task.createdAt).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(/\//g, '-').replace(/\s/g, '_');

  const promptPreview = task.params.prompt
    ? task.params.prompt.substring(0, 20).replace(/\s+/g, '_')
    : 'generated';

  const type = task.type === TaskType.IMAGE ? 'image' : 'video';

  return `AI_${type}_${timestamp}_${promptPreview}`;
}

/**
 * Initialize asset integration
 * 初始化素材集成服务
 *
 * 注意：不再需要自动保存逻辑，因为 AI 生成的素材直接从任务队列读取
 */
export function initializeAssetIntegration(): () => void {
  // console.log('[AssetIntegration] Asset integration initialized (no-op, AI assets read from task queue)');

  // Return cleanup function
  return () => {
    // console.log('[AssetIntegration] Asset integration cleanup');
  };
}
