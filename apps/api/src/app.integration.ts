import { describe, expect, it } from 'vitest';

import { createApp } from './app';
import { createTestAppContext, createUserWithQuota } from './test/helpers';

describe('S03 auth/access API', () => {
  it('registers by invite, logs in, redeems quota, and blocks disabled login', async () => {
    const { assetService, repository, service, projectService } =
      await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      projectService,
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

describe('S04 projects/home API', () => {
  it('creates owner projects, returns summary, and opens canvas owner-only', async () => {
    const {
      assetService,
      projectRepository,
      projectService,
      repository,
      service,
    } =
      await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      projectService,
      secureCookies: false,
    });

    await createUserWithQuota(repository, {
      email: 'owner@mengtu.local',
      password: 'owner-password',
      username: 'owner',
    });
    await createUserWithQuota(repository, {
      email: 'other@mengtu.local',
      password: 'other-password',
      username: 'other',
    });

    const ownerLogin = await post(app, '/api/auth/login', {
      login: 'owner@mengtu.local',
      password: 'owner-password',
    });
    const otherLogin = await post(app, '/api/auth/login', {
      login: 'other@mengtu.local',
      password: 'other-password',
    });
    const adminLogin = await post(app, '/api/auth/login', {
      login: 'admin@mengtu.local',
      password: 'admin-password',
    });

    const empty = await get(app, '/api/projects', ownerLogin.cookie);
    expect(empty.response.status).toBe(200);
    expect(empty.json.data.projects).toEqual([]);

    const missingTitle = await post(
      app,
      '/api/projects',
      { title: '   ' },
      ownerLogin.cookie
    );
    expect(missingTitle.response.status).toBe(400);
    expect(missingTitle.json.error.code).toBe('PROJECT_TITLE_REQUIRED');

    const created = await post(
      app,
      '/api/projects',
      { title: '  S04 Project  ' },
      ownerLogin.cookie
    );
    expect(created.response.status).toBe(201);
    expect(created.json.data.project.title).toBe('S04 Project');
    const projectId = created.json.data.project.id as string;

    const summary = await get(app, '/api/home/summary', ownerLogin.cookie);
    expect(summary.response.status).toBe(200);
    expect(summary.json.data.projects.total).toBe(1);
    expect(summary.json.data.recentAssets).toEqual([]);
    expect(summary.json.data.recentTasks).toEqual([]);

    const adminDetail = await get(
      app,
      `/api/projects/${projectId}`,
      adminLogin.cookie
    );
    expect(adminDetail.response.status).toBe(200);
    expect(adminDetail.json.data.project.id).toBe(projectId);

    const forbiddenDetail = await get(
      app,
      `/api/projects/${projectId}`,
      otherLogin.cookie
    );
    expect(forbiddenDetail.response.status).toBe(404);
    expect(forbiddenDetail.json.error.code).toBe('PROJECT_NOT_FOUND');

    const forbiddenOpen = await post(
      app,
      `/api/projects/${projectId}/open-canvas`,
      {},
      adminLogin.cookie
    );
    expect(forbiddenOpen.response.status).toBe(403);
    expect(forbiddenOpen.json.error.code).toBe('FORBIDDEN');

    const opened = await post(
      app,
      `/api/projects/${projectId}/open-canvas`,
      {},
      ownerLogin.cookie
    );
    expect(opened.response.status).toBe(200);
    expect(opened.json.data).toMatchObject({
      canvasUrl: expect.stringContaining(`/canvas?project_id=${projectId}`),
      featureFlags: {
        agentEnabled: false,
        experimentalToolsEnabled: false,
        imageTaskEnabled: false,
      },
      projectId,
    });
    expect(projectRepository.projects.get(projectId)?.lastOpenedAt).toEqual(
      new Date('2026-05-26T00:00:00.000Z')
    );
  });
});

describe('S06 assets/storage API', () => {
  it('uploads, lists, proxies, audits admin original reads, and soft-deletes owner assets', async () => {
    const {
      assetRepository,
      assetService,
      projectService,
      repository,
      service,
      storageService,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      projectService,
      secureCookies: false,
    });

    await createUserWithQuota(repository, {
      email: 'asset-owner@mengtu.local',
      password: 'owner-password',
      username: 'asset-owner',
    });
    await createUserWithQuota(repository, {
      email: 'asset-other@mengtu.local',
      password: 'other-password',
      username: 'asset-other',
    });

    const ownerLogin = await post(app, '/api/auth/login', {
      login: 'asset-owner@mengtu.local',
      password: 'owner-password',
    });
    const otherLogin = await post(app, '/api/auth/login', {
      login: 'asset-other@mengtu.local',
      password: 'other-password',
    });
    const adminLogin = await post(app, '/api/auth/login', {
      login: 'admin@mengtu.local',
      password: 'admin-password',
    });

    const project = await post(
      app,
      '/api/projects',
      { title: 'Assets Project' },
      ownerLogin.cookie
    );
    const projectId = project.json.data.project.id as string;

    const invalid = await upload(
      app,
      {
        file: new File([Buffer.from('not an image')], 'note.txt', {
          type: 'text/plain',
        }),
        projectId,
      },
      ownerLogin.cookie
    );
    expect(invalid.response.status).toBe(400);
    expect(invalid.json.error.code).toBe('UPLOAD_INVALID_FORMAT');

    const uploaded = await upload(
      app,
      {
        file: new File([tinyPng()], 'pixel.png', { type: 'image/png' }),
        projectId,
      },
      ownerLogin.cookie
    );
    expect(uploaded.response.status).toBe(201);
    expect(uploaded.json.data.asset).toMatchObject({
      assetKind: 'image',
      origin: 'upload',
      visibilityStatus: 'normal',
      variants: expect.arrayContaining([
        expect.objectContaining({ type: 'original', exifRemoved: false }),
        expect.objectContaining({ type: 'provider_input', exifRemoved: true }),
        expect.objectContaining({ type: 'thumb', exifRemoved: true }),
      ]),
    });

    const assetId = uploaded.json.data.asset.id as string;
    expect(assetRepository.assets.get(assetId)?.ownerUserId).toBe(
      ownerLogin.json.data.user.id
    );
    expect(storageService.objects.size).toBe(3);

    const listed = await get(app, '/api/assets', ownerLogin.cookie);
    expect(listed.response.status).toBe(200);
    expect(listed.json.data.assets).toHaveLength(1);

    const forbiddenList = await get(app, '/api/assets', otherLogin.cookie);
    expect(forbiddenList.response.status).toBe(200);
    expect(forbiddenList.json.data.assets).toEqual([]);

    const forbiddenRead = await get(
      app,
      `/api/assets/${assetId}/variants/original`,
      otherLogin.cookie
    );
    expect(forbiddenRead.response.status).toBe(404);

    const ownerOriginal = await rawGet(
      app,
      `/api/assets/${assetId}/variants/original`,
      ownerLogin.cookie
    );
    expect(ownerOriginal.status).toBe(200);
    expect(ownerOriginal.headers.get('content-type')).toBe('image/png');

    const adminOriginal = await rawGet(
      app,
      `/api/assets/${assetId}/variants/original`,
      adminLogin.cookie
    );
    expect(adminOriginal.status).toBe(200);
    expect([...repository.auditLogs.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'asset.original.read',
          targetId: assetId,
          targetType: 'asset',
        }),
      ])
    );

    const discarded = await patch(
      app,
      `/api/assets/${assetId}`,
      { favorite: true, visibilityStatus: 'discarded' },
      ownerLogin.cookie
    );
    expect(discarded.response.status).toBe(200);
    expect(discarded.json.data.asset.favorite).toBe(true);
    expect(discarded.json.data.asset.visibilityStatus).toBe('discarded');

    const deleted = await del(app, `/api/assets/${assetId}`, ownerLogin.cookie);
    expect(deleted.response.status).toBe(200);
    expect(deleted.json.data.asset.visibilityStatus).toBe('deleted');
    expect(deleted.json.data.asset.deletedAt).toBeTruthy();

    const hiddenAfterDelete = await get(app, '/api/assets', ownerLogin.cookie);
    expect(hiddenAfterDelete.json.data.assets).toEqual([]);
    expect(storageService.objects.size).toBe(3);
  });
});

async function get(
  app: ReturnType<typeof createApp>,
  path: string,
  cookie?: string
) {
  return send(app, path, 'GET', undefined, cookie);
}

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

async function del(
  app: ReturnType<typeof createApp>,
  path: string,
  cookie?: string
) {
  return send(app, path, 'DELETE', undefined, cookie);
}

async function rawGet(
  app: ReturnType<typeof createApp>,
  path: string,
  cookie?: string
) {
  return app.request(path, {
    headers: cookie ? { cookie } : undefined,
    method: 'GET',
  });
}

async function upload(
  app: ReturnType<typeof createApp>,
  input: { file: File; projectId: string },
  cookie?: string
) {
  const form = new FormData();
  form.append('projectId', input.projectId);
  form.append('file', input.file);
  const headers: Record<string, string> = {};
  if (cookie) {
    headers.cookie = cookie;
  }

  const response = await app.request('/api/assets/upload', {
    body: form,
    headers,
    method: 'POST',
  });
  const json = await response.json();
  return { json, response };
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
    body: body === undefined ? undefined : JSON.stringify(body),
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

function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
}
