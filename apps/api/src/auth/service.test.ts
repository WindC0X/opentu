import { describe, expect, it } from 'vitest';

import { hashAccessCode } from './code';
import { AuthService } from './service';
import { DEFAULT_TENANT_ID } from './types';
import { createTestAuthContext, createUserWithQuota } from '../test/helpers';

describe('AuthService', () => {
  it('accepts an invite and writes an initial quota grant', async () => {
    const { admin, repository, service } = await createTestAuthContext();
    await repository.createInviteCode({
      codeHash: hashAccessCode('INVITE-123'),
      createdByAdminId: admin.id,
      expiresAt: null,
      initialQuotaAmount: 100,
      maxUses: 1,
      tenantId: DEFAULT_TENANT_ID,
    });

    const result = await service.acceptInvitation({
      code: 'INVITE-123',
      email: 'new-user@mengtu.local',
      password: 'user-password',
      privacyVersion: 'privacy-v1',
      termsVersion: 'terms-v1',
      username: 'new-user',
    });

    expect(result.quota.balanceAmount).toBe(100);
    expect([...repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 100,
          entryType: 'grant',
          userId: result.user.id,
        }),
      ])
    );
    expect(repository.users.get(result.user.id)?.passwordHash).not.toBe(
      'user-password'
    );
  });

  it('redeems a fixed quota code exactly once per user', async () => {
    const { repository, service } = await createTestAuthContext();
    await createUserWithQuota(repository, {
      email: 'user@mengtu.local',
      password: 'user-password',
      username: 'user',
    });
    const authResult = await service.login(
      'user@mengtu.local',
      'user-password'
    );
    const auth = await service.authenticateSession(authResult.session.token);
    await repository.createRedemptionCode({
      codeHash: hashAccessCode('RED-123'),
      createdByAdminId: auth.user.id,
      expiresAt: null,
      maxUses: 10,
      quotaAmount: 25,
      tenantId: DEFAULT_TENANT_ID,
    });

    const redeemed = await service.redeemCode(auth, 'RED-123');

    expect(redeemed.quota.balanceAmount).toBe(25);
    expect([...repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 25,
          entryType: 'redemption',
          relatedRedemptionId: expect.any(String),
          userId: auth.user.id,
        }),
      ])
    );
    await expect(service.redeemCode(auth, 'RED-123')).rejects.toMatchObject({
      code: 'INVALID_REDEMPTION_CODE',
    });
  });

  it('blocks disabled users from logging in', async () => {
    const { repository, service } = await createTestAuthContext();
    await createUserWithQuota(repository, {
      email: 'disabled@mengtu.local',
      password: 'user-password',
      status: 'disabled',
      username: 'disabled-user',
    });

    await expect(
      service.login('disabled@mengtu.local', 'user-password')
    ).rejects.toMatchObject({
      code: 'USER_DISABLED',
    });
  });
});
