import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

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
import * as schema from '../db/schema';
import { AppError } from '../errors';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleAssetRepository implements AssetRepository {
  constructor(private readonly db: Db) {}

  async createAssetRelation(
    input: CreateAssetRelationInput
  ): Promise<AssetRelation> {
    const [row] = await this.db
      .insert(schema.mtAssetRelations)
      .values({
        candidateIndex: input.candidateIndex ?? null,
        maskAssetId: input.maskAssetId ?? null,
        referenceAssetId: input.referenceAssetId ?? null,
        referenceRole: input.referenceRole ?? null,
        relationType: input.relationType,
        resultAssetId: input.resultAssetId,
        sourceAssetId: input.sourceAssetId ?? null,
        taskId: input.taskId,
        tenantId: input.tenantId,
      })
      .returning();
    return mapRelation(requireRow(row));
  }

  async createAssetWithVariants(
    input: CreateAssetInput,
    variants: CreateAssetVariantInput[]
  ): Promise<{ asset: Asset; variants: AssetVariant[] }> {
    const [assetRow] = await this.db
      .insert(schema.mtAssets)
      .values({
        aigcMetadataStatus: input.aigcMetadataStatus,
        aiGenerated: input.aiGenerated,
        assetKind: input.assetKind,
        createdAt: input.createdAt,
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
      })
      .returning();

    const variantRows = await this.db
      .insert(schema.mtAssetVariants)
      .values(
        variants.map((variant) => ({
          assetId: variant.assetId,
          createdAt: variant.createdAt,
          createdByJobId: variant.createdByJobId ?? null,
          exifRemoved: variant.exifRemoved,
          height: variant.height,
          mimeType: variant.mimeType,
          sha256: variant.sha256,
          sizeBytes: variant.sizeBytes,
          storageKey: variant.storageKey,
          tenantId: variant.tenantId,
          variantType: variant.variantType,
          width: variant.width,
        }))
      )
      .returning();

    return {
      asset: mapAsset(requireRow(assetRow)),
      variants: variantRows.map(mapVariant),
    };
  }

  async findAssetById(tenantId: string, assetId: string): Promise<Asset | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtAssets)
      .where(
        and(eq(schema.mtAssets.tenantId, tenantId), eq(schema.mtAssets.id, assetId))
      )
      .limit(1);
    return row ? mapAsset(row) : null;
  }

  async findVariant(
    tenantId: string,
    assetId: string,
    variantType: AssetVariantType
  ): Promise<AssetVariant | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtAssetVariants)
      .where(
        and(
          eq(schema.mtAssetVariants.tenantId, tenantId),
          eq(schema.mtAssetVariants.assetId, assetId),
          eq(schema.mtAssetVariants.variantType, variantType)
        )
      )
      .limit(1);
    return row ? mapVariant(row) : null;
  }

  async listAssets(input: {
    includeDeleted?: boolean;
    ownerUserId: string;
    projectId?: string;
    tenantId: string;
  }): Promise<Array<{ asset: Asset; variants: AssetVariant[] }>> {
    const conditions = [
      eq(schema.mtAssets.tenantId, input.tenantId),
      eq(schema.mtAssets.ownerUserId, input.ownerUserId),
      input.projectId ? eq(schema.mtAssets.projectId, input.projectId) : undefined,
      input.includeDeleted
        ? undefined
        : ne(schema.mtAssets.visibilityStatus, 'deleted'),
      input.includeDeleted ? undefined : isNull(schema.mtAssets.deletedAt),
    ].filter(Boolean);
    const assetRows = await this.db
      .select()
      .from(schema.mtAssets)
      .where(and(...conditions))
      .orderBy(desc(schema.mtAssets.createdAt));

    const records = [];
    for (const row of assetRows) {
      records.push({
        asset: mapAsset(row),
        variants: await this.listVariants(input.tenantId, row.id),
      });
    }
    return records;
  }

  async listAssetsByTask(
    tenantId: string,
    taskId: string
  ): Promise<Array<{ asset: Asset; variants: AssetVariant[] }>> {
    const relationRows = await this.db
      .select()
      .from(schema.mtAssetRelations)
      .where(
        and(
          eq(schema.mtAssetRelations.tenantId, tenantId),
          eq(schema.mtAssetRelations.taskId, taskId)
        )
      );

    const records = [];
    for (const relation of relationRows) {
      const asset = await this.findAssetById(tenantId, relation.resultAssetId);
      if (asset) {
        records.push({
          asset,
          variants: await this.listVariants(tenantId, asset.id),
        });
      }
    }
    return records;
  }

  async listVariants(
    tenantId: string,
    assetId: string
  ): Promise<AssetVariant[]> {
    const rows = await this.db
      .select()
      .from(schema.mtAssetVariants)
      .where(
        and(
          eq(schema.mtAssetVariants.tenantId, tenantId),
          eq(schema.mtAssetVariants.assetId, assetId)
        )
      );
    return rows.map(mapVariant);
  }

  async updateAsset(id: string, patch: UpdateAssetInput): Promise<Asset> {
    const [row] = await this.db
      .update(schema.mtAssets)
      .set({
        deletedAt: patch.deletedAt,
        favorite: patch.favorite,
        selected: patch.selected,
        updatedAt: patch.updatedAt,
        visibilityStatus: patch.visibilityStatus,
      })
      .where(eq(schema.mtAssets.id, id))
      .returning();
    return mapAsset(requireRow(row));
  }
}

function mapAsset(row: typeof schema.mtAssets.$inferSelect): Asset {
  return {
    aigcMetadataStatus: row.aigcMetadataStatus,
    aiGenerated: row.aiGenerated,
    assetKind: row.assetKind,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    favorite: row.favorite,
    generationTaskId: row.generationTaskId,
    hasProviderWatermark: row.hasProviderWatermark,
    height: row.height,
    id: row.id,
    mimeType: row.mimeType,
    modelKey: row.modelKey,
    modelVersion: row.modelVersion,
    origin: row.origin,
    ownerUserId: row.ownerUserId,
    projectId: row.projectId,
    provider: row.provider,
    selected: row.selected,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    tenantId: row.tenantId,
    updatedAt: row.updatedAt,
    visibilityStatus: row.visibilityStatus,
    width: row.width,
  };
}

function mapVariant(row: typeof schema.mtAssetVariants.$inferSelect): AssetVariant {
  return {
    assetId: row.assetId,
    createdAt: row.createdAt,
    createdByJobId: row.createdByJobId,
    exifRemoved: row.exifRemoved,
    height: row.height,
    id: row.id,
    mimeType: row.mimeType,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    storageKey: row.storageKey,
    tenantId: row.tenantId,
    variantType: row.variantType,
    width: row.width,
  };
}

function mapRelation(row: typeof schema.mtAssetRelations.$inferSelect): AssetRelation {
  return {
    candidateIndex: row.candidateIndex,
    createdAt: row.createdAt,
    id: row.id,
    maskAssetId: row.maskAssetId,
    referenceAssetId: row.referenceAssetId,
    referenceRole: row.referenceRole,
    relationType: row.relationType,
    resultAssetId: row.resultAssetId,
    sourceAssetId: row.sourceAssetId,
    taskId: row.taskId,
    tenantId: row.tenantId,
  };
}

function requireRow<T>(row: T | undefined): T {
  if (!row) {
    throw new AppError('ASSET_NOT_FOUND', 404, '资产不存在或不可访问');
  }
  return row;
}
