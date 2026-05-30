import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import type { ModelCapabilityRecord, ModelConfigRecord } from './admin/types';
import { FileDatabaseBackupStatusReader } from './backup/status';
import { AppError } from './errors';
import { StaticProviderCredentialResolver } from './providers/credentials';
import type {
  ImageProviderAdapter,
  ImageProviderExecutionInput,
  ImageProviderResult,
} from './providers/types';
import { createTestAppContext, createUserWithQuota } from './test/helpers';

const backupStatusTempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    backupStatusTempDirs.splice(0).map((dir) =>
      rm(dir, { force: true, recursive: true })
    )
  );
});

describe('S03 auth/access API', () => {
  it('registers by invite, logs in, redeems quota, and blocks disabled login', async () => {
    const {
      assetService,
      imageTaskService,
      repository,
      service,
      projectService,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
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
      imageTaskService,
      projectRepository,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
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
        imageTaskEnabled: true,
      },
      models: expect.arrayContaining([
        expect.objectContaining({ modelKey: 'mock-image-v1' }),
      ]),
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
      imageTaskService,
      projectService,
      repository,
      service,
      storageService,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
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

describe('S07 image task API', () => {
  it('blocks insufficient quota without creating a provider task', async () => {
    const {
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    await createUserWithQuota(repository, {
      email: 's07-poor@mengtu.local',
      password: 'user-password',
      username: 's07-poor',
    });
    const login = await post(app, '/api/auth/login', {
      login: 's07-poor@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'No Quota Project' },
      login.cookie
    );

    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's07-no-quota',
        model_key: 'mock-image-v1',
        operation_type: 'text_to_image',
        project_id: project.json.data.project.id,
        prompt: '一只蓝色鲸鱼',
        ratio: '1:1',
      },
      login.cookie
    );

    expect(created.response.status).toBe(402);
    expect(created.json.error.code).toBe('INSUFFICIENT_QUOTA');
    expect(imageTaskRepository.tasks.size).toBe(0);
    expect(imageTaskRepository.providerUsage.size).toBe(0);

    const invalidModel = await post(
      app,
      '/api/image-tasks/quote',
      {
        batch_size: 1,
        model_key: 'unknown-model',
        operation_type: 'text_to_image',
        ratio: '1:1',
      },
      login.cookie
    );
    expect(invalidModel.response.status).toBe(400);
    expect(invalidModel.json.error.code).toBe('MODEL_UNSUPPORTED_OPERATION');
  });

  it('creates a mock text-to-image task, settles quota, persists assets, and records outbox events', async () => {
    const {
      assetRepository,
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's07-success@mengtu.local',
      password: 'user-password',
      username: 's07-success',
    });
    await seedQuota(repository, user.id, 100);
    const login = await post(app, '/api/auth/login', {
      login: 's07-success@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'Image Task Project' },
      login.cookie
    );

    const quote = await post(
      app,
      '/api/image-tasks/quote',
      {
        batch_size: 1,
        model_key: 'mock-image-v1',
        operation_type: 'text_to_image',
        ratio: '1:1',
      },
      login.cookie
    );
    expect(quote.response.status).toBe(200);
    expect(quote.json.data.quote.amount).toBe(10);

    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's07-success',
        model_key: 'mock-image-v1',
        operation_type: 'text_to_image',
        project_id: project.json.data.project.id,
        prompt: '一张蓝色鲸鱼海报',
        ratio: '1:1',
      },
      login.cookie
    );

    expect(created.response.status).toBe(201);
    expect(created.json.data.task).toMatchObject({
      assets: [
        expect.objectContaining({ aiGenerated: true, origin: 'generated' }),
      ],
      canvasSyncStatus: 'succeeded',
      quotedPriceAmount: 10,
      settledPriceAmount: 10,
      status: 'succeeded',
      successCount: 1,
    });
    expect(assetRepository.relations.size).toBe(1);
    expect(imageTaskRepository.outboxEvents.size).toBeGreaterThanOrEqual(3);
    const account = await repository.findQuotaAccountByUserId(
      '00000000-0000-0000-0000-000000000001',
      user.id
    );
    expect(account).toMatchObject({ balanceAmount: 90, heldAmount: 0 });
    expect([...repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10, entryType: 'hold' }),
        expect.objectContaining({ amount: 10, entryType: 'consume' }),
      ])
    );
  });

  it('settles partial batches, releases persist failures, and retries canvas sync', async () => {
    const {
      assetService,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's07-edge@mengtu.local',
      password: 'user-password',
      username: 's07-edge',
    });
    await seedQuota(repository, user.id, 100);
    const login = await post(app, '/api/auth/login', {
      login: 's07-edge@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'Image Edge Project' },
      login.cookie
    );
    const projectId = project.json.data.project.id;

    const partial = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 4,
        idempotency_key: 's07-partial',
        model_key: 'mock-image-v1',
        operation_type: 'text_to_image',
        project_id: projectId,
        prompt: '__mock_partial__ 批量部分成功',
        ratio: '1:1',
      },
      login.cookie
    );
    expect(partial.json.data.task).toMatchObject({
      failureCount: 1,
      settledPriceAmount: 30,
      status: 'succeeded',
      successCount: 3,
    });

    const persistFailed = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's07-persist-fail',
        model_key: 'mock-image-v1',
        operation_type: 'text_to_image',
        project_id: projectId,
        prompt: '__mock_persist_fail__ 对象存储失败',
        ratio: '1:1',
      },
      login.cookie
    );
    expect(persistFailed.json.data.task).toMatchObject({
      failureCode: 'ASSET_PERSIST_FAILED',
      status: 'failed',
    });

    const canvasFailed = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's07-canvas-fail',
        model_key: 'mock-image-v1',
        operation_type: 'text_to_image',
        project_id: projectId,
        prompt: '__mock_canvas_fail__ 画布同步失败',
        ratio: '1:1',
      },
      login.cookie
    );
    const taskId = canvasFailed.json.data.task.id as string;
    expect(canvasFailed.json.data.task.canvasSyncStatus).toBe('failed');

    const retried = await post(
      app,
      `/api/image-tasks/${taskId}/insert-to-canvas`,
      {},
      login.cookie
    );
    expect(retried.json.data.task.canvasSyncStatus).toBe('succeeded');

    const account = await repository.findQuotaAccountByUserId(
      '00000000-0000-0000-0000-000000000001',
      user.id
    );
    expect(account).toMatchObject({ balanceAmount: 60, heldAmount: 0 });
  });

  it('cancels queued image tasks and releases quota when the worker is disabled', async () => {
    const {
      assetService,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext({ imageTaskAutoRunWorker: false });
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's07-cancel@mengtu.local',
      password: 'user-password',
      username: 's07-cancel',
    });
    await seedQuota(repository, user.id, 20);
    const login = await post(app, '/api/auth/login', {
      login: 's07-cancel@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'Cancel Project' },
      login.cookie
    );
    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's07-cancel',
        model_key: 'mock-image-v1',
        operation_type: 'text_to_image',
        project_id: project.json.data.project.id,
        prompt: '排队任务',
        ratio: '1:1',
      },
      login.cookie
    );
    expect(created.json.data.task.status).toBe('queued');

    const cancelled = await post(
      app,
      `/api/image-tasks/${created.json.data.task.id}/cancel`,
      {},
      login.cookie
    );
    expect(cancelled.json.data.task.status).toBe('cancelled');
    const account = await repository.findQuotaAccountByUserId(
      '00000000-0000-0000-0000-000000000001',
      user.id
    );
    expect(account).toMatchObject({ balanceAmount: 20, heldAmount: 0 });
  });
});

