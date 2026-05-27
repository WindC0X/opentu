import { AuthService } from '../auth/service';
import { hashPassword } from '../auth/password';
import { DEFAULT_TENANT_ID, User } from '../auth/types';
import { AssetService } from '../assets/service';
import { ImageTaskService } from '../image-tasks/service';
import { QuotaService } from '../quota/service';
import { ProjectService } from '../projects/service';
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
  options: { imageTaskAutoRunWorker?: boolean } = {}
) {
  const auth = await createTestAuthContext();
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
      now: () => new Date('2026-05-27T01:00:00.000Z'),
    }
  );

  return {
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
