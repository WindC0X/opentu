import { createHash } from 'crypto';

import type { AuthenticatedSession } from '../auth/types';
import { DEFAULT_TENANT_ID } from '../auth/types';
import { AppError } from '../errors';
import type {
  AdminImageTaskOperationType,
  AdminRepository,
  AuditWriter,
  CreatePricePolicyInput,
  CreateProviderConfigInput,
  ModelHealthStatus,
  ModelSupportLevel,
  ModelVisibility,
  PricePolicyStatus,
  PricePolicyUnit,
  ProviderStatus,
  UpdateModelConfigInput,
  UpdateProviderConfigInput,
} from './types';

interface AdminServiceOptions {
  now?: () => Date;
  tenantId?: string;
}

export class AdminService {
  private readonly now: () => Date;
  private readonly tenantId: string;

  constructor(
    private readonly repository: AdminRepository,
    private readonly auditWriter: AuditWriter,
    options: AdminServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  }

  async listProviders(auth: AuthenticatedSession) {
    this.requireAdmin(auth);
    return { providers: await this.repository.listProviderConfigs(this.tenantId) };
  }

  async createProvider(
    auth: AuthenticatedSession,
    input: Omit<CreateProviderConfigInput, 'tenantId'>
  ) {
    this.requireAdmin(auth);
    const provider = await this.repository.createProviderConfig({
      ...input,
      dataRegion: cleanOptionalString(input.dataRegion),
      dataRetentionPolicy: cleanOptionalString(input.dataRetentionPolicy),
      dataTrainingUsage: cleanOptionalString(input.dataTrainingUsage),
      displayName: requiredString(input.displayName, 'displayName'),
      isDefault: input.isDefault ?? false,
      lastReviewedAt: input.lastReviewedAt ?? this.now(),
      privacyUrl: cleanOptionalString(input.privacyUrl),
      providerKey: normalizeKey(input.providerKey, 'providerKey'),
      reviewNotes: cleanOptionalString(input.reviewNotes),
      status:
        input.status === undefined ? 'active' : normalizeProviderStatus(input.status),
      tenantId: this.tenantId,
      termsUrl: cleanOptionalString(input.termsUrl),
    });
    await this.audit(auth, 'admin_provider_create', 'provider', provider.providerKey, {
      providerKey: provider.providerKey,
      status: provider.status,
    });
    return { provider };
  }

  async updateProvider(
    auth: AuthenticatedSession,
    providerKey: string,
    input: UpdateProviderConfigInput
  ) {
    this.requireAdmin(auth);
    const patch = normalizeProviderPatch(input);
    const provider = await this.repository.updateProviderConfig(
      this.tenantId,
      normalizeKey(providerKey, 'providerKey'),
      patch
    );
    await this.audit(auth, 'admin_provider_update', 'provider', provider.providerKey, {
      providerKey: provider.providerKey,
      status: patch.status,
    });
    return { provider };
  }

  async rotateProviderCredential(
    auth: AuthenticatedSession,
    providerKey: string,
    input: { credentialKind?: string; secret: string }
  ) {
    this.requireAdmin(auth);
    const secret = requiredString(input.secret, 'secret');
    if (secret.length < 8) {
      throw new AppError('BAD_REQUEST', 400, 'secret must be at least 8 chars');
    }
    const credential = await this.repository.rotateProviderCredential({
      credentialKind: normalizeCredentialKind(input.credentialKind),
      maskedValue: maskSecret(secret),
      providerKey: normalizeKey(providerKey, 'providerKey'),
      rotatedByAdminId: auth.user.id,
      secretHash: hashSecret(secret),
      secretLastFour: secret.slice(-4),
      tenantId: this.tenantId,
    });
    await this.audit(auth, 'admin_provider_credential_rotate', 'provider', providerKey, {
      credentialKind: credential.credentialKind,
      maskedValue: credential.maskedValue,
      providerKey,
    });
    return { credential };
  }

  async listModels(auth: AuthenticatedSession) {
    this.requireAdmin(auth);
    return { models: await this.repository.listModelConfigs(this.tenantId) };
  }

  async updateModel(
    auth: AuthenticatedSession,
    modelKey: string,
    input: UpdateModelConfigInput
  ) {
    this.requireAdmin(auth);
    const patch = normalizeModelPatch(input);
    const model = await this.repository.updateModelConfig(
      this.tenantId,
      requiredString(modelKey, 'modelKey'),
      patch
    );
    await this.audit(auth, 'admin_model_update', 'model', model.modelKey, {
      healthStatus: patch.healthStatus,
      supportLevel: patch.supportLevel,
      visibility: patch.visibility,
    });
    return { model };
  }

  async listPricePolicies(auth: AuthenticatedSession) {
    this.requireAdmin(auth);
    return { pricePolicies: await this.repository.listPricePolicies(this.tenantId) };
  }

