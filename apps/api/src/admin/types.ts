import type { AuthenticatedSession } from '../auth/types';

export type ProviderStatus = 'active' | 'degraded' | 'disabled';
export type ModelVisibility = 'public' | 'beta' | 'admin_only' | 'disabled';
export type ModelHealthStatus = 'healthy' | 'degraded' | 'disabled';
export type ModelSupportLevel =
  | 'native'
  | 'wrapped'
  | 'experimental'
  | 'unsupported';
export type PricePolicyUnit = 'per_task' | 'per_image' | 'fixed';
export type PricePolicyStatus = 'draft' | 'active' | 'retired';
export type AdminImageTaskOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'inpaint'
  | 'reference_generate'
  | 'prompt_optimize';

export interface ProviderCredentialMetadata {
  credentialKind: string;
  id: string;
  lastRotatedAt: Date;
  maskedValue: string;
  rotatedByAdminId: string;
}

export interface ProviderConfigRecord {
  createdAt: Date;
  credential: ProviderCredentialMetadata | null;
  dataRegion: string | null;
  dataRetentionPolicy: string | null;
  dataTrainingUsage: string | null;
  displayName: string;
  id: string;
  isDefault: boolean;
  lastReviewedAt: Date | null;
  privacyUrl: string | null;
  providerKey: string;
  reviewNotes: string | null;
  status: ProviderStatus;
  tenantId: string;
  termsUrl: string | null;
  updatedAt: Date;
}

export interface CreateProviderConfigInput {
  dataRegion?: string | null;
  dataRetentionPolicy?: string | null;
  dataTrainingUsage?: string | null;
  displayName: string;
  isDefault?: boolean;
  lastReviewedAt?: Date | null;
  privacyUrl?: string | null;
  providerKey: string;
  reviewNotes?: string | null;
  status?: ProviderStatus;
  tenantId: string;
  termsUrl?: string | null;
}

export interface UpdateProviderConfigInput {
  dataRegion?: string | null;
  dataRetentionPolicy?: string | null;
  dataTrainingUsage?: string | null;
  displayName?: string;
  isDefault?: boolean;
  lastReviewedAt?: Date | null;
  privacyUrl?: string | null;
  reviewNotes?: string | null;
  status?: ProviderStatus;
  termsUrl?: string | null;
}

export interface RotateProviderCredentialInput {
  credentialKind: string;
  maskedValue: string;
  providerKey: string;
  rotatedByAdminId: string;
  secretHash: string;
  secretLastFour: string;
  tenantId: string;
}

export interface PricePolicyRecord {
  amount: number;
  createdAt: Date;
  id: string;
  modelKey: string | null;
  operationType: AdminImageTaskOperationType;
  policyKey: string;
  status: PricePolicyStatus;
  tenantId: string;
  unit: PricePolicyUnit;
  updatedAt: Date;
  version: number;
}

export interface CreatePricePolicyInput {
  amount: number;
  modelKey?: string | null;
  operationType: AdminImageTaskOperationType;
  policyKey: string;
  status?: PricePolicyStatus;
  tenantId: string;
  unit: PricePolicyUnit;
}

export interface ModelCapabilityRecord {
  maxBatchSize: number;
  maxReferenceImages: number;
  operationType: AdminImageTaskOperationType;
  supportLevel: ModelSupportLevel;
  supported: boolean;
  supportedRatios: string[];
  supportedSizes: string[];
  supportsBatch: boolean;
  supportsMask: boolean;
  supportsSeed: boolean;
}

export interface ModelConfigRecord {
  capabilities: ModelCapabilityRecord[];
  createdAt: Date;
  displayName: string;
  fallbackGroupId: string | null;
  healthStatus: ModelHealthStatus;
  id: string;
  modelFamily: string;
  modelKey: string;
  modelVersion: string;
  pricePolicyId: string;
  providerConfigId: string;
  providerKey: string | null;
  providerModelId: string;
  tenantId: string;
  updatedAt: Date;
  visibility: ModelVisibility;
}

export interface UpdateModelConfigInput {
  displayName?: string;
  healthStatus?: ModelHealthStatus;
  supportLevel?: ModelSupportLevel;
  visibility?: ModelVisibility;
}

export interface AdminRepository {
  createPricePolicy(input: CreatePricePolicyInput & { version: number }): Promise<PricePolicyRecord>;
  createProviderConfig(input: CreateProviderConfigInput): Promise<ProviderConfigRecord>;
  listModelConfigs(tenantId: string): Promise<ModelConfigRecord[]>;
  listPricePolicies(tenantId: string): Promise<PricePolicyRecord[]>;
  listProviderConfigs(tenantId: string): Promise<ProviderConfigRecord[]>;
  nextPricePolicyVersion(tenantId: string, policyKey: string): Promise<number>;
  rotateProviderCredential(
    input: RotateProviderCredentialInput
  ): Promise<ProviderCredentialMetadata>;
  updateModelConfig(
    tenantId: string,
    modelKey: string,
    patch: UpdateModelConfigInput
  ): Promise<ModelConfigRecord>;
  updateProviderConfig(
    tenantId: string,
    providerKey: string,
    patch: UpdateProviderConfigInput
  ): Promise<ProviderConfigRecord>;
}

export type AuditWriter = {
  createAuditLog(input: {
    action: string;
    actorUserId: string;
    metadata?: Record<string, unknown>;
    targetId: string;
    targetType: string;
    tenantId: string;
  }): Promise<unknown>;
};

export type AdminAuth = Pick<AuthenticatedSession, 'user'>;