describe('S08 image edit versioning API', () => {
  it('quotes and creates inpaint tasks with source, mask, and reference asset lineage', async () => {
    const {
      assetRepository,
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's08-versioning@mengtu.local',
      password: 'user-password',
      username: 's08-versioning',
    });
    await seedQuota(repository, user.id, 100);
    const login = await post(app, '/api/auth/login', {
      login: 's08-versioning@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'S08 Image Edit Project' },
      login.cookie
    );
    const projectId = project.json.data.project.id as string;

    const source = await upload(
      app,
      {
        file: new File([tinyPng()], 'source.png', { type: 'image/png' }),
        projectId,
      },
      login.cookie
    );
    const mask = await upload(
      app,
      {
        assetKind: 'mask',
        file: new File([tinyPng()], 'mask.png', { type: 'image/png' }),
        projectId,
      },
      login.cookie
    );
    const reference = await upload(
      app,
      {
        file: new File([tinyPng()], 'reference.png', { type: 'image/png' }),
        projectId,
      },
      login.cookie
    );

    const sourceAssetId = source.json.data.asset.id as string;
    const maskAssetId = mask.json.data.asset.id as string;
    const referenceAssetId = reference.json.data.asset.id as string;
    expect(mask.json.data.asset).toMatchObject({
      assetKind: 'mask',
      origin: 'mask',
    });

    const quote = await post(
      app,
      '/api/image-tasks/quote',
      {
        batch_size: 1,
        mask_asset_id: maskAssetId,
        model_key: 'mock-image-v1',
        operation_type: 'inpaint',
        project_id: projectId,
        ratio: '1:1',
        reference_assets: [
          { asset_id: referenceAssetId, order: 0, role: 'style' },
        ],
        source_asset_id: sourceAssetId,
      },
      login.cookie
    );
    expect(quote.response.status).toBe(200);
    expect(quote.json.data.quote).toMatchObject({
      amount: 10,
      maskAssetId,
      operationType: 'inpaint',
      sourceAssetId,
    });
    expect(quote.json.data.quote.referenceAssets).toEqual([
      { assetId: referenceAssetId, order: 0, role: 'style' },
    ]);

    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's08-inpaint-versioning',
        mask_asset_id: maskAssetId,
        model_key: 'mock-image-v1',
        operation_type: 'inpaint',
        project_id: projectId,
        prompt: '将背景替换为柔和日落',
        ratio: '1:1',
        reference_assets: [
          { asset_id: referenceAssetId, order: 0, role: 'style' },
        ],
        source_asset_id: sourceAssetId,
      },
      login.cookie
    );

    expect(created.response.status).toBe(201);
    expect(created.json.data.task).toMatchObject({
      assets: [
        expect.objectContaining({ aiGenerated: true, origin: 'generated' }),
      ],
      maskAssetId,
      operationType: 'inpaint',
      quotedPriceAmount: 10,
      settledPriceAmount: 10,
      sourceAssetId,
      status: 'succeeded',
    });
    expect(created.json.data.task.referenceAssets).toEqual([
      { assetId: referenceAssetId, order: 0, role: 'style' },
    ]);
    expect(created.json.data.task.assets).toHaveLength(1);

    const relations = [...assetRepository.relations.values()];
    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          maskAssetId,
          relationType: 'result',
          sourceAssetId,
        }),
        expect.objectContaining({
          relationType: 'source',
          sourceAssetId,
        }),
        expect.objectContaining({
          maskAssetId,
          relationType: 'mask',
        }),
        expect.objectContaining({
          referenceAssetId,
          referenceRole: 'style',
          relationType: 'reference',
        }),
      ])
    );
    expect(
      imageTaskRepository.providerUsage.values().next().value
    ).toMatchObject({
      requestSnapshot: {
        maskAssetId,
        operationType: 'inpaint',
        referenceAssetCount: 1,
        sourceAssetId,
      },
    });
  });

  it('rejects invalid operation asset combinations before creating a task', async () => {
    const {
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's08-invalid@mengtu.local',
      password: 'user-password',
      username: 's08-invalid',
    });
    await seedQuota(repository, user.id, 100);
    const login = await post(app, '/api/auth/login', {
      login: 's08-invalid@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'S08 Invalid Project' },
      login.cookie
    );
    const projectId = project.json.data.project.id as string;
    const source = await upload(
      app,
      {
        file: new File([tinyPng()], 'source.png', { type: 'image/png' }),
        projectId,
      },
      login.cookie
    );
    const sourceAssetId = source.json.data.asset.id as string;

    const textWithSource = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's08-invalid-text-source',
        model_key: 'mock-image-v1',
        operation_type: 'text_to_image',
        project_id: projectId,
        prompt: '文本生图不应携带源图',
        ratio: '1:1',
        source_asset_id: sourceAssetId,
      },
      login.cookie
    );
    expect(textWithSource.response.status).toBe(400);
    expect(textWithSource.json.error.code).toBe('BAD_REQUEST');

    const inpaintWithImageMask = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's08-invalid-mask-kind',
        mask_asset_id: sourceAssetId,
        model_key: 'mock-image-v1',
        operation_type: 'inpaint',
        project_id: projectId,
        prompt: 'mask 必须是 mask 资产',
        ratio: '1:1',
        source_asset_id: sourceAssetId,
      },
      login.cookie
    );
    expect(inpaintWithImageMask.response.status).toBe(404);
    expect(inpaintWithImageMask.json.error.code).toBe('ASSET_NOT_FOUND');
    expect(imageTaskRepository.tasks.size).toBe(0);
  });

  it('supports image-to-image and reference generation operation lineage', async () => {
    const {
      assetRepository,
      assetService,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's08-ops@mengtu.local',
      password: 'user-password',
      username: 's08-ops',
    });
    await seedQuota(repository, user.id, 100);
    const login = await post(app, '/api/auth/login', {
      login: 's08-ops@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'S08 Operation Project' },
      login.cookie
    );
    const projectId = project.json.data.project.id as string;
    const source = await upload(
      app,
      {
        file: new File([tinyPng()], 'source.png', { type: 'image/png' }),
        projectId,
      },
      login.cookie
    );
    const reference = await upload(
      app,
      {
        file: new File([tinyPng()], 'reference.png', { type: 'image/png' }),
        projectId,
      },
      login.cookie
    );
    const sourceAssetId = source.json.data.asset.id as string;
    const referenceAssetId = reference.json.data.asset.id as string;

    const imageToImage = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's08-image-to-image',
        model_key: 'mock-image-v1',
        operation_type: 'image_to_image',
        project_id: projectId,
        prompt: '图生图版本',
        ratio: '1:1',
        source_asset_id: sourceAssetId,
      },
      login.cookie
    );
    expect(imageToImage.response.status).toBe(201);
    expect(imageToImage.json.data.task).toMatchObject({
      operationType: 'image_to_image',
      sourceAssetId,
      status: 'succeeded',
    });

    const referenceGenerate = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's08-reference-generate',
        model_key: 'mock-image-v1',
        operation_type: 'reference_generate',
        project_id: projectId,
        prompt: '参考图生成',
        ratio: '1:1',
        reference_assets: [
          { asset_id: referenceAssetId, order: 0, role: 'subject' },
        ],
      },
      login.cookie
    );
    expect(referenceGenerate.response.status).toBe(201);
    expect(referenceGenerate.json.data.task).toMatchObject({
      operationType: 'reference_generate',
      referenceAssets: [
        { assetId: referenceAssetId, order: 0, role: 'subject' },
      ],
      status: 'succeeded',
    });
    expect([...assetRepository.relations.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationType: 'source',
          sourceAssetId,
        }),
        expect.objectContaining({
          referenceAssetId,
          referenceRole: 'subject',
          relationType: 'reference',
        }),
      ])
    );
  });
});

