import { AuthService } from '../auth/service';
import { hashPassword } from '../auth/password';
import { DEFAULT_TENANT_ID, User } from '../auth/types';
import { InMemoryAuthRepository } from '../repositories/in-memory-auth-repository';

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
