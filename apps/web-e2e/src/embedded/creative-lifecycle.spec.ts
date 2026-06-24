/**
 * @tags creative-embedded
 * No-provider lifecycle coverage for the OpenTU build embedded by new-api.
 *
 * This spec intentionally avoids live provider calls. It seeds local browser
 * storage with Creative task/workspace state, mocks only same-origin Creative
 * broker endpoints, then verifies refresh/resume/cache/viewport behavior.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForDrawnixReady } from '../support/drawnix-ready';

const embeddedBaseURL = process.env['CREATIVE_EMBEDDED_BASE_URL'];
const GENERATED_CACHE_MISS_EVENT = 'creative:generated-media-cache-miss';
const GENERATED_IMAGE_CACHE = 'drawnix-images';
const TASK_DB = 'aitu-app';
const TASK_STORE = 'tasks';
const WORKSPACE_DB = 'aitu-workspace';
const WORKSPACE_STORES = ['folders', 'boards', 'state'] as const;
const WORKSPACE_STATE_KEY = 'workspace_state';
const UNIFIED_CACHE_DB = 'drawnix-unified-cache';
const UNIFIED_CACHE_STORE = 'media';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64'
);

type CreativeSeedTask = {
  id: string;
  type: 'image';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  params: Record<string, unknown> & { prompt: string };
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: Record<string, unknown>;
  progress?: number;
  remoteId?: string;
  invocationRoute?: Record<string, unknown>;
  executionPhase?: string;
  insertedToCanvas?: boolean;
  archived?: boolean;
};

type CreativeSeedBoard = {
  id: string;
  name: string;
  folderId: null;
  order: number;
  elements: Array<Record<string, unknown>>;
  viewport?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

function creativeRootFromBase(baseURL: string | undefined): URL {
  expect(baseURL, 'creative embedded project must have a baseURL').toBeTruthy();
  const creativeRoot = new URL(baseURL!);
  if (!creativeRoot.pathname.endsWith('/')) {
    creativeRoot.pathname = `${creativeRoot.pathname}/`;
  }
  expect(creativeRoot.pathname.endsWith('/creative/')).toBeTruthy();
  return creativeRoot;
}

function createManagedImageTask(
  overrides: Partial<CreativeSeedTask> = {}
): CreativeSeedTask {
  const now = Date.now();
  const remoteId = String(overrides.remoteId || 'remote-e2e-resume');
  return {
    id: 'task-e2e-resume',
    type: 'image',
    status: 'processing',
    params: {
      prompt: 'no-provider e2e image',
      model: 'mock:gpt-image-2:preview',
      modelRef: {
        profileId: 'new-api-creative',
        modelId: 'mock:gpt-image-2:preview',
      },
      creativeManaged: true,
      userParams: {},
      retryAttempt: 0,
      autoInsertToCanvas: false,
    },
    createdAt: now - 10_000,
    updatedAt: now - 5_000,
    startedAt: now - 8_000,
    progress: 55,
    remoteId,
    executionPhase: 'polling',
    invocationRoute: {
      operation: 'image',
      providerProfileId: 'new-api-creative',
      modelId: 'mock:gpt-image-2:preview',
      modelRef: {
        profileId: 'new-api-creative',
        modelId: 'mock:gpt-image-2:preview',
      },
      binding: {
        protocol: 'session-broker',
        requestSchema: 'new-api.creative.image.task',
        submitPath: '/images/tasks',
        pollPathTemplate: '/images/tasks/{taskId}',
      },
    },
    insertedToCanvas: false,
    ...overrides,
  };
}

function createBoard(overrides: Partial<CreativeSeedBoard> = {}): CreativeSeedBoard {
  const now = Date.now();
  return {
    id: 'board-e2e-lifecycle',
    name: 'E2E lifecycle board',
    folderId: null,
    order: 1,
    elements: [],
    viewport: {
      zoom: 0.42,
      origination: [321, 654],
    },
    createdAt: now - 20_000,
    updatedAt: now - 10_000,
    ...overrides,
  };
}

async function installNoProviderCreativeRoutes(
  page: Page,
  options: { imageTaskStatuses?: string[] } = {}
): Promise<{ getImageTaskStatusRequestCount: () => number }> {
  const imageTaskStatusRequestCounts = new Map<string, number>();

  await page.route('**/creative/api/bootstrap', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          auth: {
            mode: 'session-broker',
            csrfToken: 'e2e-csrf-token',
            nonce: 'e2e-nonce-token',
          },
          capabilities: { videoRelayEnabled: false },
          assetSync: { enabled: false, disabledReason: 'e2e_no_provider' },
          modelPolicy: {
            defaults: { image: 'mock:gpt-image-2:preview' },
            recommended: { image: ['mock:gpt-image-2:preview'] },
          },
        },
      }),
    });
  });

  await page.route('**/creative/api/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'mock:gpt-image-2:preview',
            label: 'Mock GPT Image 2',
            type: 'image',
            vendor: 'GPT',
            parameterSchema: [],
          },
        ],
      }),
    });
  });

  await page.route('**/creative/api/preferences/model', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { preference: {}, revision: 1 } }),
      });
      return;
    }
    await route.fulfill({
      status: 204,
      body: '',
    });
  });

  await page.route('**/creative/relay/v1/images/tasks/**', async (route) => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/\/creative\/relay\/v1\/images\/tasks\/([^/]+)(\/content)?$/);
    if (!match) {
      await route.fallback();
      return;
    }

    const remoteId = decodeURIComponent(match[1]);
    const isContent = Boolean(match[2]);
    if (isContent) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: PNG_1X1,
      });
      return;
    }

    const requestCount = imageTaskStatusRequestCounts.get(remoteId) || 0;
    imageTaskStatusRequestCounts.set(remoteId, requestCount + 1);
    const statusSequence = options.imageTaskStatuses || ['completed'];
    const status =
      statusSequence[Math.min(requestCount, statusSequence.length - 1)] ||
      'completed';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        task_id: remoteId,
        status,
        ...(status === 'completed'
          ? {
              result: {
                url: `/creative/relay/v1/images/tasks/${encodeURIComponent(remoteId)}/content`,
                mimeType: 'image/png',
                targetWidth: 1536,
                targetHeight: 864,
              },
            }
          : {}),
      }),
    });
  });

  return {
    getImageTaskStatusRequestCount: () =>
      Array.from(imageTaskStatusRequestCounts.values()).reduce(
        (total, count) => total + count,
        0
      ),
  };
}