describe('S13 prompt optimization quota loop API', () => {
  it('quotes and creates deterministic mock prompt optimization tasks with quota consume', async () => {
    const {
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's13-success@mengtu.local',
      password: 'user-password',
      username: 's13-success',
    });
    await seedQuota(repository, user.id, 20);
    const login = await post(app, '/api/auth/login', {
      login: 's13-success@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'S13 Prompt Optimize Project' },
      login.cookie
    );
    const projectId = project.json.data.project.id as string;

    const quote = await post(
      app,
      '/api/image-tasks/quote',
      {
        batch_size: 1,
        model_key: 'mock-image-v1',
        operation_type: 'prompt_optimize',
        project_id: projectId,
        ratio: '1:1',
      },
      login.cookie
    );
    expect(quote.response.status).toBe(200);
    expect(quote.json.data.quote).toMatchObject({
      amount: 2,
      batchSize: 1,
      modelKey: 'mock-image-v1',
      operationType: 'prompt_optimize',
      unit: 'points',
    });

    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's13-prompt-success',
        model_key: 'mock-image-v1',
        operation_type: 'prompt_optimize',
        project_id: projectId,
        prompt: '一只蓝色鲸鱼在夜空中发光',
        ratio: '1:1',
      },
      login.cookie
    );

    expect(created.response.status).toBe(201);
    expect(created.json.data.task).toMatchObject({
      actualModelKey: 'mock-prompt-optimizer-v1',
      actualProvider: 'mock',
      assets: [],
      canvasSyncStatus: 'not_required',
      operationType: 'prompt_optimize',
      quotedPriceAmount: 2,
      settledPriceAmount: 2,
      status: 'succeeded',
      successCount: 1,
      userPrompt: '一只蓝色鲸鱼在夜空中发光',
    });
    expect(created.json.data.task.optimizedPrompt).toContain(
      '一只蓝色鲸鱼在夜空中发光'
    );
    expect(created.json.data.task.finalPrompt).toBe(
      created.json.data.task.optimizedPrompt
    );

    const persistedTask = imageTaskRepository.tasks.get(
      created.json.data.task.id
    );
    expect(persistedTask?.normalizedParams).toMatchObject({
      promptOptimizerModel: 'mock-prompt-optimizer-v1',
      promptOptimizerVersion: '2026-05-30',
    });
    const usage = [...imageTaskRepository.providerUsage.values()][0];
    expect(usage).toMatchObject({
      providerModelId: 'mock-prompt-optimizer-v1',
      status: 'succeeded',
    });
    expect(JSON.stringify(usage)).not.toContain('一只蓝色鲸鱼在夜空中发光');

    const account = await repository.findQuotaAccountByUserId(
      '00000000-0000-0000-0000-000000000001',
      user.id
    );
    expect(account).toMatchObject({ balanceAmount: 18, heldAmount: 0 });
    expect([...repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 2, entryType: 'hold' }),
        expect.objectContaining({ amount: 2, entryType: 'consume' }),
      ])
    );
  });

  it('releases held quota and returns a visible safe error for deterministic mock failures', async () => {
    const {
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's13-failure@mengtu.local',
      password: 'user-password',
      username: 's13-failure',
    });
    await seedQuota(repository, user.id, 20);
    const login = await post(app, '/api/auth/login', {
      login: 's13-failure@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'S13 Prompt Failure Project' },
      login.cookie
    );

    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's13-prompt-failure',
        model_key: 'mock-image-v1',
        operation_type: 'prompt_optimize',
        project_id: project.json.data.project.id,
        prompt: '__mock_prompt_optimize_fail__ 一只蓝色鲸鱼',
        ratio: '1:1',
      },
      login.cookie
    );

    expect(created.response.status).toBe(201);
    expect(created.json.data.task).toMatchObject({
      assets: [],
      canvasSyncStatus: 'not_required',
      failureCode: 'MOCK_PROMPT_OPTIMIZER_FAILED',
      failureMessage: 'Prompt optimization failed',
      operationType: 'prompt_optimize',
      optimizedPrompt: null,
      settledPriceAmount: null,
      status: 'failed',
      successCount: 0,
    });
    const usage = [...imageTaskRepository.providerUsage.values()][0];
    expect(usage).toMatchObject({
      rawErrorCode: 'MOCK_PROMPT_OPTIMIZER_FAILED',
      status: 'failed',
    });
    expect(JSON.stringify(usage)).not.toContain(
      '__mock_prompt_optimize_fail__'
    );

    const account = await repository.findQuotaAccountByUserId(
      '00000000-0000-0000-0000-000000000001',
      user.id
    );
    expect(account).toMatchObject({ balanceAmount: 20, heldAmount: 0 });
    expect([...repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 2, entryType: 'hold' }),
        expect.objectContaining({ amount: 2, entryType: 'release' }),
      ])
    );
    expect([...repository.quotaLedger.values()]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryType: 'consume' }),
      ])
    );
  });
});

