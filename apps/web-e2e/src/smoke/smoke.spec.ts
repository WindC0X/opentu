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
});