async function seedCreativeLifecycleState(
  page: Page,
  params: { tasks: CreativeSeedTask[]; board: CreativeSeedBoard }
): Promise<void> {
  await page.evaluate(async ({ tasks, board }) => {
    function openDb(
      name: string,
      onUpgrade: (db: IDBDatabase) => void
    ): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => onUpgrade(request.result);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }

    function txDone(tx: IDBTransaction): Promise<void> {
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    const taskDb = await openDb('aitu-app', (db) => {
      if (!db.objectStoreNames.contains('tasks')) {
        const store = db.createObjectStore('tasks', { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    });
    const taskTx = taskDb.transaction('tasks', 'readwrite');
    const taskStore = taskTx.objectStore('tasks');
    taskStore.clear();
    for (const task of tasks) {
      taskStore.put(task);
    }
    await txDone(taskTx);
    taskDb.close();

    const workspaceDb = await openDb('aitu-workspace', (db) => {
      for (const storeName of ['folders', 'boards', 'state']) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    });
    const workspaceTx = workspaceDb.transaction(['folders', 'boards', 'state'], 'readwrite');
    workspaceTx.objectStore('folders').clear();
    const boards = workspaceTx.objectStore('boards');
    boards.clear();
    boards.put(board, board.id);
    const state = workspaceTx.objectStore('state');
    state.clear();
    state.put(
      {
        currentBoardId: null,
        expandedFolderIds: [],
        sidebarWidth: 280,
        sidebarCollapsed: false,
        migrationCompleted: true,
      },
      'workspace_state'
    );
    await txDone(workspaceTx);
    workspaceDb.close();

    const unifiedDb = await openDb('drawnix-unified-cache', (db) => {
      if (!db.objectStoreNames.contains('media')) {
        const store = db.createObjectStore('media', { keyPath: 'url' });
        store.createIndex('cachedAt', 'cachedAt', { unique: false });
        store.createIndex('lastUsed', 'lastUsed', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    });
    const unifiedTx = unifiedDb.transaction('media', 'readwrite');
    unifiedTx.objectStore('media').clear();
    await txDone(unifiedTx);
    unifiedDb.close();

    await caches.delete('drawnix-images');
    localStorage.removeItem('aitu_board_close_snapshot_v1');
    sessionStorage.setItem('workspace-current-board-id', board.id);
  }, params);
}

async function loadCreativeWithSeededLifecycleState(
  page: Page,
  creativeRoot: URL,
  params: { tasks: CreativeSeedTask[]; board: CreativeSeedBoard }
): Promise<void> {
  // Establish the target origin without booting the SPA first. Loading the app
  // before seeding lets its async startup create/persist a default board, which
  // can race with the seeded IndexedDB/sessionStorage state and hide the seeded
  // canvas element from the lifecycle assertion.
  await page.goto(new URL('api/bootstrap', creativeRoot).toString(), {
    waitUntil: 'domcontentloaded',
  });
  await seedCreativeLifecycleState(page, params);
  await page.goto(creativeRoot.toString(), { waitUntil: 'domcontentloaded' });
  await waitForDrawnixReady(page);
}

async function readStoredTask(
  page: Page,
  taskId: string
): Promise<CreativeSeedTask | null> {
  return await page.evaluate(
    async ({ dbName, storeName, id }) => {
      return await new Promise<CreativeSeedTask | null>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(storeName, 'readonly');
          const get = tx.objectStore(storeName).get(id);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result || null);
          tx.oncomplete = () => db.close();
        };
      });
    },
    { dbName: TASK_DB, storeName: TASK_STORE, id: taskId }
  );
}

async function readStoredBoard(
  page: Page,
  boardId: string
): Promise<CreativeSeedBoard | null> {
  return await page.evaluate(
    async ({ dbName, boardStore, id }) => {
      return await new Promise<CreativeSeedBoard | null>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(boardStore, 'readonly');
          const get = tx.objectStore(boardStore).get(id);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result || null);
          tx.oncomplete = () => db.close();
        };
      });
    },
    { dbName: WORKSPACE_DB, boardStore: WORKSPACE_STORES[1], id: boardId }
  );
}

