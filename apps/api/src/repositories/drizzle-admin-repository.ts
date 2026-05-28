import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type {
  AdminRepository,
  CreatePricePolicyInput,
  CreateProviderConfigInput,
  ModelCapabilityRecord,
  ModelConfigRecord,
  PricePolicyRecord,
  ProviderConfigRecord,
  ProviderCredentialMetadata,
  RotateProviderCredentialInput,
  UpdateModelConfigInput,
  UpdateProviderConfigInput,
} from '../admin/types';
import * as schema from '../db/schema';
import { AppError } from '../errors';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleAdminRepository implements AdminRepository {
  constructor(private readonly db: Db) {}

  async listProviderConfigs(tenantId: string): Promise<ProviderConfigRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.mtProviderConfigs)
      .where(eq(schema.mtProviderConfigs.tenantId, tenantId))
      .orderBy(schema.mtProviderConfigs.providerKey);
    const credentials = await this.db
      .select()
      .from(schema.mtProviderCredentials)
      .where(eq(schema.mtProviderCredentials.tenantId, tenantId));
    return rows.map((row) =>
      mapProvider(
        row,
        credentials.find(
          (credential) => credential.providerConfigId === row.id
        ) ?? null
      )
    );
  }

  async createProviderConfig(
    input: CreateProviderConfigInput
  ): Promise<ProviderConfigRecord> {
    const [row] = await this.db
      .insert(schema.mtProviderConfigs)
      .values({
        dataRegion: input.dataRegion ?? null,
        dataRetentionPolicy: input.dataRetentionPolicy ?? null,
        dataTrainingUsage: input.dataTrainingUsage ?? null,
        displayName: input.displayName,
        isDefault: input.isDefault ?? false,
        lastReviewedAt: input.lastReviewedAt ?? null,
        privacyUrl: input.privacyUrl ?? null,
        providerKey: input.providerKey,
        reviewNotes: input.reviewNotes ?? null,
        status: input.status ?? 'active',
        tenantId: input.tenantId,
        termsUrl: input.termsUrl ?? null,
      })
      .returning();
    return mapProvider(requireRow(row, 'Provider insert failed'), null);
  }

  async updateProviderConfig(
    tenantId: string,
    providerKey: string,
    patch: UpdateProviderConfigInput
  ): Promise<ProviderConfigRecord> {
    const provider = await this.requireProvider(tenantId, providerKey);
    const [row] = await this.db
      .update(schema.mtProviderConfigs)
      .set({
        dataRegion: patch.dataRegion,
        dataRetentionPolicy: patch.dataRetentionPolicy,
        dataTrainingUsage: patch.dataTrainingUsage,
        displayName: patch.displayName,
        isDefault: patch.isDefault,
        lastReviewedAt: patch.lastReviewedAt,
        privacyUrl: patch.privacyUrl,
        reviewNotes: patch.reviewNotes,
        status: patch.status,
        termsUrl: patch.termsUrl,
        updatedAt: new Date(),
      })
      .where(eq(schema.mtProviderConfigs.id, provider.id))
      .returning();
    const [credential] = await this.db
      .select()
      .from(schema.mtProviderCredentials)
      .where(eq(schema.mtProviderCredentials.providerConfigId, provider.id))
      .limit(1);
    return mapProvider(requireRow(row, 'Provider update failed'), credential ?? null);
  }

  async rotateProviderCredential(
    input: RotateProviderCredentialInput
  ): Promise<ProviderCredentialMetadata> {
    const provider = await this.requireProvider(input.tenantId, input.providerKey);
    const values = {
      credentialKind: input.credentialKind,
      lastRotatedAt: new Date(),
      maskedValue: input.maskedValue,
      providerConfigId: provider.id,
      rotatedByAdminId: input.rotatedByAdminId,
      secretHash: input.secretHash,
      secretLastFour: input.secretLastFour,
      tenantId: input.tenantId,
      updatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(schema.mtProviderCredentials)
      .values(values)
      .onConflictDoUpdate({
        set: values,
        target: [
          schema.mtProviderCredentials.tenantId,
          schema.mtProviderCredentials.providerConfigId,
          schema.mtProviderCredentials.credentialKind,
        ],
      })
      .returning();
    return mapCredential(requireRow(row, 'Credential upsert failed'));
  }

  async listModelConfigs(tenantId: string): Promise<ModelConfigRecord[]> {
    const modelRows = await this.db
      .select()
      .from(schema.mtModelConfigs)
      .where(eq(schema.mtModelConfigs.tenantId, tenantId))
      .orderBy(schema.mtModelConfigs.modelKey);
    const providerRows = await this.db
      .select()
      .from(schema.mtProviderConfigs)
      .where(eq(schema.mtProviderConfigs.tenantId, tenantId));
    const capabilityRows = await this.db
      .select()
      .from(schema.mtModelCapabilities)
      .where(eq(schema.mtModelCapabilities.tenantId, tenantId));
    return modelRows.map((model) =>
      mapModel(
        model,
        providerRows.find((provider) => provider.id === model.providerConfigId)
          ?.providerKey ?? null,
        capabilityRows
          .filter((capability) => capability.modelKey === model.modelKey)
          .map(mapCapability)
      )
    );
  }

  async updateModelConfig(
    tenantId: string,
    modelKey: string,
    patch: UpdateModelConfigInput
  ): Promise<ModelConfigRecord> {
    const [model] = await this.db
      .select()
      .from(schema.mtModelConfigs)
      .where(
        and(
          eq(schema.mtModelConfigs.tenantId, tenantId),
          eq(schema.mtModelConfigs.modelKey, modelKey)
        )
      )
      .limit(1);
    if (!model) {
      throw new AppError('MODEL_NOT_FOUND', 404, 'Model not found');
    }
    if (patch.supportLevel) {
      await this.db
        .update(schema.mtModelCapabilities)
        .set({ supportLevel: patch.supportLevel, updatedAt: new Date() })
        .where(
          and(
            eq(schema.mtModelCapabilities.tenantId, tenantId),
            eq(schema.mtModelCapabilities.modelKey, modelKey)
          )
        );
    }
    const [updated] = await this.db
      .update(schema.mtModelConfigs)
      .set({
        displayName: patch.displayName,
        healthStatus: patch.healthStatus,
        updatedAt: new Date(),
        visibility: patch.visibility,
      })
      .where(eq(schema.mtModelConfigs.id, model.id))
      .returning();
    const models = await this.listModelConfigs(tenantId);
    return (
      models.find((candidate) => candidate.id === updated?.id) ??
      mapModel(requireRow(updated, 'Model update failed'), null, [])
    );
  }

  async listPricePolicies(tenantId: string): Promise<PricePolicyRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.mtPricePolicies)
      .where(eq(schema.mtPricePolicies.tenantId, tenantId))
      .orderBy(desc(schema.mtPricePolicies.createdAt));
    return rows.map(mapPricePolicy);
  }

  async nextPricePolicyVersion(
    tenantId: string,
    policyKey: string
  ): Promise<number> {
    const rows = await this.db
      .select()
      .from(schema.mtPricePolicies)
      .where(
        and(
          eq(schema.mtPricePolicies.tenantId, tenantId),
          eq(schema.mtPricePolicies.policyKey, policyKey)
        )
      );
    return Math.max(0, ...rows.map((row) => row.version)) + 1;
  }

  async createPricePolicy(
    input: CreatePricePolicyInput & { version: number }
  ): Promise<PricePolicyRecord> {
    const [row] = await this.db
      .insert(schema.mtPricePolicies)
      .values({
        amount: input.amount,
        modelKey: input.modelKey ?? null,
        operationType: input.operationType,
        policyKey: input.policyKey,
        status: input.status ?? 'active',
        tenantId: input.tenantId,
        unit: input.unit,
        version: input.version,
      })
      .returning();
    return mapPricePolicy(requireRow(row, 'Price policy insert failed'));
  }

  private async requireProvider(tenantId: string, providerKey: string) {
    const [provider] = await this.db
      .select()
      .from(schema.mtProviderConfigs)
      .where(
        and(
          eq(schema.mtProviderConfigs.tenantId, tenantId),
          eq(schema.mtProviderConfigs.providerKey, providerKey)
        )
      )
      .limit(1);
    if (!provider) {
      throw new AppError('PROVIDER_NOT_FOUND', 404, 'Provider not found');
    }
    return provider;
  }
}

