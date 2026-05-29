import { AuthService } from '../auth/service';
import { hashPassword } from '../auth/password';
import { DEFAULT_TENANT_ID, User } from '../auth/types';
import type {
  ModelCapabilityRecord,
  ModelConfigRecord,
} from '../admin/types';
import { AdminService } from '../admin/service';
import { AssetService } from '../assets/service';
import { ImageTaskService } from '../image-tasks/service';
import { AdminImageModelCatalog } from '../providers/model-catalog';
import { ImageProviderRegistry } from '../providers/registry';
import type {
  ImageModelCatalog,
  ImageProviderAdapter,
  ProviderCredentialResolver,
} from '../providers/types';
import { QuotaService } from '../quota/service';
import { ProjectService } from '../projects/service';
import { InMemoryAdminRepository } from '../repositories/in-memory-admin-repository';
import { InMemoryAssetRepository } from '../repositories/in-memory-asset-repository';
import { InMemoryAuthRepository } from '../repositories/in-memory-auth-repository';
import { InMemoryImageTaskRepository } from '../repositories/in-memory-image-task-repository';
import { InMemoryProjectRepository } from '../repositories/in-memory-project-repository';
import { InMemoryStorageService } from '../storage/in-memory-storage-service';

export async function createTestAuthContext() {
  const repository = new InMemoryAuthRepository();
  const service = new AuthService(repository, {
    now: () => new Date('2026-05-25T00:00:00.000Z'),
  });
  const admin = await repository.createUser({
    email: 'admin@mengtu.local',
    passwordHash: await hashPassword('admin-password'),
    privacyVersion: 'privacy-v1',
    role: 'admin',
    status: 'active',
    tenantId: DEFAULT_TENANT_ID,
    termsAcceptedAt: new Date('2026-05-25T00:00:00.000Z'),
    termsVersion: 'terms-v1',
    username: 'admin',
  });
  await repository.createQuotaAccount({
    ownerId: admin.id,
    ownerType: 'user',
    tenantId: DEFAULT_TENANT_ID,
  });

  return { admin, repository, service };
}

export async function createTestAppContext(
  options: {
    credentialResolver?: ProviderCredentialResolver;
    imageTaskAutoRunWorker?: boolean;
    modelCatalog?: ImageModelCatalog;
    providerAdapters?: ImageProviderAdapter[];
    providerRegistry?: ImageProviderRegistry;
  } = {}
) {
  const auth = await createTestAuthContext();
  const adminRepository = new InMemoryAdminRepository();
  const adminService = new AdminService(adminRepository, auth.repository, {
    now: () => new Date('2026-05-29T00:00:00.000Z'),
  });
  const projectRepository = new InMemoryProjectRepository();
  const projectService = new ProjectService(projectRepository, {
    now: () => new Date('2026-05-26T00:00:00.000Z'),
  });
  const assetRepository = new InMemoryAssetRepository();
  const imageTaskRepository = new InMemoryImageTaskRepository();
  const storageService = new InMemoryStorageService();
  const assetService = new AssetService(
    assetRepository,
    projectRepository,
    storageService,
    auth.repository,
    {
      now: () => new Date('2026-05-27T00:00:00.000Z'),
      storagePrefix: 'test',
    }
  );
  const quotaService = new QuotaService(auth.repository);
  const imageTaskService = new ImageTaskService(
    imageTaskRepository,
    projectRepository,
    assetRepository,
    assetService,
    quotaService,
    {
      autoRunWorker: options.imageTaskAutoRunWorker,
      credentialResolver: options.credentialResolver,
      modelCatalog:
        options.modelCatalog ?? new AdminImageModelCatalog(adminRepository),
      now: () => new Date('2026-05-27T01:00:00.000Z'),
      providerRegistry:
        options.providerRegistry ??
        (options.providerAdapters
          ? new ImageProviderRegistry(options.providerAdapters)
          : undefined),
    }
  );

  return {
    adminRepository,
    adminService,
    assetRepository,
    assetService,
    imageTaskRepository,
    imageTaskService,
    ...auth,
    projectRepository,
    projectService,
    storageService,
  };
}

