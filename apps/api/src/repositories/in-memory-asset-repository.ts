import { randomUUID } from 'crypto';

import { AppError } from '../errors';
import type {
  Asset,
  AssetRelation,
  AssetRepository,
  AssetVariant,
  AssetVariantType,
  CreateAssetRelationInput,
  CreateAssetInput,
  CreateAssetVariantInput,
  UpdateAssetInput,
} from '../assets/types';

export class InMemoryAssetRepository implements AssetRepository {
  readonly assets = new Map<string, Asset>();
  readonly relations = new Map<string, AssetRelation>();
  readonly variants = new Map<string, AssetVariant>();

  async createAssetRelation(
    input: CreateAssetRelationInput
  ): Promise<AssetRelation> {
    const relation: AssetRelation = {
      candidateIndex: input.candidateIndex ?? null,
      createdAt: new Date(),
      id: randomUUID(),
      maskAssetId: input.maskAssetId ?? null,
      referenceAssetId: input.referenceAssetId ?? null,
      referenceRole: input.referenceRole ?? null,
      relationType: input.relationType,
      resultAssetId: input.resultAssetId,
      sourceAssetId: input.sourceAssetId ?? null,
      taskId: input.taskId,
      tenantId: input.tenantId,
    };
    this.relations.set(relation.id, relation);
    return relation;
  }

  async createAssetWithVariants(
    input: CreateAssetInput,
    variants: CreateAssetVariantInput[]
  ): Promise<{ asset: Asset; variants: AssetVariant[] }> {
    const asset: Asset = {
      aigcMetadataStatus: input.aigcMetadataStatus,
      aiGenerated: input.aiGenerated,
      assetKind: input.assetKind,
      createdAt: input.createdAt,
      deletedAt: input.deletedAt ?? null,
      favorite: input.favorite,
      generationTaskId: input.generationTaskId ?? null,
      hasProviderWatermark: input.hasProviderWatermark ?? null,
      height: input.height,
      id: input.id,
      mimeType: input.mimeType,
      modelKey: input.modelKey ?? null,
      modelVersion: input.modelVersion ?? null,
      origin: input.origin,
      ownerUserId: input.ownerUserId,
      projectId: input.projectId,
      provider: input.provider ?? null,
      selected: input.selected,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      tenantId: input.tenantId,
      updatedAt: input.updatedAt,
      visibilityStatus: input.visibilityStatus,
      width: input.width,
    };
    const variantRecords = variants.map((variant) => ({
      assetId: variant.assetId,
      createdAt: variant.createdAt,
      createdByJobId: variant.createdByJobId ?? null,
      exifRemoved: variant.exifRemoved,
      height: variant.height,
      id: randomUUID(),
      mimeType: variant.mimeType,
      sha256: variant.sha256,
      sizeBytes: variant.sizeBytes,
      storageKey: variant.storageKey,
      tenantId: variant.tenantId,
      variantType: variant.variantType,
      width: variant.width,
    }));

    this.assets.set(asset.id, asset);
    for (const variant of variantRecords) {
      this.variants.set(variant.id, variant);
    }
    return { asset, variants: variantRecords };
  }

  async findAssetById(tenantId: string, assetId: string): Promise<Asset | null> {
    const asset = this.assets.get(assetId);
    return asset?.tenantId === tenantId ? asset : null;
  }

  async findVariant(
    tenantId: string,
    assetId: string,
    variantType: AssetVariantType
  ): Promise<AssetVariant | null> {
    return (
      [...this.variants.values()].find(
        (variant) =>
          variant.tenantId === tenantId &&
          variant.assetId === assetId &&
          variant.variantType === variantType
      ) ?? null
    );
  }

  async listAssets(input: {
    includeDeleted?: boolean;
    ownerUserId: string;
    projectId?: string;
    tenantId: string;
  }): Promise<Array<{ asset: Asset; variants: AssetVariant[] }>> {
    return [...this.assets.values()]
      .filter(
        (asset) =>
          asset.tenantId === input.tenantId &&
          asset.ownerUserId === input.ownerUserId &&
          (!input.projectId || asset.projectId === input.projectId) &&
          (input.includeDeleted || asset.visibilityStatus !== 'deleted')
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((asset) => ({
        asset,
        variants: this.listVariantsSync(input.tenantId, asset.id),
      }));
  }

  async listAdminAssets(input: {
    includeDeleted?: boolean;
    ownerUserId?: string;
    projectId?: string;
    tenantId: string;
  }): Promise<Array<{ asset: Asset; variants: AssetVariant[] }>> {
    return [...this.assets.values()]
      .filter(
        (asset) =>
          asset.tenantId === input.tenantId &&
          (!input.ownerUserId || asset.ownerUserId === input.ownerUserId) &&
          (!input.projectId || asset.projectId === input.projectId) &&
          (input.includeDeleted || asset.visibilityStatus !== 'deleted')
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((asset) => ({
        asset,
        variants: this.listVariantsSync(input.tenantId, asset.id),
      }));
  }

  async listAssetsByTask(
    tenantId: string,
    taskId: string
  ): Promise<Array<{ asset: Asset; variants: AssetVariant[] }>> {
    const resultAssetIds = new Set(
      [...this.relations.values()]
        .filter(
          (relation) =>
            relation.tenantId === tenantId && relation.taskId === taskId
        )
        .map((relation) => relation.resultAssetId)
    );
    return [...this.assets.values()]
      .filter(
        (asset) => asset.tenantId === tenantId && resultAssetIds.has(asset.id)
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((asset) => ({
        asset,
        variants: this.listVariantsSync(tenantId, asset.id),
      }));
  }

  async listVariants(
    tenantId: string,
    assetId: string
  ): Promise<AssetVariant[]> {
    return this.listVariantsSync(tenantId, assetId);
  }

  async updateAsset(id: string, patch: UpdateAssetInput): Promise<Asset> {
    const asset = this.assets.get(id);
    if (!asset) {
      throw new AppError('ASSET_NOT_FOUND', 404, '资产不存在或不可访问');
    }
    const updated: Asset = {
      ...asset,
      ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt } : {}),
      ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
      ...(patch.selected !== undefined ? { selected: patch.selected } : {}),
      ...(patch.visibilityStatus !== undefined
        ? { visibilityStatus: patch.visibilityStatus }
        : {}),
      updatedAt: patch.updatedAt,
    };
    this.assets.set(id, updated);
    return updated;
  }

  private listVariantsSync(tenantId: string, assetId: string): AssetVariant[] {
    return [...this.variants.values()]
      .filter(
        (variant) =>
          variant.tenantId === tenantId && variant.assetId === assetId
      )
      .sort((a, b) => a.variantType.localeCompare(b.variantType));
  }
}