function mapProvider(
  row: typeof schema.mtProviderConfigs.$inferSelect,
  credential: typeof schema.mtProviderCredentials.$inferSelect | null
): ProviderConfigRecord {
  return {
    createdAt: row.createdAt,
    credential: credential ? mapCredential(credential) : null,
    dataRegion: row.dataRegion,
    dataRetentionPolicy: row.dataRetentionPolicy,
    dataTrainingUsage: row.dataTrainingUsage,
    displayName: row.displayName,
    id: row.id,
    isDefault: row.isDefault,
    lastReviewedAt: row.lastReviewedAt,
    privacyUrl: row.privacyUrl,
    providerKey: row.providerKey,
    reviewNotes: row.reviewNotes,
    status: row.status,
    tenantId: row.tenantId,
    termsUrl: row.termsUrl,
    updatedAt: row.updatedAt,
  };
}

function mapCredential(
  row: typeof schema.mtProviderCredentials.$inferSelect
): ProviderCredentialMetadata {
  return {
    credentialKind: row.credentialKind,
    id: row.id,
    lastRotatedAt: row.lastRotatedAt,
    maskedValue: row.maskedValue,
    rotatedByAdminId: row.rotatedByAdminId,
  };
}

function mapModel(
  row: typeof schema.mtModelConfigs.$inferSelect,
  providerKey: string | null,
  capabilities: ModelCapabilityRecord[]
): ModelConfigRecord {
  return {
    capabilities,
    createdAt: row.createdAt,
    displayName: row.displayName,
    fallbackGroupId: row.fallbackGroupId,
    healthStatus: row.healthStatus,
    id: row.id,
    modelFamily: row.modelFamily,
    modelKey: row.modelKey,
    modelVersion: row.modelVersion,
    pricePolicyId: row.pricePolicyId,
    providerConfigId: row.providerConfigId,
    providerKey,
    providerModelId: row.providerModelId,
    tenantId: row.tenantId,
    updatedAt: row.updatedAt,
    visibility: row.visibility,
  };
}

function mapCapability(
  row: typeof schema.mtModelCapabilities.$inferSelect
): ModelCapabilityRecord {
  return {
    maxBatchSize: row.maxBatchSize,
    maxReferenceImages: row.maxReferenceImages,
    operationType: row.operationType,
    supportLevel: row.supportLevel,
    supported: row.supported,
    supportedRatios: asStringArray(row.supportedRatios),
    supportedSizes: asStringArray(row.supportedSizes),
    supportsBatch: row.supportsBatch,
    supportsMask: row.supportsMask,
    supportsSeed: row.supportsSeed,
  };
}

function mapPricePolicy(
  row: typeof schema.mtPricePolicies.$inferSelect
): PricePolicyRecord {
  return {
    amount: row.amount,
    createdAt: row.createdAt,
    id: row.id,
    modelKey: row.modelKey,
    operationType: row.operationType,
    policyKey: row.policyKey,
    status: row.status,
    tenantId: row.tenantId,
    unit: row.unit,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new AppError('NOT_FOUND', 404, message);
  }
  return row;
}