async function readUnifiedCacheMetadata(
  page: Page,
  url: string
): Promise<Record<string, unknown> | null> {
  return await page.evaluate(
    async ({ dbName, storeName, cacheUrl }) => {
      return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(storeName)) {
            resolve(null);
            db.close();
            return;
          }
          const tx = db.transaction(storeName, 'readonly');
          const get = tx.objectStore(storeName).get(cacheUrl);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result || null);
          tx.oncomplete = () => db.close();
        };
      });
    },
    { dbName: UNIFIED_CACHE_DB, storeName: UNIFIED_CACHE_STORE, cacheUrl: url }
  );
}

async function cacheHas(page: Page, url: string): Promise<boolean> {
  return await page.evaluate(
    async ({ cacheName, cacheUrl }) => {
      const cache = await caches.open(cacheName);
      return Boolean(await cache.match(cacheUrl));
    },
    { cacheName: GENERATED_IMAGE_CACHE, cacheUrl: url }
  );
}

test.describe('@creative-embedded no-provider runtime lifecycle', () => {
  test.setTimeout(120_000);
  test.skip(
    !embeddedBaseURL,
    'Set CREATIVE_EMBEDDED_BASE_URL=http://localhost:<port>/creative/ to run the embedded lifecycle gate.'
  );

  test('refresh resumes a remote Creative image task and materializes Cache Storage', async ({
    page,
    baseURL,
  }) => {
    const creativeRoot = creativeRootFromBase(baseURL);
    const remoteId = 'remote-e2e-resume';
    const task = createManagedImageTask({ remoteId });
    const board = createBoard();
    const expectedCacheUrl = `/__aitu_cache__/image/${remoteId}.png`;

    await installNoProviderCreativeRoutes(page);
    await loadCreativeWithSeededLifecycleState(page, creativeRoot, {
      tasks: [task],
      board,
    });

    let lastResumeTask: CreativeSeedTask | null = null;
    try {
      await expect
        .poll(
          async () => {
            lastResumeTask = await readStoredTask(page, task.id);
            return lastResumeTask?.status;
          },
          {
            timeout: 45_000,
            message:
              'restored managed remote image task should become completed without opening generation UI',
          }
        )
        .toBe('completed');
    } catch (error) {
      const suffix = `\nLast stored task: ${JSON.stringify(lastResumeTask)}`;
      if (error instanceof Error) {
        error.message += suffix;
      }
      throw error;
    }

    const completed = await readStoredTask(page, task.id);
    expect(completed).toMatchObject({
      id: task.id,
      status: 'completed',
      remoteId,
      result: expect.objectContaining({
        url: expectedCacheUrl,
        contentUrl: `/creative/relay/v1/images/tasks/${remoteId}/content`,
        remoteTaskId: remoteId,
        providerTaskId: remoteId,
        mimeType: 'image/png',
      }),
    });

    await expect
      .poll(async () => cacheHas(page, expectedCacheUrl), {
        timeout: 15_000,
        message: 'completed Creative image should be materialized in Cache Storage',
      })
      .toBe(true);

    const metadata = await readUnifiedCacheMetadata(page, expectedCacheUrl);
    expect(metadata).toMatchObject({
      url: expectedCacheUrl,
      type: 'image',
      mimeType: 'image/png',
      metadata: expect.objectContaining({
        taskId: task.id,
        contentUrl: `/creative/relay/v1/images/tasks/${remoteId}/content`,
        remoteTaskId: remoteId,
      }),
    });
  });

  test('refresh keeps a slow remote Creative image task resumable until provider completion', async ({
    page,
    baseURL,
  }) => {
    const creativeRoot = creativeRootFromBase(baseURL);
    const remoteId = 'remote-e2e-slow-resume';
    const task = createManagedImageTask({
      id: 'task-e2e-slow-resume',
      remoteId,
      progress: 40,
    });
    const board = createBoard();

    const routes = await installNoProviderCreativeRoutes(page, {
      imageTaskStatuses: ['in_progress', 'in_progress', 'completed'],
    });
    await loadCreativeWithSeededLifecycleState(page, creativeRoot, {
      tasks: [task],
      board,
    });

    await expect
      .poll(async () => (await readStoredTask(page, task.id))?.status, {
        timeout: 60_000,
        message:
          'slow provider task should stay resumable and eventually complete after repeated status polls',
      })
      .toBe('completed');

    expect(routes.getImageTaskStatusRequestCount()).toBeGreaterThanOrEqual(3);
    const completed = await readStoredTask(page, task.id);
    expect(completed).toMatchObject({
      status: 'completed',
      remoteId,
      result: expect.objectContaining({
        url: `/__aitu_cache__/image/${remoteId}.png`,
      }),
    });
  });

  test('refresh keeps board state and cache-miss recovery rehydrates generated canvas media', async ({
    page,
    baseURL,
  }) => {
    const creativeRoot = creativeRootFromBase(baseURL);
    const taskId = 'task-e2e-cache-miss';
    const remoteId = 'remote-e2e-cache-miss';
    const imageUrl = '/__aitu_cache__/image/cache-miss-e2e.png';
    const contentUrl = `/creative/relay/v1/images/tasks/${remoteId}/content`;
    const elementId = 'image-e2e-cache-miss';
    const task = createManagedImageTask({
      id: taskId,
      remoteId,
      status: 'completed',
      progress: 100,
      executionPhase: undefined,
      completedAt: Date.now() - 1_000,
      result: {
        url: imageUrl,
        format: 'png',
        size: PNG_1X1.length,
        contentUrl,
        remoteTaskId: remoteId,
        providerTaskId: remoteId,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        targetWidth: 1536,
        targetHeight: 864,
      },
    });
    const board = createBoard({
      elements: [
        {
          id: elementId,
          type: 'image',
          url: imageUrl,
          points: [
            [120, 160],
            [1620, 1004],
          ],
          contentUrl,
          remoteTaskId: remoteId,
          providerTaskId: remoteId,
          mimeType: 'image/png',
        },
      ],
    });

    await installNoProviderCreativeRoutes(page);
    await loadCreativeWithSeededLifecycleState(page, creativeRoot, {
      tasks: [task],
      board,
    });

    const restoredBoard = await readStoredBoard(page, board.id);
    expect(restoredBoard).toMatchObject({
      id: board.id,
      elements: [
        expect.objectContaining({
          id: elementId,
          type: 'image',
          url: imageUrl,
          contentUrl,
          remoteTaskId: remoteId,
          providerTaskId: remoteId,
        }),
      ],
      viewport: expect.objectContaining({
        zoom: 0.42,
        origination: [321, 654],
      }),
    });

    expect(await cacheHas(page, imageUrl)).toBe(false);
    await page.evaluate((eventName) => {
      (window as Window & { __creativeCacheMissEvents?: number }).__creativeCacheMissEvents = 0;
      window.addEventListener(eventName, () => {
        const target = window as Window & { __creativeCacheMissEvents?: number };
        target.__creativeCacheMissEvents = (target.__creativeCacheMissEvents || 0) + 1;
      });
    }, GENERATED_CACHE_MISS_EVENT);

    const imageNode = page.locator(`img[src*="cache-miss-e2e"]`).first();
    await expect(imageNode).toBeAttached({ timeout: 15_000 });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await imageNode.evaluate((node) => {
        node.dispatchEvent(new Event('error', { bubbles: true }));
      });
      await page.waitForTimeout(900);
    }

    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              (window as Window & { __creativeCacheMissEvents?: number })
                .__creativeCacheMissEvents || 0
          ),
        {
          timeout: 15_000,
          message:
            'real image load failure should flow through asset-cleanup cache-miss event',
        }
      )
      .toBeGreaterThan(0);

    await expect
      .poll(async () => cacheHas(page, imageUrl), {
        timeout: 15_000,
        message: 'generated media cache miss should rehydrate from stored Creative contentUrl',
      })
      .toBe(true);

    const metadata = await readUnifiedCacheMetadata(page, imageUrl);
    expect(metadata).toMatchObject({
      url: imageUrl,
      type: 'image',
      metadata: expect.objectContaining({
        taskId,
        contentUrl,
        remoteTaskId: remoteId,
        providerTaskId: remoteId,
        mimeType: 'image/png',
      }),
    });

    await expect
      .poll(async () => {
        const latestBoard = await readStoredBoard(page, board.id);
        return String(latestBoard?.elements?.[0]?.url || '');
      }, {
        timeout: 15_000,
        message: 'canvas image node should be nudged with a retry URL after cache rehydrate',
      })
      .toContain(`${imageUrl}?_retry=`);

    const latestBoard = await readStoredBoard(page, board.id);
    expect(latestBoard?.elements).toHaveLength(1);
    expect(latestBoard?.viewport).toMatchObject({
      zoom: 0.42,
      origination: [321, 654],
    });
  });
});