describe('S09 admin/provider ops API', () => {
  it('guards admin APIs, manages provider config, masks credentials, and exposes task/asset/audit views', async () => {
    const {
      adminRepository,
      adminService,
      assetService,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      adminService,
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const owner = await createUserWithQuota(repository, {
      email: 's09-owner@mengtu.local',
      password: 'owner-password',
      username: 's09-owner',
    });
    await seedQuota(repository, owner.id, 100);

    const ownerLogin = await post(app, '/api/auth/login', {
      login: 's09-owner@mengtu.local',
      password: 'owner-password',
    });
    const adminLogin = await post(app, '/api/auth/login', {
      login: 'admin@mengtu.local',
      password: 'admin-password',
    });

    const forbidden = await get(app, '/api/admin/providers', ownerLogin.cookie);
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.json.error.code).toBe('FORBIDDEN');

    const project = await post(
      app,
      '/api/projects',
      { title: 'S09 Admin Project' },
      ownerLogin.cookie
    );
    const projectId = project.json.data.project.id as string;
    const task = await post(
      app,
      '/api/image-tasks',
      {
        batchSize: 1,
        idempotencyKey: 's09-task-1',
        modelKey: 'mock-image-v1',
        operationType: 'text_to_image',
        prompt: 's09 admin generated image',
        projectId,
        ratio: '1:1',
      },
      ownerLogin.cookie
    );
    expect(task.response.status).toBe(201);

    const providers = await get(app, '/api/admin/providers', adminLogin.cookie);
    expect(providers.response.status).toBe(200);
    expect(providers.json.data.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerKey: 'mock', status: 'active' }),
      ])
    );

    const createdProvider = await post(
      app,
      '/api/admin/providers',
      {
        displayName: 'Test Provider',
        providerKey: 'test-provider',
        reviewNotes: 'S09 integration provider',
        status: 'degraded',
      },
      adminLogin.cookie
    );
    expect(createdProvider.response.status).toBe(201);
    expect(createdProvider.json.data.provider.providerKey).toBe(
      'test-provider'
    );

    const secret = 'sk-live-secret-123456';
    const rotated = await post(
      app,
      '/api/admin/providers/test-provider/credentials',
      {
        credentialKind: 'api_key',
        secret,
      },
      adminLogin.cookie
    );
    expect(rotated.response.status).toBe(201);
    expect(rotated.json.data.credential.maskedValue).toMatch(/\*+3456$/);
    expect(JSON.stringify(rotated.json)).not.toContain(secret);
    expect(adminRepository.credentials.size).toBe(1);

    const updatedModel = await patch(
      app,
      '/api/admin/models/mock-image-v1',
      {
        healthStatus: 'degraded',
        supportLevel: 'experimental',
        visibility: 'beta',
      },
      adminLogin.cookie
    );
    expect(updatedModel.response.status).toBe(200);
    expect(updatedModel.json.data.model.visibility).toBe('beta');
    expect(updatedModel.json.data.model.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportLevel: 'experimental' }),
      ])
    );

    const pricePolicy = await post(
      app,
      '/api/admin/price-policies',
      {
        amount: 12,
        modelKey: 'mock-image-v1',
        operationType: 'text_to_image',
        policyKey: 'mock_text_to_image',
        unit: 'per_image',
      },
      adminLogin.cookie
    );
    expect(pricePolicy.response.status).toBe(201);
    expect(pricePolicy.json.data.pricePolicy.version).toBe(2);

    const adminTasks = await get(
      app,
      '/api/admin/image-tasks',
      adminLogin.cookie
    );
    expect(adminTasks.response.status).toBe(200);
    expect(adminTasks.json.data.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: task.json.data.task.id }),
      ])
    );

    const adminAssets = await get(
      app,
      '/api/admin/assets?includeDeleted=true',
      adminLogin.cookie
    );
    expect(adminAssets.response.status).toBe(200);
    expect(adminAssets.json.data.assets.length).toBeGreaterThan(0);

    const original = await rawGet(
      app,
      `/api/admin/assets/${adminAssets.json.data.assets[0].id}/original`,
      adminLogin.cookie
    );
    expect(original.status).toBe(200);

    const auditLogs = await get(
      app,
      '/api/admin/audit-logs',
      adminLogin.cookie
    );
    expect(auditLogs.response.status).toBe(200);
    expect(auditLogs.json.data.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'admin_provider_credential_rotate',
        }),
        expect.objectContaining({ action: 'asset.original.read' }),
      ])
    );
    expect(JSON.stringify(auditLogs.json.data.auditLogs)).not.toContain(secret);
  });
});

