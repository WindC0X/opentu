import { randomUUID } from 'crypto';

import type { AuthenticatedSession } from '../auth/types';
import { DEFAULT_TENANT_ID } from '../auth/types';
import { AppError } from '../errors';
import type { ProjectRepository } from '../projects/types';
import { buildAssetObjectKey } from '../storage/object-keys';
import type { StorageService } from '../storage/types';
import {
  inspectImage,
  sanitizeImageForProvider,
  sha256,
} from './image-metadata';
import type {
  Asset,
  AssetRepository,
  AssetVariant,
  AssetVariantType,
  AssetView,
  AuditWriter,
} from './types';

interface AssetServiceOptions {
  maxUploadBytes?: number;
  now?: () => Date;
  storagePrefix?: string;
  tenantId?: string;
}

interface UploadAssetInput {
  body: Buffer;
  fileName: string;
  mimeType: string;
  projectId: string;
}

export interface GeneratedAssetInput {
  body: Buffer;
  candidateIndex: number;
  jobId?: string | null;
  mimeType: string;
  modelKey: string;
  modelVersion: string;
  projectId: string;
  provider: string;
  taskId: string;
}

interface VariantReadResult {
  asset: Asset;
  body: Buffer;
  variant: AssetVariant;
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class AssetService {
  private readonly maxUploadBytes: number;
  private readonly now: () => Date;
  private readonly storagePrefix: string;
  private readonly tenantId: string;

  constructor(
    private readonly assetRepository: AssetRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly storage: StorageService,
    private readonly auditWriter: AuditWriter,
    options: AssetServiceOptions = {}
  ) {
    this.maxUploadBytes = options.maxUploadBytes ?? 10 * 1024 * 1024;
    this.now = options.now ?? (() => new Date());
    this.storagePrefix = options.storagePrefix ?? 'mengtu';
    this.tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  }

  async uploadAsset(
    auth: AuthenticatedSession,
    input: UploadAssetInput
  ): Promise<{ asset: AssetView }> {
    this.assertUploadFile(input);
    const project = await this.projectRepository.findProjectById(
      this.tenantId,
      input.projectId
    );
    if (!project || project.deletedAt || project.status !== 'active') {
      throw new AppError('PROJECT_NOT_FOUND', 404, '项目不存在');
    }
    if (project.ownerUserId !== auth.user.id) {
      throw new AppError('FORBIDDEN', 403, '无权访问该项目');
    }

    const metadata = inspectImage(input.body);
    if (metadata.mimeType !== input.mimeType) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, '图片 MIME 不匹配');
    }

    const assetId = randomUUID();
    const createdAt = this.now();
    const providerInput = sanitizeImageForProvider(
      input.body,
      metadata.mimeType
    );
    const variants = [
      {
        body: input.body,
        exifRemoved: false,
        height: metadata.height,
        type: 'original' as const,
        width: metadata.width,
      },
      {
        body: providerInput,
        exifRemoved: true,
        height: metadata.height,
        type: 'provider_input' as const,
        width: metadata.width,
      },
      {
        body: providerInput,
        exifRemoved: true,
        height: Math.min(metadata.height, 512),
        type: 'thumb' as const,
        width: Math.min(metadata.width, 512),
      },
    ];

    const variantRecords = [];
    for (const variant of variants) {
      const storageKey = buildAssetObjectKey({
        assetId,
        mimeType: metadata.mimeType,
        prefix: this.storagePrefix,
        projectId: project.id,
        tenantId: this.tenantId,
        userId: auth.user.id,
        variantType: variant.type,
      });
      await this.storage.putObject({
        body: variant.body,
        contentType: metadata.mimeType,
        key: storageKey,
      });
      variantRecords.push({
        assetId,
        createdAt,
        exifRemoved: variant.exifRemoved,
        height: variant.height,
        mimeType: metadata.mimeType,
        sha256: sha256(variant.body),
        sizeBytes: variant.body.byteLength,
        storageKey,
        tenantId: this.tenantId,
        variantType: variant.type,
        width: variant.width,
      });
    }

    const record = await this.assetRepository.createAssetWithVariants(
      {
        aigcMetadataStatus: 'not_applicable',
        aiGenerated: false,
        assetKind: 'image',
        createdAt,
        favorite: false,
        height: metadata.height,
        id: assetId,
        mimeType: metadata.mimeType,
        origin: 'upload',
        ownerUserId: auth.user.id,
        projectId: project.id,
        selected: false,
        sha256: metadata.sha256,
        sizeBytes: metadata.sizeBytes,
        tenantId: this.tenantId,
        updatedAt: createdAt,
        visibilityStatus: 'normal',
        width: metadata.width,
      },
      variantRecords
    );

