import { describe, expect, it } from 'vitest';

import { createTestAuthContext } from '../test/helpers';
import { InMemoryAdminRepository } from '../repositories/in-memory-admin-repository';
import { AdminService } from './service';

describe('AdminService', () => {
  it('rotates provider credentials without returning or auditing full secrets', async () => {
    const auth = await createTestAuthContext();
    const adminLogin = await auth.service.login(
      'admin@mengtu.local',
      'admin-password'
    );
    const adminSession = await auth.service.authenticateSession(
      adminLogin.session.token
    );
    const repository = new InMemoryAdminRepository();
    const service = new AdminService(repository, auth.repository, {
      now: () => new Date('2026-05-29T00:00:00.000Z'),
    });

    await service.createProvider(adminSession, {
      displayName: 'Credential Test Provider',
      providerKey: 'credential-test',
      status: 'active',
    });

    const secret = 'sk-test-secret-987654';
    const rotated = await service.rotateProviderCredential(
      adminSession,
      'credential-test',
      {
        credentialKind: 'api_key',
        secret,
      }
    );
    const providers = await service.listProviders(adminSession);

    expect(JSON.stringify(rotated)).not.toContain(secret);
    expect(rotated.credential.maskedValue).toMatch(/\*+7654$/);
    expect(providers.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credential: expect.objectContaining({ maskedValue: expect.any(String) }),
          providerKey: 'credential-test',
        }),
      ])
    );
    expect(JSON.stringify([...auth.repository.auditLogs.values()])).not.toContain(
      secret
    );
  });
});