describe('S14 admin backup status API', () => {
  it('returns sanitized latest backup status for admins only', async () => {
    const outputDir = await tempBackupStatusDir();
    await writeLatestBackupStatus(outputDir, {
      status: 'succeeded',
      startedAt: '2026-05-31T01:02:03.000Z',
      finishedAt: '2026-05-31T01:02:06.000Z',
      durationMs: 3000,
      outputDir,
      dumpFile: join(outputDir, 'mengtu-db-20260531T010203Z.dump'),
      manifestFile: join(
        outputDir,
        'mengtu-db-20260531T010203Z.manifest.json'
      ),
      sizeBytes: 12345,
      sha256:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      pgDumpVersion: 'pg_dump (PostgreSQL) 16.0',
      databaseHostHash: 'sha256:hosthash',
      databaseNameHash: 'sha256:namehash',
      retentionDays: 7,
      mode: 'dump',
      dryRun: false,
      errorCode: null,
      errorMessage: null,
    });

    const {
      assetService,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      backupStatusReader: new FileDatabaseBackupStatusReader(outputDir),
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    await createUserWithQuota(repository, {
      email: 's14-owner@mengtu.local',
      password: 'owner-password',
      username: 's14-owner',
    });
    const ownerLogin = await post(app, '/api/auth/login', {
      login: 's14-owner@mengtu.local',
      password: 'owner-password',
    });
    const adminLogin = await post(app, '/api/auth/login', {
      login: 'admin@mengtu.local',
      password: 'admin-password',
    });

    const forbidden = await get(
      app,
      '/api/admin/backups/latest',
      ownerLogin.cookie
    );
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.json.error.code).toBe('FORBIDDEN');

    const latest = await get(
      app,
      '/api/admin/backups/latest',
      adminLogin.cookie
    );
    expect(latest.response.status).toBe(200);
    expect(latest.json.data.backup).toMatchObject({
      databaseHostHash: 'sha256:hosthash',
      databaseNameHash: 'sha256:namehash',
      dumpFile: 'mengtu-db-20260531T010203Z.dump',
      manifestFile: 'mengtu-db-20260531T010203Z.manifest.json',
      mode: 'dump',
      retentionDays: 7,
      status: 'succeeded',
    });
    expect(latest.json.data.backup.outputDir).not.toContain(outputDir);
    expect(latest.json.data.backup.dumpFile).not.toContain(outputDir);
    expect(JSON.stringify(latest.json)).not.toContain('postgres://');
  });

  it('returns stable missing and unavailable errors without leaking status file content', async () => {
    const missingDir = await tempBackupStatusDir();
    const malformedDir = await tempBackupStatusDir();
    const passwordValue = ['super', 'secret'].join('-');
    await writeFile(
      join(malformedDir, 'latest.json'),
      `{"status":"failed","errorMessage":"password=${passwordValue}"`,
      'utf8'
    );

    const {
      assetService,
      imageTaskService,
      projectService,
      service,
    } = await createTestAppContext();
    const app = createApp({
      assetService,
      authService: service,
      backupStatusReader: new FileDatabaseBackupStatusReader(missingDir),
      imageTaskService,
      projectService,
      secureCookies: false,
    });
    const adminLogin = await post(app, '/api/auth/login', {
      login: 'admin@mengtu.local',
      password: 'admin-password',
    });

    const missing = await get(
      app,
      '/api/admin/backups/latest',
      adminLogin.cookie
    );
    expect(missing.response.status).toBe(404);
    expect(missing.json.error.code).toBe('BACKUP_STATUS_NOT_FOUND');

    const malformedApp = createApp({
      assetService,
      authService: service,
      backupStatusReader: new FileDatabaseBackupStatusReader(malformedDir),
      imageTaskService,
      projectService,
      secureCookies: false,
    });
    const malformed = await get(
      malformedApp,
      '/api/admin/backups/latest',
      adminLogin.cookie
    );
    expect(malformed.response.status).toBe(500);
    expect(malformed.json.error.code).toBe('BACKUP_STATUS_UNAVAILABLE');
    expect(JSON.stringify(malformed.json)).not.toContain(passwordValue);
  });
});

