import type { AuthRepository } from '../auth/types';

export type AssetKind = 'image' | 'mask' | 'preset';
export type AssetOrigin = 'upload' | 'generated' | 'mask' | 'preset';
export type AssetVisibilityStatus =
  | 'normal'
  | 'discarded'
  | 'hidden'
  | 'deleted';
export type AssetVariantType =
  | 'original'
  | 'provider_input'
  | 'thumb'
  | 'preview';
export type AigcMetadataStatus =
  | 'unknown'
  | 'present'
  | 'removed'
  | 'not_applicable';
export type AssetRelationType = 'source' | 'mask' | 'reference' | 'result';
export type AssetReferenceRole =
  | 'general'
  | 'subject'
  | 'style'
  | 'composition'
  | 'background';

export interface Asset {
  id: string;
  tenantId: string;
  ownerUserId: string;
  projectId: string;
  assetKind: AssetKind;
  origin: AssetOrigin;
  visibilityStatus: AssetVisibilityStatus;
  favorite: boolean;
  selected: boolean;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  aiGenerated: boolean;
  generationTaskId: string | null;
  provider: string | null;
  modelKey: string | null;
  modelVersion: string | null;
  hasProviderWatermark: boolean | null;
  aigcMetadataStatus: AigcMetadataStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface AssetVariant {
  id: string;
  tenantId: string;
  assetId: string;
  variantType: AssetVariantType;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  exifRemoved: boolean;
  createdByJobId: string | null;
  createdAt: Date;
}

export interface AssetRelation {
  id: string;
  tenantId: string;
  taskId: string | null;
  sourceAssetId: string | null;
  resultAssetId: string;
  maskAssetId: string | null;
  referenceAssetId: string | null;
  relationType: AssetRelationType;
  referenceRole: AssetReferenceRole | null;
  candidateIndex: number | null;
  createdAt: Date;
}

export interface AssetView {
  id: string;
  projectId: string;
  assetKind: AssetKind;
  origin: AssetOrigin;
  visibilityStatus: AssetVisibilityStatus;
  favorite: boolean;
  selected: boolean;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  aiGenerated: boolean;
  aigcMetadataStatus: AigcMetadataStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  variants: Array<{
    exifRemoved: boolean;
    height: number;
    mimeType: string;
    sizeBytes: number;
    type: AssetVariantType;
    url: string;
    width: number;
  }>;
}

export interface CreateAssetInput {
  id: string;
  tenantId: string;
  ownerUserId: string;
  projectId: string;
  assetKind: AssetKind;
  origin: AssetOrigin;
  visibilityStatus: AssetVisibilityStatus;
  favorite: boolean;
  selected: boolean;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  aiGenerated: boolean;
  generationTaskId?: string | null;
  provider?: string | null;
  modelKey?: string | null;
  modelVersion?: string | null;
  hasProviderWatermark?: boolean | null;
  aigcMetadataStatus: AigcMetadataStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface CreateAssetVariantInput {
  tenantId: string;
  assetId: string;
  variantType: AssetVariantType;
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  exifRemoved: boolean;
  createdByJobId?: string | null;
  createdAt: Date;
}

export interface CreateAssetRelationInput {
  candidateIndex?: number | null;
  maskAssetId?: string | null;
  referenceAssetId?: string | null;
  referenceRole?: AssetReferenceRole | null;
  relationType: AssetRelationType;
  resultAssetId: string;
  sourceAssetId?: string | null;
  taskId: string | null;
  tenantId: string;
}

export interface UpdateAssetInput {
  deletedAt?: Date | null;
  favorite?: boolean;
  selected?: boolean;
  updatedAt: Date;
  visibilityStatus?: AssetVisibilityStatus;
}

export interface AssetRepository {
  createAssetRelation(input: CreateAssetRelationInput): Promise<AssetRelation>;
  createAssetWithVariants(
    asset: CreateAssetInput,
    variants: CreateAssetVariantInput[]
  ): Promise<{ asset: Asset; variants: AssetVariant[] }>;
  findAssetById(tenantId: string, assetId: string): Promise<Asset | null>;
  findVariant(
    tenantId: string,
    assetId: string,
    variantType: AssetVariantType
  ): Promise<AssetVariant | null>;
  listAssets(input: {
    includeDeleted?: boolean;
    ownerUserId: string;
    projectId?: string;
    tenantId: string;
  }): Promise<Array<{ asset: Asset; variants: AssetVariant[] }>>;
  listAdminAssets(input: {
    includeDeleted?: boolean;
    ownerUserId?: string;
    projectId?: string;
    tenantId: string;
  }): Promise<Array<{ asset: Asset; variants: AssetVariant[] }>>;
  listAssetsByTask(
    tenantId: string,
    taskId: string
  ): Promise<Array<{ asset: Asset; variants: AssetVariant[] }>>;
  listVariants(tenantId: string, assetId: string): Promise<AssetVariant[]>;
  updateAsset(id: string, patch: UpdateAssetInput): Promise<Asset>;
}

export type AuditWriter = Pick<AuthRepository, 'createAuditLog'>;
