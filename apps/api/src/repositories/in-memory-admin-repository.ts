import { randomUUID } from 'crypto';

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
import { AppError } from '../errors';
import {
  MOCK_MODEL_KEY,
  MOCK_MODEL_VERSION,
  MOCK_PRICE_PER_IMAGE,
  MOCK_PRICE_POLICY_ID,
  MOCK_PRICE_VERSION,
  MOCK_PROVIDER_CONFIG_ID,
  MOCK_PROVIDER_KEY,
} from '../providers/mock-provider';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export class InMemoryAdminRepository implements AdminRepository {
  readonly credentials = new Map<string, ProviderCredentialMetadata>();
  readonly capabilities = new Map<string, ModelCapabilityRecord>();
  readonly models = new Map<string, ModelConfigRecord>();
  readonly pricePolicies = new Map<string, PricePolicyRecord>();
  readonly providers = new Map<string, ProviderConfigRecord>();

  constructor() {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const provider: ProviderConfigRecord = {
      createdAt: now,
      credential: null,
      dataRegion: null,
      dataRetentionPolicy: null,
      dataTrainingUsage: null,
      displayName: 'Mock Provider',
      id: MOCK_PROVIDER_CONFIG_ID,
      isDefault: true,
      lastReviewedAt: null,
      privacyUrl: null,
      providerKey: MOCK_PROVIDER_KEY,
      reviewNotes: null,
      status: 'active',
      tenantId: DEFAULT_TENANT_ID,
      termsUrl: null,
      updatedAt: now,
    };
    const pricePolicy: PricePolicyRecord = {
      amount: MOCK_PRICE_PER_IMAGE,
      createdAt: now,
      id: MOCK_PRICE_POLICY_ID,
      modelKey: MOCK_MODEL_KEY,
      operationType: 'text_to_image',
      policyKey: 'mock_text_to_image',
      status: 'active',
      tenantId: DEFAULT_TENANT_ID,
      unit: 'per_image',
      updatedAt: now,
      version: MOCK_PRICE_VERSION,
    };
    const capabilities: ModelCapabilityRecord[] = [
      {
        maxBatchSize: 4,
        maxReferenceImages: 5,
        operationType: 'text_to_image',
        supportLevel: 'native',
        supported: true,
        supportedRatios: ['1:1', '16:9', '9:16'],
        supportedSizes: [],
        supportsBatch: true,
        supportsMask: true,
        supportsSeed: false,
      },
      {
        maxBatchSize: 4,
        maxReferenceImages: 5,
        operationType: 'image_to_image',
        supportLevel: 'native',
        supported: true,
        supportedRatios: ['1:1', '16:9', '9:16'],
        supportedSizes: [],
        supportsBatch: true,
        supportsMask: true,
        supportsSeed: false,
      },
      {
        maxBatchSize: 4,
        maxReferenceImages: 5,
        operationType: 'inpaint',
        supportLevel: 'native',
        supported: true,
        supportedRatios: ['1:1', '16:9', '9:16'],
        supportedSizes: [],
        supportsBatch: true,
        supportsMask: true,
        supportsSeed: false,
      },
      {
        maxBatchSize: 4,
        maxReferenceImages: 5,
        operationType: 'reference_generate',
        supportLevel: 'native',
        supported: true,
        supportedRatios: ['1:1', '16:9', '9:16'],
        supportedSizes: [],
        supportsBatch: true,
        supportsMask: true,
        supportsSeed: false,
      },
      {
        maxBatchSize: 1,
        maxReferenceImages: 0,
        operationType: 'prompt_optimize',
        supportLevel: 'native',
        supported: true,
        supportedRatios: ['1:1'],
        supportedSizes: [],
        supportsBatch: false,
        supportsMask: false,
        supportsSeed: false,
      },
    ];
    const model: ModelConfigRecord = {
      capabilities,
      createdAt: now,
      displayName: 'Mock Image v1',
      fallbackGroupId: null,
      healthStatus: 'healthy',
      id: '00000000-0000-0000-0000-00000000f201',
      modelFamily: 'mock-image',
      modelKey: MOCK_MODEL_KEY,
      modelVersion: MOCK_MODEL_VERSION,
      pricePolicyId: MOCK_PRICE_POLICY_ID,
      providerConfigId: MOCK_PROVIDER_CONFIG_ID,
      providerKey: MOCK_PROVIDER_KEY,
      providerModelId: MOCK_MODEL_KEY,
      tenantId: DEFAULT_TENANT_ID,
      updatedAt: now,
      visibility: 'public',
    };
    this.providers.set(provider.id, provider);
    this.pricePolicies.set(pricePolicy.id, pricePolicy);
    this.models.set(model.id, model);
    for (const capability of capabilities) {
      this.capabilities.set(
        `${model.modelKey}:${capability.operationType}`,
        capability
      );
    }
  }

  async listProviderConfigs(tenantId: string): Promise<ProviderConfigRecord[]> {
    return [...this.providers.values()]
      .filter((provider) => provider.tenantId === tenantId)
      .map((provider) => this.withCredential(provider))
      .sort((a, b) => a.providerKey.localeCompare(b.providerKey));
  }

  async createProviderConfig(
    input: CreateProviderConfigInput
  ): Promise<ProviderConfigRecord> {
    const existing = [...this.providers.values()].find(
      (provider) =>
        provider.tenantId === input.tenantId &&
        provider.providerKey === input.providerKey
    );
    if (existing) {
      throw new AppError('CONFLICT', 409, 'Provider already exists');
    }
    const now = new Date();
    const provider: ProviderConfigRecord = {
      createdAt: now,
      credential: null,
      dataRegion: input.dataRegion ?? null,
      dataRetentionPolicy: input.dataRetentionPolicy ?? null,
      dataTrainingUsage: input.dataTrainingUsage ?? null,
      displayName: input.displayName,
      id: randomUUID(),
      isDefault: input.isDefault ?? false,
      lastReviewedAt: input.lastReviewedAt ?? null,
      privacyUrl: input.privacyUrl ?? null,
      providerKey: input.providerKey,
      reviewNotes: input.reviewNotes ?? null,
      status: input.status ?? 'active',
      tenantId: input.tenantId,
      termsUrl: input.termsUrl ?? null,
      updatedAt: now,
    };
    this.providers.set(provider.id, provider);
    return provider;
  }

  async updateProviderConfig(
    tenantId: string,
    providerKey: string,
    patch: UpdateProviderConfigInput
  ): Promise<ProviderConfigRecord> {
    const provider = this.requireProvider(tenantId, providerKey);
    const updated: ProviderConfigRecord = {
      ...provider,
      ...definedPatch(patch),
      updatedAt: new Date(),
    };
    this.providers.set(updated.id, updated);
    return this.withCredential(updated);
  }

  async rotateProviderCredential(
    input: RotateProviderCredentialInput
  ): Promise<ProviderCredentialMetadata> {
    const provider = this.requireProvider(input.tenantId, input.providerKey);
    const id = `${provider.id}:${input.credentialKind}`;
    const now = new Date();
    const credential: ProviderCredentialMetadata = {
      credentialKind: input.credentialKind,
      id,
      lastRotatedAt: now,
      maskedValue: input.maskedValue,
      rotatedByAdminId: input.rotatedByAdminId,
    };
    this.credentials.set(id, credential);
    this.providers.set(provider.id, {
      ...provider,
      credential,
      updatedAt: now,
    });
    return credential;
  }

  async listModelConfigs(tenantId: string): Promise<ModelConfigRecord[]> {
    return [...this.models.values()]
      .filter((model) => model.tenantId === tenantId)
      .map((model) => this.withCapabilities(model))
      .sort((a, b) => a.modelKey.localeCompare(b.modelKey));
  }

  async updateModelConfig(
    tenantId: string,
    modelKey: string,
    patch: UpdateModelConfigInput
  ): Promise<ModelConfigRecord> {
    const model = [...this.models.values()].find(
      (candidate) =>
        candidate.tenantId === tenantId && candidate.modelKey === modelKey
    );
    if (!model) {
      throw new AppError('MODEL_NOT_FOUND', 404, 'Model not found');
    }
    const capabilities = this.withCapabilities(model).capabilities.map(
      (capability) => ({
        ...capability,
        supportLevel: patch.supportLevel ?? capability.supportLevel,
      })
    );
    for (const capability of capabilities) {
      this.capabilities.set(
        `${model.modelKey}:${capability.operationType}`,
        capability
      );
    }
    const updated: ModelConfigRecord = {
      ...model,
      ...definedPatch({
        displayName: patch.displayName,
        healthStatus: patch.healthStatus,
        visibility: patch.visibility,
      }),
      capabilities,
      updatedAt: new Date(),
    };
    this.models.set(model.id, updated);
    return updated;
  }

  async listPricePolicies(tenantId: string): Promise<PricePolicyRecord[]> {
    return [...this.pricePolicies.values()]
      .filter((policy) => policy.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async nextPricePolicyVersion(
    tenantId: string,
    policyKey: string
  ): Promise<number> {
    const versions = [...this.pricePolicies.values()]
      .filter(
        (policy) =>
          policy.tenantId === tenantId && policy.policyKey === policyKey
      )
      .map((policy) => policy.version);
    return Math.max(0, ...versions) + 1;
  }

  async createPricePolicy(
    input: CreatePricePolicyInput & { version: number }
  ): Promise<PricePolicyRecord> {
    const now = new Date();
    const pricePolicy: PricePolicyRecord = {
      amount: input.amount,
      createdAt: now,
      id: randomUUID(),
      modelKey: input.modelKey ?? null,
      operationType: input.operationType,
      policyKey: input.policyKey,
      status: input.status ?? 'active',
      tenantId: input.tenantId,
      unit: input.unit,
      updatedAt: now,
      version: input.version,
    };
    this.pricePolicies.set(pricePolicy.id, pricePolicy);
    return pricePolicy;
  }

  private requireProvider(
    tenantId: string,
    providerKey: string
  ): ProviderConfigRecord {
    const provider = [...this.providers.values()].find(
      (candidate) =>
        candidate.tenantId === tenantId && candidate.providerKey === providerKey
    );
    if (!provider) {
      throw new AppError('PROVIDER_NOT_FOUND', 404, 'Provider not found');
    }
    return provider;
  }

  private withCredential(provider: ProviderConfigRecord): ProviderConfigRecord {
    const credential =
      [...this.credentials.values()].find((candidate) =>
        candidate.id.startsWith(`${provider.id}:`)
      ) ?? null;
    return { ...provider, credential };
  }

  private withCapabilities(model: ModelConfigRecord): ModelConfigRecord {
    return {
      ...model,
      capabilities: [...this.capabilities.entries()]
        .filter(([key]) => key.startsWith(`${model.modelKey}:`))
        .map(([, capability]) => capability),
    };
  }
}

function definedPatch<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([, value]) => value !== undefined
    )
  ) as Partial<T>;
}
