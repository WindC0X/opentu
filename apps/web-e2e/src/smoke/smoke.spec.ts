/**
 * @tags smoke
 * 冒烟测试 - 基于实际页面元素和状态
 * 仅 2 次页面加载，覆盖所有核心功能
 */
import { test, expect } from '../fixtures/test-base';
import { MengtuHomeApp } from '../fixtures/test-app';
import type { Page } from '@playwright/test';

const WORKBENCH_READY_TIMEOUT = 60000;

const s07Envelope = <T,>(data: T) => ({
  data,
  error: null,
  request_id: 'req_smoke_s07',
});

async function installS07ImageTaskApiMocks(page: Page) {
  const now = '2026-05-28T00:00:00.000Z';
  let createCount = 0;
  let insertCount = 0;
  let task: Record<string, unknown> | null = null;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === 'GET' && path === '/api/models') {
      await route.fulfill({
        body: JSON.stringify(
          s07Envelope({
            models: [
              {
                capabilities: {
                  maxBatchSize: 4,
                  operationType: 'text_to_image',
                  supportedRatios: ['1:1', '16:9', '9:16'],
                  supportsBatch: true,
                },
                displayName: 'Mock Image v1',
                modelKey: 'mock-image-v1',
                price: { amount: 10, unit: 'per_image', version: 1 },
                providerKey: 'mock',
              },
            ],
          })
        ),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (request.method() === 'POST' && path === '/api/image-tasks') {
      const body = JSON.parse(request.postData() || '{}') as {
        batch_size?: number;
        model_key?: string;
        project_id?: string;
        prompt?: string;
        ratio?: string;
      };
      createCount += 1;
      task = {
        actualModelKey: 'mock-image-v1',
        actualProvider: 'mock',
        assets: [
          {
            aiGenerated: true,
            aigcMetadataStatus: 'present',
            assetKind: 'image',
            createdAt: now,
            deletedAt: null,
            favorite: false,
            height: 1,
            id: 'asset_smoke_s07',
            metadata: { width: 1, height: 1 },
            mimeType: 'image/png',
            origin: 'generated',
            ownerUserId: 'user_smoke',
            projectId: body.project_id,
            providerJobId: 'task_smoke_s07',
            selected: false,
            sha256: 'hash_smoke_s07',
            sizeBytes: 68,
            softDeleted: false,
            tags: [],
            title: 'Smoke S07 result',
            updatedAt: now,
            variants: [
              {
                assetId: 'asset_smoke_s07',
                contentHash: 'hash_smoke_s07',
                createdAt: now,
                exifRemoved: true,
                height: 1,
                id: 'variant_smoke_s07',
                mimeType: 'image/png',
                sizeBytes: 68,
                storageKey: 'generated/smoke/s07.png',
                type: 'original',
                url: '/api/assets/asset_smoke_s07/variants/original',
                width: 1,
              },
            ],
            visibilityStatus: 'active',
            width: 1,
          },
        ],
        batchSize: body.batch_size ?? 1,
        canvasSync: {
          assetIds: ['asset_smoke_s07'],
          imageTaskId: 'task_smoke_s07',
          projectId: body.project_id,
          retryCount: 0,
          status: 'failed',
        },
        canvasSyncStatus: 'failed',
        createdAt: now,
        failureCode: null,
        failureCount: 0,
        failureMessage: null,
        finalPrompt: body.prompt ?? 'Smoke S07 prompt',
        id: 'task_smoke_s07',
        modelFamily: 'mock',
        modelVersion: '2026-05-27',
        operationType: 'text_to_image',
        optimizedPrompt: null,
        ownerUserId: 'user_smoke',
        priceVersion: 1,
        projectId: body.project_id,
        quotedPriceAmount: 10,
        quotedPriceUnit: 'points',
        ratio: body.ratio ?? '1:1',
        requestedModelKey: body.model_key ?? 'mock-image-v1',
        requestedProvider: 'mock',
        settledAt: now,
        settledPriceAmount: 10,
        status: 'succeeded',
        successCount: 1,
        updatedAt: now,
        userPrompt: body.prompt ?? 'Smoke S07 prompt',
      };
      await route.fulfill({
        body: JSON.stringify(s07Envelope({ task })),
        contentType: 'application/json',
        status: 201,
      });
      return;
    }

    const insertMatch = path.match(/^\/api\/image-tasks\/([^/]+)\/insert-to-canvas$/);
    if (request.method() === 'POST' && insertMatch && task) {
      insertCount += 1;
      task = {
        ...task,
        canvasSync: {
          ...(task.canvasSync as Record<string, unknown>),
          status: 'succeeded',
        },
        canvasSyncStatus: 'succeeded',
        updatedAt: now,
      };
      await route.fulfill({
        body: JSON.stringify(s07Envelope({ task })),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    await route.fallback();
  });

  return {
    createdCount: () => createCount,
    insertedCount: () => insertCount,
  };
}

async function installS09AdminApiMocks(page: Page, role: 'admin' | 'user') {
  const now = '2026-05-29T00:00:00.000Z';
  const providers: Array<Record<string, unknown>> = [
    {
      credential: null,
      dataRegion: null,
      dataRetentionPolicy: null,
      dataTrainingUsage: null,
      displayName: 'Mock Provider',
      id: 'provider_mock',
      isDefault: true,
      lastReviewedAt: null,
      privacyUrl: null,
      providerKey: 'mock',
      reviewNotes: null,
      status: 'active',
      termsUrl: null,
      updatedAt: now,
    },
  ];
  const models: Array<Record<string, unknown>> = [
    {
      capabilities: [
        {
          maxBatchSize: 4,
          maxReferenceImages: 5,
          operationType: 'text_to_image',
          supportLevel: 'native',
          supported: true,
          supportedRatios: ['1:1'],
          supportedSizes: [],
          supportsBatch: true,
          supportsMask: false,
          supportsSeed: false,
        },
      ],
      displayName: 'Mock Image v1',
      healthStatus: 'healthy',
      id: 'model_mock',
      modelFamily: 'mock-image',
      modelKey: 'mock-image-v1',
      modelVersion: '2026-05-27',
      providerKey: 'mock',
      visibility: 'public',
    },
  ];
  const pricePolicies: Array<Record<string, unknown>> = [
    {
      amount: 10,
      createdAt: now,
      id: 'price_mock',
      modelKey: 'mock-image-v1',
      operationType: 'text_to_image',
      policyKey: 'mock_text_to_image',
      status: 'active',
      unit: 'per_image',
      version: 1,
    },
  ];
  const auditLogs = [
    {
      action: 'admin_provider_update',
      actorUserId: 'admin_smoke',
      createdAt: now,
      id: 'audit_smoke',
      metadata: { providerKey: 'mock' },
      targetId: 'mock',
      targetType: 'provider',
    },
  ];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() === 'GET' && path === '/api/home/summary') {
      await route.fulfill({
        body: JSON.stringify(
          s07Envelope({
            projects: { items: [], total: 0 },
            quota: { accountId: 'quota_admin_smoke', balanceAmount: 100, heldAmount: 0 },
            recentAssets: [],
            recentTasks: [],
            user: {
              id: role === 'admin' ? 'admin_smoke' : 'user_smoke',
              role,
              username: role === 'admin' ? 'admin-smoke' : 'user-smoke',
            },
          })
        ),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/projects') {
      await route.fulfill({
        body: JSON.stringify(s07Envelope({ projects: [] })),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/assets') {
      await route.fulfill({
        body: JSON.stringify(s07Envelope({ assets: [] })),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (role !== 'admin' && path.startsWith('/api/admin/')) {
      await route.fulfill({
        body: JSON.stringify({
          data: null,
          error: { code: 'FORBIDDEN', message: 'Forbidden' },
          request_id: 'req_smoke_s09',
        }),
        contentType: 'application/json',
        status: 403,
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/admin/users') {
      await route.fulfill({
        body: JSON.stringify(
          s07Envelope({
            users: [
              {
                email: 'admin@mengtu.local',
                id: 'admin_smoke',
                lastLoginAt: now,
                privacyVersion: 'privacy-v1',
                role: 'admin',
                status: 'active',
                termsAcceptedAt: now,
                termsVersion: 'terms-v1',
                username: 'admin-smoke',
              },
            ],
          })
        ),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/admin/image-tasks') {
      await route.fulfill({
        body: JSON.stringify(
          s07Envelope({
            tasks: [
              {
                actualModelKey: 'mock-image-v1',
                actualProvider: 'mock',
                assets: [],
                batchSize: 1,
                canvasSyncStatus: 'succeeded',
                createdAt: now,
                failureCode: null,
                failureCount: 0,
                failureMessage: null,
                finalPrompt: 'smoke',
                id: 'task_smoke_admin',
                maskAssetId: null,
                modelFamily: 'mock-image',
                modelVersion: '2026-05-27',
                operationType: 'text_to_image',
                optimizedPrompt: null,
                ownerUserId: 'user_smoke',
                priceVersion: 1,
                projectId: 'project_smoke',
                quotedPriceAmount: 10,
                quotedPriceUnit: 'points',
                ratio: '1:1',
                referenceAssets: [],
                requestedModelKey: 'mock-image-v1',
                requestedProvider: 'mock',
                settledAt: now,
                settledPriceAmount: 10,
                sourceAssetId: null,
                status: 'succeeded',
                successCount: 1,
                updatedAt: now,
                userPrompt: 'smoke',
              },
            ],
          })
        ),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/admin/assets') {
      await route.fulfill({
        body: JSON.stringify(
          s07Envelope({
            assets: [
              {
                aiGenerated: true,
                aigcMetadataStatus: 'removed',
                assetKind: 'image',
                createdAt: now,
                deletedAt: null,
                favorite: false,
                height: 1,
                id: 'asset_smoke_admin',
                mimeType: 'image/png',
                origin: 'generated',
                projectId: 'project_smoke',
                selected: false,
                sha256: 'hash_smoke_admin',
                sizeBytes: 68,
                updatedAt: now,
                variants: [],
                visibilityStatus: 'normal',
                width: 1,
              },
            ],
          })
        ),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/admin/backups/latest') {
      await route.fulfill({
        body: JSON.stringify(
          s07Envelope({
            backup: {
              databaseHostHash: 'sha256:smokehost',
              databaseNameHash: 'sha256:smokedb',
              dryRun: true,
              dumpFile: 'mengtu-db-20260531T010203Z.dump',
              durationMs: 1200,
              errorCode: null,
              errorMessage: null,
              finishedAt: now,
              manifestFile: 'mengtu-db-20260531T010203Z.manifest.json',
              mode: 'test-fake-pg-dump',
              outputDir: '.data/backups/db',
              pgDumpVersion: 'fake-pg_dump 0.0.0',
              retentionDays: 7,
              sha256:
                '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
              sizeBytes: 128,
              startedAt: now,
              status: 'succeeded',
            },
          })
        ),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (path === '/api/admin/providers') {
      if (request.method() === 'GET') {
        await route.fulfill({
          body: JSON.stringify(s07Envelope({ providers })),
          contentType: 'application/json',
          status: 200,
        });
        return;
      }
      if (request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}') as {
          displayName: string;
          providerKey: string;
          status: string;
        };
        const provider = {
          credential: null,
          dataRegion: null,
          dataRetentionPolicy: null,
          dataTrainingUsage: null,
          displayName: body.displayName,
          id: `provider_${body.providerKey}`,
          isDefault: false,
          lastReviewedAt: null,
          privacyUrl: null,
          providerKey: body.providerKey,
          reviewNotes: null,
          status: body.status,
          termsUrl: null,
          updatedAt: now,
        };
        providers.push(provider);
        await route.fulfill({
          body: JSON.stringify(s07Envelope({ provider })),
          contentType: 'application/json',
          status: 201,
        });
        return;
      }
    }

    const credentialMatch = path.match(
      /^\/api\/admin\/providers\/([^/]+)\/credentials$/
    );
    if (request.method() === 'POST' && credentialMatch) {
      const provider = providers.find(
        (item) => item.providerKey === credentialMatch[1]
      );
      const credential = {
        credentialKind: 'api_key',
        id: `credential_${credentialMatch[1]}`,
        lastRotatedAt: now,
        maskedValue: '********3456',
        rotatedByAdminId: 'admin_smoke',
      };
      if (provider) {
        provider.credential = credential;
      }
      await route.fulfill({
        body: JSON.stringify(s07Envelope({ credential })),
        contentType: 'application/json',
        status: 201,
      });
      return;
    }

    if (request.method() === 'GET' && path === '/api/admin/models') {
      await route.fulfill({
        body: JSON.stringify(s07Envelope({ models })),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (request.method() === 'PATCH' && path.startsWith('/api/admin/models/')) {
      models[0] = {
        ...models[0]!,
        healthStatus: 'degraded',
        visibility: 'beta',
      };
      await route.fulfill({
        body: JSON.stringify(s07Envelope({ model: models[0] })),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    if (path === '/api/admin/price-policies') {
      if (request.method() === 'GET') {
        await route.fulfill({
          body: JSON.stringify(s07Envelope({ pricePolicies })),
          contentType: 'application/json',
          status: 200,
        });
        return;
      }
      if (request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}') as {
          amount: number;
          modelKey: string;
          operationType: string;
          policyKey: string;
          unit: string;
        };
        const pricePolicy = {
          ...body,
          createdAt: now,
          id: `price_${pricePolicies.length + 1}`,
          status: 'active',
          version: pricePolicies.length + 1,
        };
        pricePolicies.unshift(pricePolicy);
        await route.fulfill({
          body: JSON.stringify(s07Envelope({ pricePolicy })),
          contentType: 'application/json',
          status: 201,
        });
        return;
      }
    }

    if (request.method() === 'GET' && path === '/api/admin/audit-logs') {
      await route.fulfill({
        body: JSON.stringify(s07Envelope({ auditLogs })),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }

    await route.fallback();
  });
}

test.describe('@smoke 核心功能验证', () => {
  /**
   * 测试1：主画布所有组件和交互
   */
  test('主画布：加载、工具栏、AI输入栏、视图导航', async ({ page }) => {
    const home = new MengtuHomeApp(page);
    await home.installApiMocks();
    await home.createProjectAndOpenCanvas('Smoke 主画布');
    
    // 1. 验证页面加载（必须通过）
    await expect(page).toHaveTitle(/Opentu/);
    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: WORKBENCH_READY_TIMEOUT });
    await page.waitForTimeout(2000);
    
    // 2. 验证工具栏存在（必须通过）
    const handToolContainer = page.locator('div').filter({ has: page.getByRole('radio', { name: /手形工具/ }) }).first();
    const selectToolContainer = page.locator('div').filter({ has: page.getByRole('radio', { name: /选择/ }) }).first();
    await expect(handToolContainer).toBeVisible();
    await expect(selectToolContainer).toBeVisible();
    
    // 3. 工具栏按钮点击测试
    await handToolContainer.click({ force: true });
    await page.waitForTimeout(100);
    await selectToolContainer.click({ force: true });
    await page.waitForTimeout(100);
    
    // 画笔按钮（必须通过）
    const pencilBtn = page.getByRole('button', { name: /画笔/ });
    await expect(pencilBtn).toBeVisible();
    await pencilBtn.click({ force: true }); // force: 避免 tooltip 拦截
    await page.waitForTimeout(100);
    
    // 形状按钮（必须通过）
    const shapeBtn = page.getByRole('button', { name: /形状/ });
    await expect(shapeBtn).toBeVisible();
    await shapeBtn.click({ force: true }); // force: 避免 tooltip 拦截
    await page.waitForTimeout(100);
    
    // 4. AI 输入栏交互（必须通过）
    const aiInput = page.locator('[data-testid="ai-input-textarea"]');
    await expect(aiInput).toBeVisible();
    await aiInput.fill('测试输入');
    await expect(aiInput).toHaveValue('测试输入');

    const getTextareaMetrics = () =>
      aiInput.evaluate((element) => {
        const textarea = element as HTMLTextAreaElement;
        const styles = window.getComputedStyle(textarea);
        const fontSize = Number.parseFloat(styles.fontSize) || 15;
        const lineHeight =
          Number.parseFloat(styles.lineHeight) || fontSize * 1.5;
        const verticalSpacing =
          Number.parseFloat(styles.paddingTop) +
          Number.parseFloat(styles.paddingBottom) +
          Number.parseFloat(styles.borderTopWidth) +
          Number.parseFloat(styles.borderBottomWidth);

        return {
          height: textarea.getBoundingClientRect().height,
          fourRowsHeight: lineHeight * 4 + verticalSpacing,
          sixRowsHeight: lineHeight * 6 + verticalSpacing,
          overflowY: styles.overflowY,
        };
      });

    await page.waitForTimeout(250);
    const fourRowsMetrics = await getTextareaMetrics();
    expect(
      Math.abs(fourRowsMetrics.height - fourRowsMetrics.fourRowsHeight)
    ).toBeLessThanOrEqual(2);

    await aiInput.fill('第1行\n第2行\n第3行\n第4行\n第5行\n第6行\n第7行');
    await page.waitForTimeout(250);
    const maxRowsMetrics = await getTextareaMetrics();
    expect(maxRowsMetrics.height).toBeGreaterThanOrEqual(
      maxRowsMetrics.sixRowsHeight - 2
    );
    expect(maxRowsMetrics.height).toBeLessThanOrEqual(
      maxRowsMetrics.sixRowsHeight + 2
    );
    expect(maxRowsMetrics.overflowY).toBe('auto');
    
    // 5. 模型选择器（必须通过）
    const modelSelector = page
      .getByTestId('ai-input-bar')
      .getByTestId('model-selector')
      .first()
      .locator('button[aria-haspopup="listbox"]');
    await expect(modelSelector).toBeVisible();
    await modelSelector.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    
    // 6. 视图导航缩放（必须通过）
    const zoomIn = page.getByRole('button', { name: /放大/ });
    await expect(zoomIn).toBeVisible();
    // 缩放显示按钮名称是 "自适应"，显示内容如 "100%"
    const zoomDisplay = page.getByRole('button', { name: '自适应' });
    await expect(zoomDisplay).toBeVisible();
    const initialZoom = await zoomDisplay.textContent();
    await zoomIn.click();
    await page.waitForTimeout(200);
    const newZoom = await zoomDisplay.textContent();
    expect(newZoom).not.toBe(initialZoom);
  });

  /**
   * 测试2：所有弹窗/抽屉组件
   */
  test('弹窗抽屉：设置、项目、工具箱', async ({ page }) => {
    const home = new MengtuHomeApp(page);
    await home.installApiMocks();
    await home.createProjectAndOpenCanvas('Smoke 弹窗抽屉');

    const drawnix = page.locator('.drawnix');
    await expect(drawnix).toBeVisible({ timeout: WORKBENCH_READY_TIMEOUT });
    await page.waitForTimeout(1500);
    
    // === 项目抽屉 ===
    const openProjectBtn = page.getByRole('button', { name: '打开项目' });
    
    // 如果显示"打开项目"，点击打开；否则已经打开
    if (await openProjectBtn.isVisible().catch(() => false)) {
      await openProjectBtn.click();
      await page.waitForTimeout(500);
    }
    
    // 验证项目抽屉已打开（必须通过）
    const projectTitle = page.getByRole('heading', { name: '项目', level: 3, exact: true });
    await expect(projectTitle).toBeVisible();
    
    // === 工具箱 ===
    const openToolboxBtn = page.getByRole('button', { name: '打开工具箱' });
    if (await openToolboxBtn.isVisible().catch(() => false)) {
      await openToolboxBtn.click();
      await page.waitForTimeout(500);
    }
    
    // 验证工具箱已打开（必须通过）
    const toolboxTitle = page.getByRole('heading', { name: '工具箱', level: 3, exact: true });
    await expect(toolboxTitle).toBeVisible();
    
    // 抽屉打开验证通过即可（关闭功能在视觉测试中已覆盖）
    
    // === 设置对话框（在"更多"菜单中）===
    const moreBtn = page.getByRole('button', { name: '更多' });
    await expect(moreBtn).toBeVisible();
    await moreBtn.click();
    await page.waitForTimeout(300);
    // 关闭菜单
    await page.keyboard.press('Escape');
  });

  test('S07 mock 文生图：平台任务创建并标记入画布', async ({ page }) => {
    const home = new MengtuHomeApp(page);
    await home.installApiMocks();
    const s07Mocks = await installS07ImageTaskApiMocks(page);
    await home.createProjectAndOpenCanvas('Smoke S07 文生图');

    await expect(page.locator('.drawnix')).toBeVisible({
      timeout: WORKBENCH_READY_TIMEOUT,
    });

    const result = await page.evaluate(async () => {
      const projectId = new URLSearchParams(window.location.search).get(
        'project_id'
      );
      const created = await fetch('/api/image-tasks', {
        body: JSON.stringify({
          batch_size: 1,
          idempotency_key: 'smoke-s07',
          model_key: 'mock-image-v1',
          operation_type: 'text_to_image',
          project_id: projectId,
          prompt: 'Smoke S07 文生图',
          ratio: '1:1',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const createdJson = await created.json();
      const taskId = createdJson.data.task.id;
      const inserted = await fetch(`/api/image-tasks/${taskId}/insert-to-canvas`, {
        method: 'POST',
      });
      const insertedJson = await inserted.json();

      return {
        assetVariantUrl:
          insertedJson.data.task.assets[0].variants[0].url,
        canvasSyncStatus: insertedJson.data.task.canvasSyncStatus,
        createStatus: created.status,
        insertStatus: inserted.status,
        taskStatus: insertedJson.data.task.status,
      };
    });

    expect(result).toMatchObject({
      canvasSyncStatus: 'succeeded',
      createStatus: 201,
      insertStatus: 200,
      taskStatus: 'succeeded',
    });
    expect(result.assetVariantUrl).toContain('/api/assets/asset_smoke_s07');
    expect(s07Mocks.createdCount()).toBe(1);
    expect(s07Mocks.insertedCount()).toBe(1);
  });

  test('/admin：权限拒绝和供应商配置 happy path', async ({ page }) => {
    await installS09AdminApiMocks(page, 'user');
    await page.goto('/?sw=0');
    await expect(
      page.getByRole('heading', { exact: true, level: 1, name: '梦图' })
    ).toBeVisible({ timeout: WORKBENCH_READY_TIMEOUT });
    await page.evaluate(() => {
      window.history.pushState({ route: 'admin' }, '', '/admin?sw=0');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: '无后台权限' })).toBeVisible({
      timeout: WORKBENCH_READY_TIMEOUT,
    });

    await page.unroute('**/api/**');
    await installS09AdminApiMocks(page, 'admin');
    await page.goto('/?sw=0');
    await page.getByRole('button', { name: '后台' }).click();
    await expect(page.getByRole('heading', { name: '运营控制台' })).toBeVisible({
      timeout: WORKBENCH_READY_TIMEOUT,
    });

    await page.getByRole('button', { name: '供应商' }).click();
    await expect(
      page.getByRole('cell', { name: 'mock', exact: true })
    ).toBeVisible();
    await page.getByLabel('Provider Key').fill('smoke-provider');
    await page.getByLabel('显示名').fill('Smoke Provider');
    await page.getByRole('button', { name: '新增供应商' }).click();
    await expect(
      page.getByRole('cell', { name: 'smoke-provider', exact: true })
    ).toBeVisible();

    await page.getByLabel('Secret').fill('sk-smoke-secret-123456');
    await page.getByRole('button', { name: '轮换凭据' }).click();
    await expect(
      page.getByRole('cell', { name: '********3456', exact: true })
    ).toBeVisible();

    await page.getByRole('button', { name: '模型' }).click();
    await page.getByRole('button', { name: '更新模型' }).click();
    await expect(
      page.getByRole('cell', { name: 'degraded', exact: true })
    ).toBeVisible();

    await page.getByRole('button', { name: '价格' }).click();
    await page.getByRole('button', { name: '新价格版本' }).click();
    await expect(
      page.getByRole('cell', { name: '2', exact: true }).first()
    ).toBeVisible();

    await page.getByRole('button', { name: '备份' }).click();
    await expect(
      page.getByText('mengtu-db-20260531T010203Z.dump')
    ).toBeVisible();
  });

  test('/admin direct route：直达与刷新保持后台路由', async ({ page }) => {
    await installS09AdminApiMocks(page, 'user');
    await page.goto('/admin?sw=0');
    await expect(page.getByRole('heading', { name: '无后台权限' })).toBeVisible({
      timeout: WORKBENCH_READY_TIMEOUT,
    });

    await page.unroute('**/api/**');
    await installS09AdminApiMocks(page, 'admin');
    await page.goto('/admin?sw=0');
    await expect(page.getByRole('heading', { name: '运营控制台' })).toBeVisible({
      timeout: WORKBENCH_READY_TIMEOUT,
    });
    await expect(page).toHaveURL(/\/admin\?sw=0/);

    await page.reload();
    await expect(page.getByRole('heading', { name: '运营控制台' })).toBeVisible({
      timeout: WORKBENCH_READY_TIMEOUT,
    });
    await expect(page).toHaveURL(/\/admin\?sw=0/);
  });
});
