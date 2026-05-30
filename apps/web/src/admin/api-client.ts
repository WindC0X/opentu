import { ApiClientError, getHomeSummary, request } from '../mengtu/api-client';
import type {
  AdminData,
  AdminOperationType,
  AdminUser,
  AuditLog,
  BackupStatus,
  BackupStatusSummary,
  ModelConfig,
  ModelHealthStatus,
  ModelSupportLevel,
  ModelVisibility,
  PricePolicy,
  PricePolicyStatus,
  PricePolicyUnit,
  ProviderConfig,
  ProviderStatus,
} from './types';
import type { AssetSummary, ImageTaskSummary } from '../mengtu/types';

export async function loadAdminData(): Promise<AdminData> {
  const [
    home,
    users,
    tasks,
    assets,
    backupStatus,
    providers,
    models,
    pricePolicies,
    auditLogs,
  ] = await Promise.all([
    getHomeSummary(),
    listAdminUsers(),
    listAdminTasks(),
    listAdminAssets(),
    getBackupStatusSummary(),
    listProviders(),
    listModels(),
    listPricePolicies(),
    listAuditLogs(),
  ]);

  return {
    assets,
    auditLogs,
    backupStatus,
    models,
    pricePolicies,
    providers,
    quota: home.quota,
    tasks,
    users,
  };
}

export async function getBackupStatusSummary(): Promise<BackupStatusSummary> {
  try {
    const result = await request<{ backup: BackupStatus }>(
      '/api/admin/backups/latest'
    );
    return { backup: result.backup, state: 'available' };
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.code === 'BACKUP_STATUS_NOT_FOUND') {
        return { state: 'missing' };
      }
      if (error.code === 'BACKUP_STATUS_UNAVAILABLE') {
        return {
          errorCode: error.code,
          message: error.message,
          state: 'unavailable',
        };
      }
    }
    throw error;
  }
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const result = await request<{ users: AdminUser[] }>('/api/admin/users');
  return result.users;
}

export async function adjustUserQuota(input: {
  amount: number;
  reason: string;
  userId: string;
}) {
  return request<{ quota: { balanceAmount: number; heldAmount: number } }>(
    `/api/admin/users/${encodeURIComponent(input.userId)}/quota-adjustments`,
    {
      body: JSON.stringify({ amount: input.amount, reason: input.reason }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
}

export async function createInviteCode(input: {
  code?: string;
  initialQuotaAmount?: number;
  maxUses?: number;
}) {
  return request<{ code: string; id: string }>('/api/admin/invite-codes', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

export async function createRedemptionCode(input: {
  code?: string;
  maxUses?: number;
  quotaAmount: number;
}) {
  return request<{ code: string; id: string }>('/api/admin/redemption-codes', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

export async function listAdminTasks(): Promise<ImageTaskSummary[]> {
  const result = await request<{ tasks: ImageTaskSummary[] }>(
    '/api/admin/image-tasks'
  );
  return result.tasks;
}

export async function listAdminAssets(): Promise<AssetSummary[]> {
  const result = await request<{ assets: AssetSummary[] }>(
    '/api/admin/assets?includeDeleted=true'
  );
  return result.assets;
}

export async function listProviders(): Promise<ProviderConfig[]> {
  const result = await request<{ providers: ProviderConfig[] }>(
    '/api/admin/providers'
  );
  return result.providers;
}

export async function createProvider(input: {
  displayName: string;
  providerKey: string;
  reviewNotes?: string;
  status?: ProviderStatus;
}) {
  return request<{ provider: ProviderConfig }>('/api/admin/providers', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

export async function updateProvider(input: {
  providerKey: string;
  reviewNotes?: string;
  status?: ProviderStatus;
}) {
  return request<{ provider: ProviderConfig }>(
    `/api/admin/providers/${encodeURIComponent(input.providerKey)}`,
    {
      body: JSON.stringify({
        reviewNotes: input.reviewNotes,
        status: input.status,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }
  );
}

export async function rotateProviderCredential(input: {
  credentialKind?: string;
  providerKey: string;
  secret: string;
}) {
  return request<{ credential: ProviderConfig['credential'] }>(
    `/api/admin/providers/${encodeURIComponent(input.providerKey)}/credentials`,
    {
      body: JSON.stringify({
        credentialKind: input.credentialKind,
        secret: input.secret,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
}

export async function listModels(): Promise<ModelConfig[]> {
  const result = await request<{ models: ModelConfig[] }>('/api/admin/models');
  return result.models;
}

export async function updateModel(input: {
  healthStatus?: ModelHealthStatus;
  modelKey: string;
  supportLevel?: ModelSupportLevel;
  visibility?: ModelVisibility;
}) {
  return request<{ model: ModelConfig }>(
    `/api/admin/models/${encodeURIComponent(input.modelKey)}`,
    {
      body: JSON.stringify({
        healthStatus: input.healthStatus,
        supportLevel: input.supportLevel,
        visibility: input.visibility,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }
  );
}

export async function listPricePolicies(): Promise<PricePolicy[]> {
  const result = await request<{ pricePolicies: PricePolicy[] }>(
    '/api/admin/price-policies'
  );
  return result.pricePolicies;
}

export async function createPricePolicy(input: {
  amount: number;
  modelKey?: string;
  operationType: AdminOperationType;
  policyKey: string;
  status?: PricePolicyStatus;
  unit: PricePolicyUnit;
}) {
  return request<{ pricePolicy: PricePolicy }>('/api/admin/price-policies', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

export async function listAuditLogs(): Promise<AuditLog[]> {
  const result = await request<{ auditLogs: AuditLog[] }>(
    '/api/admin/audit-logs?limit=100'
  );
  return result.auditLogs;
}
