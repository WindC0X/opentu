import type {
  AssetSummary,
  ImageTaskSummary,
  QuotaSummary,
} from '../mengtu/types';

export type AdminUserRole = 'user' | 'admin';
export type AdminUserStatus = 'invited' | 'active' | 'disabled';
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
export type AdminOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'inpaint'
  | 'reference_generate'
  | 'prompt_optimize';

export interface AdminUser {
  email: string;
  id: string;
  lastLoginAt: string | null;
  privacyVersion: string | null;
  role: AdminUserRole;
  status: AdminUserStatus;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  username: string;
}

export interface ProviderCredentialMetadata {
  credentialKind: string;
  id: string;
  lastRotatedAt: string;
  maskedValue: string;
  rotatedByAdminId: string;
}

export interface ProviderConfig {
  credential: ProviderCredentialMetadata | null;
  dataRegion: string | null;
  dataRetentionPolicy: string | null;
  dataTrainingUsage: string | null;
  displayName: string;
  id: string;
  isDefault: boolean;
  lastReviewedAt: string | null;
  privacyUrl: string | null;
  providerKey: string;
  reviewNotes: string | null;
  status: ProviderStatus;
  termsUrl: string | null;
  updatedAt: string;
}

export interface ModelCapability {
  maxBatchSize: number;
  maxReferenceImages: number;
  operationType: AdminOperationType;
  supportLevel: ModelSupportLevel;
  supported: boolean;
  supportedRatios: string[];
  supportedSizes: string[];
  supportsBatch: boolean;
  supportsMask: boolean;
  supportsSeed: boolean;
}

export interface ModelConfig {
  capabilities: ModelCapability[];
  displayName: string;
  healthStatus: ModelHealthStatus;
  id: string;
  modelFamily: string;
  modelKey: string;
  modelVersion: string;
  providerKey: string | null;
  visibility: ModelVisibility;
}

export interface PricePolicy {
  amount: number;
  createdAt: string;
  id: string;
  modelKey: string | null;
  operationType: AdminOperationType;
  policyKey: string;
  status: PricePolicyStatus;
  unit: PricePolicyUnit;
  version: number;
}

export interface AuditLog {
  action: string;
  actorUserId: string;
  createdAt: string;
  id: string;
  metadata: Record<string, unknown>;
  targetId: string;
  targetType: string;
}

export interface BackupStatus {
  databaseHostHash: string | null;
  databaseNameHash: string | null;
  dryRun: boolean;
  dumpFile: string;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string;
  manifestFile: string;
  mode: 'dry-run' | 'test-fake-pg-dump' | 'dump';
  outputDir: string;
  pgDumpVersion: string | null;
  retentionDays: number;
  sha256: string | null;
  sizeBytes: number | null;
  startedAt: string;
  status: 'succeeded' | 'failed';
}

export type BackupStatusSummary =
  | { state: 'available'; backup: BackupStatus }
  | { state: 'missing' }
  | { errorCode: string; message: string; state: 'unavailable' };

export interface AdminData {
  assets: AssetSummary[];
  auditLogs: AuditLog[];
  backupStatus: BackupStatusSummary;
  models: ModelConfig[];
  pricePolicies: PricePolicy[];
  providers: ProviderConfig[];
  quota: QuotaSummary;
  tasks: ImageTaskSummary[];
  users: AdminUser[];
}