  async createPricePolicy(
    auth: AuthenticatedSession,
    input: Omit<CreatePricePolicyInput, 'tenantId'>
  ) {
    this.requireAdmin(auth);
    const policyKey = normalizeKey(input.policyKey, 'policyKey');
    const pricePolicy = await this.repository.createPricePolicy({
      amount: positiveInteger(input.amount, 'amount'),
      modelKey: cleanOptionalString(input.modelKey),
      operationType: normalizeOperationType(input.operationType),
      policyKey,
      status: normalizePricePolicyStatus(input.status),
      tenantId: this.tenantId,
      unit: normalizePricePolicyUnit(input.unit),
      version: await this.repository.nextPricePolicyVersion(this.tenantId, policyKey),
    });
    await this.audit(auth, 'admin_price_policy_create', 'price_policy', pricePolicy.id, {
      amount: pricePolicy.amount,
      operationType: pricePolicy.operationType,
      policyKey: pricePolicy.policyKey,
      version: pricePolicy.version,
    });
    return { pricePolicy };
  }

  private requireAdmin(auth: AuthenticatedSession): void {
    if (auth.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }
  }

  private async audit(
    auth: AuthenticatedSession,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.auditWriter.createAuditLog({
      action,
      actorUserId: auth.user.id,
      metadata: sanitizeAuditMetadata(metadata),
      targetId,
      targetType,
      tenantId: this.tenantId,
    });
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('BAD_REQUEST', 400, `${field} is required`);
  }
  return value.trim();
}

function cleanOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function patchOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return cleanOptionalString(value);
}

function normalizeKey(value: unknown, field: string): string {
  const key = requiredString(value, field).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,118}[a-z0-9]$/.test(key)) {
    throw new AppError('BAD_REQUEST', 400, `${field} has invalid format`);
  }
  return key;
}

function normalizeCredentialKind(value: unknown): string {
  const kind =
    typeof value === 'string' && value.trim() ? value.trim() : 'api_key';
  if (!/^[a-z0-9][a-z0-9_-]{1,78}[a-z0-9]$/.test(kind)) {
    throw new AppError('BAD_REQUEST', 400, 'credentialKind has invalid format');
  }
  return kind;
}

function normalizeProviderPatch(
  input: UpdateProviderConfigInput
): UpdateProviderConfigInput {
  return {
    dataRegion: patchOptionalString(input.dataRegion),
    dataRetentionPolicy: patchOptionalString(input.dataRetentionPolicy),
    dataTrainingUsage: patchOptionalString(input.dataTrainingUsage),
    displayName:
      input.displayName === undefined
        ? undefined
        : requiredString(input.displayName, 'displayName'),
    isDefault: input.isDefault,
    lastReviewedAt: input.lastReviewedAt,
    privacyUrl: patchOptionalString(input.privacyUrl),
    reviewNotes: patchOptionalString(input.reviewNotes),
    status:
      input.status === undefined ? undefined : normalizeProviderStatus(input.status),
    termsUrl: patchOptionalString(input.termsUrl),
  };
}

function normalizeModelPatch(input: UpdateModelConfigInput): UpdateModelConfigInput {
  return {
    displayName:
      input.displayName === undefined
        ? undefined
        : requiredString(input.displayName, 'displayName'),
    healthStatus:
      input.healthStatus === undefined
        ? undefined
        : normalizeModelHealthStatus(input.healthStatus),
    supportLevel:
      input.supportLevel === undefined
        ? undefined
        : normalizeModelSupportLevel(input.supportLevel),
    visibility:
      input.visibility === undefined
        ? undefined
        : normalizeModelVisibility(input.visibility),
  };
}

function normalizeProviderStatus(value: unknown): ProviderStatus {
  if (value === 'active' || value === 'degraded' || value === 'disabled') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'status is invalid');
}

function normalizeModelVisibility(value: unknown): ModelVisibility {
  if (
    value === 'public' ||
    value === 'beta' ||
    value === 'admin_only' ||
    value === 'disabled'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'visibility is invalid');
}

function normalizeModelHealthStatus(value: unknown): ModelHealthStatus {
  if (value === 'healthy' || value === 'degraded' || value === 'disabled') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'healthStatus is invalid');
}

function normalizeModelSupportLevel(value: unknown): ModelSupportLevel {
  if (
    value === 'native' ||
    value === 'wrapped' ||
    value === 'experimental' ||
    value === 'unsupported'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'supportLevel is invalid');
}

function normalizeOperationType(value: unknown): AdminImageTaskOperationType {
  if (
    value === 'text_to_image' ||
    value === 'image_to_image' ||
    value === 'inpaint' ||
    value === 'reference_generate' ||
    value === 'prompt_optimize'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'operationType is invalid');
}

function normalizePricePolicyUnit(value: unknown): PricePolicyUnit {
  if (value === 'per_task' || value === 'per_image' || value === 'fixed') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'unit is invalid');
}

function normalizePricePolicyStatus(value: unknown): PricePolicyStatus {
  if (value === undefined || value === null) {
    return 'active';
  }
  if (value === 'draft' || value === 'active' || value === 'retired') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'status is invalid');
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new AppError('BAD_REQUEST', 400, `${field} must be a positive integer`);
  }
  return value as number;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function maskSecret(secret: string): string {
  const lastFour = secret.slice(-4);
  return `${'*'.repeat(Math.max(8, Math.min(16, secret.length - 4)))}${lastFour}`;
}

function sanitizeAuditMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => !/secret|token|credential|hash/i.test(key)
    )
  );
}