    return { asset: toAssetView(record.asset, record.variants) };
  }

  async listAssets(
    auth: AuthenticatedSession,
    input: { projectId?: string } = {}
  ): Promise<{ assets: AssetView[] }> {
    const records = await this.assetRepository.listAssets({
      ownerUserId: auth.user.id,
      projectId: input.projectId,
      tenantId: this.tenantId,
    });
    return {
      assets: records.map((record) => toAssetView(record.asset, record.variants)),
    };
  }

  async createGeneratedAssets(
    auth: AuthenticatedSession,
    inputs: GeneratedAssetInput[]
  ): Promise<{ assets: AssetView[] }> {
    const assets: AssetView[] = [];
    for (const input of inputs) {
      const record = await this.createGeneratedAsset(auth, input);
      assets.push(record.asset);
    }
    return { assets };
  }

  async getAsset(
    auth: AuthenticatedSession,
    assetId: string
  ): Promise<{ asset: AssetView }> {
    const asset = await this.requireReadableAsset(auth, assetId, true);
    const variants = await this.assetRepository.listVariants(
      this.tenantId,
      asset.id
    );
    return { asset: toAssetView(asset, variants) };
  }

  async readVariant(
    auth: AuthenticatedSession,
    assetId: string,
    variantType: AssetVariantType
  ): Promise<VariantReadResult> {
    const asset = await this.requireReadableAsset(auth, assetId, false);
    const variant = await this.assetRepository.findVariant(
      this.tenantId,
      asset.id,
      variantType
    );
    if (!variant) {
      throw new AppError('ASSET_NOT_FOUND', 404, '资产不存在或不可访问');
    }

    if (
      auth.user.role === 'admin' &&
      auth.user.id !== asset.ownerUserId &&
      variant.variantType === 'original'
    ) {
      await this.auditWriter.createAuditLog({
        action: 'asset.original.read',
        actorUserId: auth.user.id,
        metadata: {
          assetId: asset.id,
          ownerUserId: asset.ownerUserId,
          projectId: asset.projectId,
          variantType: variant.variantType,
        },
        targetId: asset.id,
        targetType: 'asset',
        tenantId: this.tenantId,
      });
    }

    const object = await this.storage.getObject(variant.storageKey);
    return {
      asset,
      body: object.body,
      variant,
    };
  }

  async updateAsset(
    auth: AuthenticatedSession,
    assetId: string,
    input: {
      favorite?: boolean;
      selected?: boolean;
      visibilityStatus?: 'normal' | 'discarded' | 'hidden';
    }
  ): Promise<{ asset: AssetView }> {
    const asset = await this.requireReadableAsset(auth, assetId, true);
    if (input.visibilityStatus === 'hidden' && auth.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }

    const updated = await this.assetRepository.updateAsset(asset.id, {
      favorite: input.favorite,
      selected: input.selected,
      updatedAt: this.now(),
      visibilityStatus: input.visibilityStatus,
    });
    const variants = await this.assetRepository.listVariants(
      this.tenantId,
      updated.id
    );
    return { asset: toAssetView(updated, variants) };
  }

  async softDeleteAsset(
    auth: AuthenticatedSession,
    assetId: string
  ): Promise<{ asset: AssetView }> {
    const asset = await this.requireReadableAsset(auth, assetId, true);
    const deletedAt = this.now();
    const updated = await this.assetRepository.updateAsset(asset.id, {
      deletedAt,
      updatedAt: deletedAt,
      visibilityStatus: 'deleted',
    });
    const variants = await this.assetRepository.listVariants(
      this.tenantId,
      updated.id
    );
    return { asset: toAssetView(updated, variants) };
  }

  async restoreAsset(
    auth: AuthenticatedSession,
    assetId: string
  ): Promise<{ asset: AssetView }> {
    if (auth.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }
    const asset = await this.requireReadableAsset(auth, assetId, true);
    const updated = await this.assetRepository.updateAsset(asset.id, {
      deletedAt: null,
      updatedAt: this.now(),
      visibilityStatus: 'normal',
    });
    const variants = await this.assetRepository.listVariants(
      this.tenantId,
      updated.id
    );
    return { asset: toAssetView(updated, variants) };
  }

  private async createGeneratedAsset(
    auth: AuthenticatedSession,
    input: GeneratedAssetInput
  ): Promise<{ asset: AssetView }> {
    const project = await this.projectRepository.findProjectById(
      this.tenantId,
      input.projectId
    );
    if (!project || project.deletedAt || project.status !== 'active') {
      throw new AppError('PROJECT_NOT_FOUND', 404, '项目不存在');
    }
    if (project.ownerUserId !== auth.user.id) {
      throw new AppError('FORBIDDEN', 403, '无权访问该项目');
    }

    const metadata = inspectImage(input.body);
    if (metadata.mimeType !== input.mimeType) {
      throw new AppError('ASSET_PERSIST_FAILED', 500, '供应商图片 MIME 不匹配');
    }

    const assetId = randomUUID();
    const createdAt = this.now();
    const providerInput = sanitizeImageForProvider(
      input.body,
      metadata.mimeType
    );
    const variants = [
      {
        body: input.body,
        exifRemoved: false,
        height: metadata.height,
        type: 'original' as const,
        width: metadata.width,
      },
      {
        body: providerInput,
        exifRemoved: true,
        height: metadata.height,
        type: 'provider_input' as const,
        width: metadata.width,
      },
      {
        body: providerInput,
        exifRemoved: true,
        height: Math.min(metadata.height, 512),
        type: 'thumb' as const,
        width: Math.min(metadata.width, 512),
      },
    ];

    const variantRecords = [];
    for (const variant of variants) {
      const storageKey = buildAssetObjectKey({
        assetId,
        mimeType: metadata.mimeType,
        prefix: this.storagePrefix,
        projectId: project.id,
        tenantId: this.tenantId,
        userId: auth.user.id,
        variantType: variant.type,
      });
      await this.storage.putObject({
        body: variant.body,
        contentType: metadata.mimeType,
        key: storageKey,
      });
      variantRecords.push({
        assetId,
        createdAt,
        createdByJobId: input.jobId ?? null,
        exifRemoved: variant.exifRemoved,
        height: variant.height,
        mimeType: metadata.mimeType,
        sha256: sha256(variant.body),
        sizeBytes: variant.body.byteLength,
        storageKey,
        tenantId: this.tenantId,
        variantType: variant.type,
        width: variant.width,
      });
    }

    const record = await this.assetRepository.createAssetWithVariants(
      {
        aigcMetadataStatus: 'removed',
        aiGenerated: true,
        assetKind: 'image',
        createdAt,
        favorite: false,
        generationTaskId: input.taskId,
        height: metadata.height,
        id: assetId,
        mimeType: metadata.mimeType,
        modelKey: input.modelKey,
        modelVersion: input.modelVersion,
        origin: 'generated',
        ownerUserId: auth.user.id,
        projectId: project.id,
        provider: input.provider,
        selected: false,
        sha256: metadata.sha256,
        sizeBytes: metadata.sizeBytes,
        tenantId: this.tenantId,
        updatedAt: createdAt,
        visibilityStatus: 'normal',
        width: metadata.width,
      },
      variantRecords
    );

    await this.assetRepository.createAssetRelation({
      candidateIndex: input.candidateIndex,
      relationType: 'result',
      resultAssetId: record.asset.id,
      taskId: input.taskId,
      tenantId: this.tenantId,
    });

    return { asset: toAssetView(record.asset, record.variants) };
  }

  private assertUploadFile(input: UploadAssetInput): void {
    if (input.body.byteLength <= 0) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, '上传文件为空');
    }
    if (input.body.byteLength > this.maxUploadBytes) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, '图片超过大小限制');
    }
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, '不支持的图片格式');
    }
    if (!hasAllowedExtension(input.fileName, input.mimeType)) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, '图片扩展名不匹配');
    }
  }

  private async requireReadableAsset(
    auth: AuthenticatedSession,
    assetId: string,
    includeDeleted: boolean
  ): Promise<Asset> {
    const asset = await this.assetRepository.findAssetById(
      this.tenantId,
      assetId
    );
    if (!asset) {
      throw new AppError('ASSET_NOT_FOUND', 404, '资产不存在或不可访问');
    }
    if (asset.ownerUserId !== auth.user.id && auth.user.role !== 'admin') {
      throw new AppError('ASSET_NOT_FOUND', 404, '资产不存在或不可访问');
    }
    if (!includeDeleted && asset.visibilityStatus === 'deleted') {
      throw new AppError('ASSET_NOT_FOUND', 404, '资产不存在或不可访问');
    }
    return asset;
  }
}