describe('S11 real provider execution API', () => {
  it('dispatches configured provider execution, persists outputs, settles quota, and sanitizes provider usage', async () => {
    const secret = 's11-secret-token';
    const grsaiAdapter = new FakeProviderAdapter('grsai', async (input) => {
      expect(input.credentialSecret).toBe(secret);
      expect(input.model.providerModelId).toBe('gpt-image-2-vip');
      return {
        failureCount: 0,
        images: [
          {
            body: tinyPng(),
            candidateIndex: 0,
            mimeType: 'image/png',
          },
        ],
        latencyMs: 25,
        providerCostAmount: 1300,
        providerCostCurrency: 'GRSAI_CREDITS',
        providerRequestId: 'grsai-req-1',
        rawErrorCode: null,
        rawErrorMessage: null,
        responseSnapshot: {
          providerStatus: 'succeeded',
          suspiciousEcho: `Bearer ${secret}`,
        },
        status: 'succeeded',
        successCount: 1,
      };
    });
    const {
      adminRepository,
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext({
      credentialResolver: new StaticProviderCredentialResolver({
        GRSAI_API_KEY: secret,
      }),
      providerAdapters: [grsaiAdapter],
    });
    seedGrsaiModel(adminRepository);
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's11-success@mengtu.local',
      password: 'user-password',
      username: 's11-success',
    });
    await seedQuota(repository, user.id, 100);
    const login = await post(app, '/api/auth/login', {
      login: 's11-success@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'S11 Provider Project' },
      login.cookie
    );

    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's11-provider-success',
        model_key: 'grsai-gpt-image-2-vip',
        operation_type: 'text_to_image',
        project_id: project.json.data.project.id,
        prompt: '真实 provider fake execution',
        ratio: '1:1',
      },
      login.cookie
    );

    expect(created.response.status).toBe(201);
    expect(created.json.data.task).toMatchObject({
      actualModelKey: 'grsai-gpt-image-2-vip',
      actualProvider: 'grsai',
      assets: [
        expect.objectContaining({
          aiGenerated: true,
          origin: 'generated',
        }),
      ],
      quotedPriceAmount: 10,
      settledPriceAmount: 10,
      status: 'succeeded',
      successCount: 1,
    });
    expect(grsaiAdapter.calls).toHaveLength(1);
    expect(imageTaskRepository.providerUsage.size).toBe(1);
    const usage = imageTaskRepository.providerUsage.values().next().value;
    expect(usage).toMatchObject({
      providerConfigId: S11_GRS_PROVIDER_ID,
      providerCostAmount: 1300,
      providerCostCurrency: 'GRSAI_CREDITS',
      providerModelId: 'gpt-image-2-vip',
      requestId: 'grsai-req-1',
      requestSnapshot: {
        modelKey: 'grsai-gpt-image-2-vip',
        providerKey: 'grsai',
      },
      status: 'succeeded',
    });
    expect(JSON.stringify(usage)).not.toContain(secret);
    expect(JSON.stringify(usage)).not.toContain('Bearer s11-secret-token');
    const account = await repository.findQuotaAccountByUserId(
      '00000000-0000-0000-0000-000000000001',
      user.id
    );
    expect(account).toMatchObject({ balanceAmount: 90, heldAmount: 0 });
  });

  it('fails safely when provider credentials are missing and releases held quota', async () => {
    const grsaiAdapter = new FakeProviderAdapter('grsai', async (input) => {
      if (!input.credentialSecret) {
        throw new AppError(
          'PROVIDER_CREDENTIAL_MISSING',
          500,
          'Provider credential is not configured'
        );
      }
      throw new Error('unexpected credential');
    });
    const {
      adminRepository,
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext({
      credentialResolver: new StaticProviderCredentialResolver({}),
      providerAdapters: [grsaiAdapter],
    });
    seedGrsaiModel(adminRepository);
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });

    const user = await createUserWithQuota(repository, {
      email: 's11-missing-credential@mengtu.local',
      password: 'user-password',
      username: 's11-missing-credential',
    });
    await seedQuota(repository, user.id, 100);
    const login = await post(app, '/api/auth/login', {
      login: 's11-missing-credential@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'S11 Missing Credential Project' },
      login.cookie
    );

    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's11-provider-missing-credential',
        model_key: 'grsai-gpt-image-2-vip',
        operation_type: 'text_to_image',
        project_id: project.json.data.project.id,
        prompt: '缺失 credential 应失败释放点数',
        ratio: '1:1',
      },
      login.cookie
    );

    expect(created.response.status).toBe(201);
    expect(created.json.data.task).toMatchObject({
      failureCode: 'PROVIDER_CREDENTIAL_MISSING',
      status: 'failed',
    });
    const usage = imageTaskRepository.providerUsage.values().next().value;
    expect(usage).toMatchObject({
      rawErrorCode: 'PROVIDER_CREDENTIAL_MISSING',
      status: 'failed',
    });
    expect(JSON.stringify(usage)).not.toContain('secret');
    expect([...repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10, entryType: 'hold' }),
        expect.objectContaining({ amount: 10, entryType: 'release' }),
      ])
    );
    const account = await repository.findQuotaAccountByUserId(
      '00000000-0000-0000-0000-000000000001',
      user.id
    );
    expect(account).toMatchObject({ balanceAmount: 100, heldAmount: 0 });
  });

  it('sanitizes provider exception messages before task and usage persistence', async () => {
    const secret = 's11-exception-token';
    const grsaiAdapter = new FakeProviderAdapter('grsai', async () => {
      throw new AppError(
        'PROVIDER_HTTP_ERROR',
        502,
        `upstream rejected credential ${secret}`
      );
    });
    const {
      adminRepository,
      assetService,
      imageTaskRepository,
      imageTaskService,
      projectService,
      repository,
      service,
    } = await createTestAppContext({
      credentialResolver: new StaticProviderCredentialResolver({
        GRSAI_API_KEY: secret,
      }),
      providerAdapters: [grsaiAdapter],
    });
    seedGrsaiModel(adminRepository);
    const app = createApp({
      assetService,
      authService: service,
      imageTaskService,
      projectService,
      secureCookies: false,
    });
    const user = await createUserWithQuota(repository, {
      email: 's11-exception@mengtu.local',
      password: 'user-password',
      username: 's11-exception',
    });
    await seedQuota(repository, user.id, 100);
    const login = await post(app, '/api/auth/login', {
      login: 's11-exception@mengtu.local',
      password: 'user-password',
    });
    const project = await post(
      app,
      '/api/projects',
      { title: 'S11 Exception Project' },
      login.cookie
    );

    const created = await post(
      app,
      '/api/image-tasks',
      {
        batch_size: 1,
        idempotency_key: 's11-provider-exception',
        model_key: 'grsai-gpt-image-2-vip',
        operation_type: 'text_to_image',
        project_id: project.json.data.project.id,
        prompt: 'provider exception sanitization',
        ratio: '1:1',
      },
      login.cookie
    );

    expect(created.response.status).toBe(201);
    expect(created.json.data.task).toMatchObject({
      failureCode: 'PROVIDER_HTTP_ERROR',
      failureMessage: 'upstream rejected credential [redacted]',
      status: 'failed',
    });
    const usage = imageTaskRepository.providerUsage.values().next().value;
    expect(usage.rawErrorMessage).toBe(
      'upstream rejected credential [redacted]'
    );
    expect(JSON.stringify(created.json)).not.toContain(secret);
    expect(JSON.stringify(usage)).not.toContain(secret);
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

async function tempBackupStatusDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mengtu-backup-status-'));
  backupStatusTempDirs.push(dir);
  return dir;
}

async function writeLatestBackupStatus(
  outputDir: string,
  manifest: Record<string, unknown>
): Promise<void> {
  await writeFile(
    join(outputDir, 'latest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

async function upload(
  app: ReturnType<typeof createApp>,
  input: { assetKind?: 'image' | 'mask'; file: File; projectId: string },
  cookie?: string
) {
  const form = new FormData();
  form.append('projectId', input.projectId);
  if (input.assetKind) {
    form.append('assetKind', input.assetKind);
  }
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

const S11_GRS_PROVIDER_ID = '00000000-0000-0000-0000-00000000f111';
const S11_GRS_PRICE_POLICY_ID = '00000000-0000-0000-0000-00000000f112';
const S11_GRS_MODEL_ID = '00000000-0000-0000-0000-00000000f113';
const S11_TENANT_ID = '00000000-0000-0000-0000-000000000001';

class FakeProviderAdapter implements ImageProviderAdapter {
  readonly calls: ImageProviderExecutionInput[] = [];

  constructor(
    readonly providerKey: string,
    private readonly handler: (
      input: ImageProviderExecutionInput
    ) => Promise<ImageProviderResult>
  ) {}

  async execute(
    input: ImageProviderExecutionInput
  ): Promise<ImageProviderResult> {
    this.calls.push(input);
    return this.handler(input);
  }
}

function seedGrsaiModel(
  adminRepository: Awaited<
    ReturnType<typeof createTestAppContext>
  >['adminRepository']
): void {
  const now = new Date('2026-05-29T00:00:00.000Z');
  const credential = {
    credentialKind: 'api_key',
    id: `${S11_GRS_PROVIDER_ID}:api_key`,
    lastRotatedAt: now,
    maskedValue: '********oken',
    rotatedByAdminId: 'admin-user',
  };
  adminRepository.credentials.set(credential.id, credential);
  adminRepository.providers.set(S11_GRS_PROVIDER_ID, {
    createdAt: now,
    credential,
    dataRegion: null,
    dataRetentionPolicy: null,
    dataTrainingUsage: null,
    displayName: 'GrsAI',
    id: S11_GRS_PROVIDER_ID,
    isDefault: false,
    lastReviewedAt: now,
    privacyUrl: null,
    providerKey: 'grsai',
    reviewNotes: null,
    status: 'active',
    tenantId: S11_TENANT_ID,
    termsUrl: null,
    updatedAt: now,
  });
  adminRepository.pricePolicies.set(S11_GRS_PRICE_POLICY_ID, {
    amount: 10,
    createdAt: now,
    id: S11_GRS_PRICE_POLICY_ID,
    modelKey: 'grsai-gpt-image-2-vip',
    operationType: 'text_to_image',
    policyKey: 'grsai_gpt_image_2_vip_text_to_image',
    status: 'active',
    tenantId: S11_TENANT_ID,
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
    id: S11_GRS_MODEL_ID,
    modelFamily: 'gpt-image',
    modelKey: 'grsai-gpt-image-2-vip',
    modelVersion: 'gpt-image-2-vip',
    pricePolicyId: S11_GRS_PRICE_POLICY_ID,
    providerConfigId: S11_GRS_PROVIDER_ID,
    providerKey: 'grsai',
    providerModelId: 'gpt-image-2-vip',
    tenantId: S11_TENANT_ID,
    updatedAt: now,
    visibility: 'public',
  };
  adminRepository.models.set(S11_GRS_MODEL_ID, model);
  adminRepository.capabilities.set(
    `${model.modelKey}:${capability.operationType}`,
    capability
  );
}

async function seedQuota(
  repository: Awaited<ReturnType<typeof createTestAppContext>>['repository'],
  userId: string,
  amount: number
) {
  const account = await repository.findQuotaAccountByUserId(
    '00000000-0000-0000-0000-000000000001',
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
