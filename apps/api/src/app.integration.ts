import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { createTestAuthContext } from './test/helpers';

describe('S03 auth/access API', () => {
  it('registers by invite, logs in, redeems quota, and blocks disabled login', async () => {
    const { repository, service } = await createTestAuthContext();
    const app = createApp({
      authService: service,
      secureCookies: false,
    });

    const adminLogin = await post(app, '/api/auth/login', {
      login: 'admin@mengtu.local',
      password: 'admin-password',
    });
    expect(adminLogin.response.status).toBe(200);
    expect(adminLogin.cookie).toContain('mt_session=');
    expect(adminLogin.setCookie).toContain('HttpOnly');
    expect(adminLogin.setCookie).toContain('SameSite=Lax');

    const invite = await post(
      app,
      '/api/admin/invite-codes',
      {
        code: 'INVITE-API-1',
        initialQuotaAmount: 50,
        maxUses: 1,
      },
      adminLogin.cookie
    );
    expect(invite.response.status).toBe(201);

    const invited = await post(app, '/api/invitations/accept', {
      code: 'INVITE-API-1',
      email: 'invited@mengtu.local',
      password: 'user-password',
      privacyVersion: 'privacy-v1',
      termsVersion: 'terms-v1',
      username: 'invited',
    });
    expect(invited.response.status).toBe(201);
    expect(invited.json.data.quota.balanceAmount).toBe(50);

    const userId = invited.json.data.user.id;
    expect(repository.users.get(userId)?.passwordHash).not.toBe(
      'user-password'
    );
    expect([...repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 50,
          entryType: 'grant',
          userId,
        }),
      ])
    );

    const redemption = await post(
      app,
      '/api/admin/redemption-codes',
      {
        code: 'RED-API-1',
        maxUses: 10,
        quotaAmount: 20,
      },
      adminLogin.cookie
    );
    expect(redemption.response.status).toBe(201);

    const redeemed = await post(
      app,
      '/api/redemptions/redeem',
      { code: 'RED-API-1' },
      invited.cookie
    );
    expect(redeemed.response.status).toBe(200);
    expect(redeemed.json.data.quota.balanceAmount).toBe(70);
    expect([...repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 20,
          entryType: 'redemption',
          userId,
        }),
      ])
    );

    const disabled = await patch(
      app,
      `/api/admin/users/${userId}`,
      { status: 'disabled' },
      adminLogin.cookie
    );
    expect(disabled.response.status).toBe(200);

    const disabledLogin = await post(app, '/api/auth/login', {
      login: 'invited@mengtu.local',
      password: 'user-password',
    });
    expect(disabledLogin.response.status).toBe(403);
    expect(disabledLogin.json.error.code).toBe('USER_DISABLED');
  });
});

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  cookie?: string
) {
  return send(app, path, 'POST', body, cookie);
}

async function patch(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  cookie?: string
) {
  return send(app, path, 'PATCH', body, cookie);
}

async function send(
  app: ReturnType<typeof createApp>,
  path: string,
  method: string,
  body: unknown,
  cookie?: string
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (cookie) {
    headers.cookie = cookie;
  }

  const response = await app.request(path, {
    body: JSON.stringify(body),
    headers,
    method,
  });
  const json = await response.json();
  const setCookie = response.headers.get('set-cookie') ?? '';

  return {
    cookie: setCookie.split(';')[0],
    json,
    response,
    setCookie,
  };
}