export function toAssetView(asset: Asset, variants: AssetVariant[]): AssetView {
  return {
    aigcMetadataStatus: asset.aigcMetadataStatus,
    aiGenerated: asset.aiGenerated,
    assetKind: asset.assetKind,
    createdAt: asset.createdAt,
    deletedAt: asset.deletedAt,
    favorite: asset.favorite,
    height: asset.height,
    id: asset.id,
    mimeType: asset.mimeType,
    origin: asset.origin,
    projectId: asset.projectId,
    selected: asset.selected,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    updatedAt: asset.updatedAt,
    variants: variants.map((variant) => ({
      exifRemoved: variant.exifRemoved,
      height: variant.height,
      mimeType: variant.mimeType,
      sizeBytes: variant.sizeBytes,
      type: variant.variantType,
      url: `/api/assets/${asset.id}/variants/${variant.variantType}`,
      width: variant.width,
    })),
    visibilityStatus: asset.visibilityStatus,
    width: asset.width,
  };
}

function hasAllowedExtension(fileName: string, mimeType: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (!extension) {
    return false;
  }
  if (mimeType === 'image/jpeg') {
    return extension === 'jpg' || extension === 'jpeg';
  }
  if (mimeType === 'image/png') {
    return extension === 'png';
  }
  if (mimeType === 'image/webp') {
    return extension === 'webp';
  }
  return false;
}