export async function createUserWithQuota(
  repository: InMemoryAuthRepository,
  input: {
    email: string;
    password: string;
    role?: 'admin' | 'user';
    status?: 'active' | 'disabled';
    username: string;
  }
): Promise<User> {
  const user = await repository.createUser({
    email: input.email,
    passwordHash: await hashPassword(input.password),
    privacyVersion: 'privacy-v1',
    role: input.role ?? 'user',
    status: input.status ?? 'active',
    tenantId: DEFAULT_TENANT_ID,
    termsAcceptedAt: new Date('2026-05-25T00:00:00.000Z'),
    termsVersion: 'terms-v1',
    username: input.username,
  });
  await repository.createQuotaAccount({
    ownerId: user.id,
    ownerType: 'user',
    tenantId: DEFAULT_TENANT_ID,
  });
  return user;
}

export const TEST_GRSAI_PROVIDER_CONFIG_ID =
  '00000000-0000-0000-0000-00000000f111';
export const TEST_GRSAI_PRICE_POLICY_ID =
  '00000000-0000-0000-0000-00000000f112';
export const TEST_GRSAI_MODEL_ID =
  '00000000-0000-0000-0000-00000000f113';
export const TEST_GRSAI_MODEL_KEY = 'grsai-gpt-image-2-vip';
export const TEST_GRSAI_PROVIDER_MODEL_ID = 'gpt-image-2-vip';

export function seedTestGrsaiModel(
  adminRepository: InMemoryAdminRepository
): void {
  const now = new Date('2026-05-29T00:00:00.000Z');
  const credential = {
    credentialKind: 'api_key',
    id: `${TEST_GRSAI_PROVIDER_CONFIG_ID}:api_key`,
    lastRotatedAt: now,
    maskedValue: '********oken',
    rotatedByAdminId: 'admin-user',
  };
  adminRepository.credentials.set(credential.id, credential);
  adminRepository.providers.set(TEST_GRSAI_PROVIDER_CONFIG_ID, {
    createdAt: now,
    credential,
    dataRegion: null,
    dataRetentionPolicy: null,
    dataTrainingUsage: null,
    displayName: 'GrsAI',
    id: TEST_GRSAI_PROVIDER_CONFIG_ID,
    isDefault: false,
    lastReviewedAt: now,
    privacyUrl: null,
    providerKey: 'grsai',
    reviewNotes: null,
    status: 'active',
    tenantId: DEFAULT_TENANT_ID,
    termsUrl: null,
    updatedAt: now,
  });
  adminRepository.pricePolicies.set(TEST_GRSAI_PRICE_POLICY_ID, {
    amount: 10,
    createdAt: now,
    id: TEST_GRSAI_PRICE_POLICY_ID,
    modelKey: TEST_GRSAI_MODEL_KEY,
    operationType: 'text_to_image',
    policyKey: 'grsai_gpt_image_2_vip_text_to_image',
    status: 'active',
    tenantId: DEFAULT_TENANT_ID,
    unit: 'per_image',
    updatedAt: now,
    version: 1,
  });
  const capability: ModelCapabilityRecord = {
    maxBatchSize: 1,
    maxReferenceImages: 0,
    operationType: 'text_to_image',
    supportLevel: 'native',
    supported: true,
    supportedRatios: ['1:1'],
    supportedSizes: ['1024x1024'],
    supportsBatch: false,
    supportsMask: false,
    supportsSeed: false,
  };
  const model: ModelConfigRecord = {
    capabilities: [capability],
    createdAt: now,
    displayName: 'GrsAI GPT Image 2 VIP',
    fallbackGroupId: null,
    healthStatus: 'healthy',
    id: TEST_GRSAI_MODEL_ID,
    modelFamily: 'gpt-image',
    modelKey: TEST_GRSAI_MODEL_KEY,
    modelVersion: TEST_GRSAI_PROVIDER_MODEL_ID,
    pricePolicyId: TEST_GRSAI_PRICE_POLICY_ID,
    providerConfigId: TEST_GRSAI_PROVIDER_CONFIG_ID,
    providerKey: 'grsai',
    providerModelId: TEST_GRSAI_PROVIDER_MODEL_ID,
    tenantId: DEFAULT_TENANT_ID,
    updatedAt: now,
    visibility: 'public',
  };
  adminRepository.models.set(TEST_GRSAI_MODEL_ID, model);
  adminRepository.capabilities.set(
    `${model.modelKey}:${capability.operationType}`,
    capability
  );
}

export async function seedTestQuota(
  repository: InMemoryAuthRepository,
  userId: string,
  amount: number
): Promise<void> {
  const account = await repository.findQuotaAccountByUserId(
    DEFAULT_TENANT_ID,
    userId
  );
  if (!account) {
    throw new Error('missing quota account');
  }
  await repository.updateQuotaAccount(account.id, {
    balanceAmount: amount,
    heldAmount: 0,
  });
}
