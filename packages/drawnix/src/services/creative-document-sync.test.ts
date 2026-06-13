import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCreativeWorkspaceDocumentSnapshot,
  CreativeDocumentCloudAdapter,
  CreativeDocumentCloudSyncService,
  CREATIVE_DOCUMENT_CONFLICT_STORAGE_KEY,
  CreativeDocumentConflictError,
  type CreativeDocumentCloudAdapterLike,
  type CreativeDocumentSnapshot,
} from './creative-document-sync';
import {
  clearCreativeSessionAuthMaterial,
  setCreativeSessionAuthMaterial,
} from './creative-mode';
import type { Board } from '../types/workspace.types';

describe('CreativeDocumentCloudAdapter API contract', () => {
  async function expectSecretValueRejected(
    operation: () => Promise<unknown>
  ): Promise<void> {
    let caught: unknown;
    try {
      await operation();
    } catch (error) {
      caught = error;
    }

    if (!caught) {
      throw new Error('expected high-confidence secret payload to be rejected');
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({
      name: 'CreativeCloudSecretValueError',
      code: 'CREATIVE_CLOUD_SECRET_VALUE_BLOCKED',
    });
    expect((caught as Error).message).toMatch(/outbound creative document/i);
    expect((caught as Error).message).toMatch(/secret/i);
    expect((caught as Error).message).not.toMatch(
      /sk-test-1234567890|eyJhbGci|abcdef1234567890|signature/i
    );
    expect(JSON.stringify(caught)).not.toMatch(
      /sk-test-1234567890|eyJhbGci|abcdef1234567890|signature/i
    );
  }

  afterEach(() => {
    clearCreativeSessionAuthMaterial();
    vi.restoreAllMocks();
  });

  it('unwraps document list wrappers and maps backend time fields', async () => {
    const adapter = new CreativeDocumentCloudAdapter(
      (async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              documents: [
                {
                  id: 'doc-1',
                  title: 'Board',
                  revision: 2,
                  createdTime: 100,
                  updatedTime: 200,
                },
              ],
            },
          }),
          { status: 200 }
        )) as typeof fetch
    );

    await expect(adapter.list()).resolves.toEqual([
      {
        id: 'doc-1',
        title: 'Board',
        revision: 2,
        createdAt: 100,
        updatedAt: 200,
      },
    ]);
  });

  it('unwraps single document wrappers from create and get responses', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-doc-wrapper',
      nonce: 'nonce-doc-wrapper',
    });
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            document: {
              id: init?.method === 'POST' ? 'created-doc' : String(input).split('/').pop(),
              title: 'Board',
              snapshot: { elements: [] },
              revision: 3,
              createdTime: 111,
              updatedTime: 222,
            },
          },
        }),
        { status: 200 }
      )) as typeof fetch;
    const adapter = new CreativeDocumentCloudAdapter(fetcher, '/documents');

    await expect(adapter.create({ snapshot: { elements: [] } })).resolves.toEqual({
      id: 'created-doc',
      title: 'Board',
      snapshot: { elements: [] },
      revision: 3,
      createdAt: 111,
      updatedAt: 222,
    });
    await expect(adapter.get('doc-1')).resolves.toEqual({
      id: 'doc-1',
      title: 'Board',
      snapshot: { elements: [] },
      revision: 3,
      createdAt: 111,
      updatedAt: 222,
    });
  });

  it('sends numeric baseRevision and unwraps conflict document snapshots', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-doc',
      nonce: 'nonce-doc',
    });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Conflict',
          data: {
            revision: 6,
            document: {
              id: 'doc-1',
              title: 'Server Board',
              snapshot: { elements: ['server'] },
              revision: 6,
              updatedTime: 300,
            },
          },
        }),
        { status: 409 }
      );
    }) as typeof fetch;
    const adapter = new CreativeDocumentCloudAdapter(fetcher, '/documents');

    await expect(
      adapter.put(
        'doc-1',
        {
          snapshot: { elements: ['client'] },
          apiKey: 'leak',
        } as any,
        '5'
      )
    ).rejects.toMatchObject({
      status: 409,
      conflict: {
        revision: 6,
        snapshot: {
          id: 'doc-1',
          title: 'Server Board',
          snapshot: { elements: ['server'] },
          revision: 6,
          updatedAt: 300,
        },
      },
    } satisfies Partial<CreativeDocumentConflictError>);

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      snapshot: { elements: ['client'] },
      baseRevision: 5,
    });
    expect(calls[0].init?.headers).toMatchObject({
      'X-Creative-CSRF': 'csrf-doc',
      'X-Creative-Nonce': 'nonce-doc',
    });
    expect(JSON.stringify(calls[0])).not.toContain('leak');
  });

  it('attaches session auth headers to create and delete mutations', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-doc-2',
      nonce: 'nonce-doc-2',
    });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            document: {
              id: 'doc-1',
              snapshot: { elements: [] },
              revision: 1,
            },
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const adapter = new CreativeDocumentCloudAdapter(fetcher, '/documents');

    await adapter.create({ id: 'doc-1', snapshot: { elements: [] } });
    await adapter.delete('doc-1');

    expect(calls[0].init?.headers).toMatchObject({
      'X-Creative-CSRF': 'csrf-doc-2',
      'X-Creative-Nonce': 'nonce-doc-2',
    });
    expect(calls[1].init?.headers).toMatchObject({
      'X-Creative-CSRF': 'csrf-doc-2',
      'X-Creative-Nonce': 'nonce-doc-2',
    });
  });

  it('fails unsafe document mutations locally when session auth material is missing', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const adapter = new CreativeDocumentCloudAdapter(
      fetcher as unknown as typeof fetch,
      '/documents'
    );

    await expect(
      adapter.create({ id: 'doc-1', snapshot: { elements: [] } })
    ).rejects.toThrow(/Creative.*CSRF.*nonce/i);
    await expect(
      adapter.put('doc-1', { id: 'doc-1', snapshot: { elements: [] } })
    ).rejects.toThrow(/Creative.*CSRF.*nonce/i);
    await expect(adapter.delete('doc-1')).rejects.toThrow(
      /Creative.*CSRF.*nonce/i
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects high-confidence secret-looking strings in create and put before fetch', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-doc-secret',
      nonce: 'nonce-doc-secret',
    });
    const createFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const createAdapter = new CreativeDocumentCloudAdapter(
      createFetch as unknown as typeof fetch,
      '/documents'
    );

    await expectSecretValueRejected(() =>
      createAdapter.create({
        title: 'Safe Board',
        snapshot: {
          elements: [
            {
              id: 'element-1',
              type: 'text',
              text:
                'The draft accidentally includes sk-test-1234567890abcdefghijklmnopqrstuvwxyz.',
            },
          ],
        },
      })
    );
    expect(createFetch).not.toHaveBeenCalled();

    const putFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    const putAdapter = new CreativeDocumentCloudAdapter(
      putFetch as unknown as typeof fetch,
      '/documents'
    );

    await expectSecretValueRejected(() =>
      putAdapter.put(
        'doc-1',
        {
          title: 'Safe Board',
          snapshot: {
            note:
              'This note includes Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdef1234567890.signature',
          },
        },
        7
      )
    );
    expect(putFetch).not.toHaveBeenCalled();
  });

  it('allows normal public text mentioning Authorization header while stripping structured secrets', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-doc-public',
      nonce: 'nonce-doc-public',
    });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            document: {
              id: 'doc-1',
              snapshot: { elements: [] },
              revision: 1,
            },
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;
    const adapter = new CreativeDocumentCloudAdapter(fetcher, '/documents');

    await adapter.create({
      id: 'doc-1',
      snapshot: {
        text: 'Document how the public Authorization header works for users.',
        apiKey: 'leak',
        Authorization: 'Bearer leak',
        token: 'leak',
        providerSettings: { apiKey: 'leak' },
        providerProfiles: [{ apiKey: 'leak' }],
        baseUrl: 'https://leak.example',
      } as any,
    });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.snapshot).toEqual({
      text: 'Document how the public Authorization header works for users.',
    });
    expect(JSON.stringify(body)).not.toMatch(
      /apiKey|Bearer leak|token|providerSettings|providerProfiles|baseUrl|leak/i
    );
  });
});

describe('creative workspace document cloud sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMemoryStorage(initial: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(initial));
    return {
      get length() {
        return data.size;
      },
      clear: vi.fn(() => data.clear()),
      getItem: vi.fn((key: string) => data.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(data.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        data.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        data.set(key, value);
      }),
    };
  }

  function createBoard(overrides: Record<string, unknown> = {}): Board {
    return {
      id: 'board-1',
      name: 'Campaign Board',
      folderId: 'folder-1',
      order: 7,
      elements: [
        {
          id: 'element-1',
          type: 'text',
          apiKey: 'leak',
          Authorization: 'Bearer leak',
          children: [{ text: 'hello', token: 'leak' }],
        },
      ],
      viewport: { x: 1, y: 2, zoom: 0.5, baseUrl: 'https://leak.example' },
      theme: { colorMode: 'dark', providerSettings: { apiKey: 'leak' } },
      createdAt: 100,
      updatedAt: 200,
      providerProfiles: [{ apiKey: 'leak' }],
      ...overrides,
    } as unknown as Board;
  }

  function createAdapter(): CreativeDocumentCloudAdapterLike & {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  } {
    return {
      create: vi.fn(
        async <TSnapshot = unknown>(
          snapshot: CreativeDocumentSnapshot<TSnapshot>
        ): Promise<CreativeDocumentSnapshot<TSnapshot>> => ({
          ...snapshot,
          revision: 1,
        })
      ),
      get: vi.fn(
        async <TSnapshot = unknown>(
          documentId: string
        ): Promise<CreativeDocumentSnapshot<TSnapshot>> => ({
          id: documentId,
          title: 'Remote Board',
          snapshot: ({ elements: [] } as unknown) as TSnapshot,
          revision: 5,
        })
      ),
      put: vi.fn(
        async <TSnapshot = unknown>(
          _documentId: string,
          snapshot: CreativeDocumentSnapshot<TSnapshot>
        ): Promise<CreativeDocumentSnapshot<TSnapshot>> => ({
          ...snapshot,
          revision: 2,
        })
      ),
      delete: vi.fn(async () => undefined),
    } as unknown as CreativeDocumentCloudAdapterLike & {
      create: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  }

  it('maps a board to the minimal safe cloud document payload', () => {
    const payload = buildCreativeWorkspaceDocumentSnapshot(createBoard());

    expect(payload).toEqual({
      id: 'board-1',
      title: 'Campaign Board',
      name: 'Campaign Board',
      snapshot: {
        elements: [
          {
            id: 'element-1',
            type: 'text',
            children: [{ text: 'hello' }],
          },
        ],
        viewport: { x: 1, y: 2, zoom: 0.5 },
        theme: { colorMode: 'dark' },
      },
      metadata: {
        folderId: 'folder-1',
        order: 7,
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /apiKey|Authorization|token|baseUrl|providerSettings|providerProfiles|leak/i
    );
  });

  it('creates unknown boards and stores the returned cloud revision', async () => {
    const adapter = createAdapter();
    const storage = createMemoryStorage();
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage,
      debounceMs: 0,
    });

    service.handleWorkspaceEvent({
      type: 'boardCreated',
      payload: createBoard(),
      timestamp: 1,
    });
    await service.flushPending();

    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'board-1',
        title: 'Campaign Board',
        snapshot: expect.objectContaining({ elements: expect.any(Array) }),
      })
    );
    expect(adapter.put).not.toHaveBeenCalled();
    expect(service.getRevision('board-1')).toBe(1);
    expect(JSON.stringify(storage.getItem('creative-document-cloud-revisions:v1'))).toContain(
      'board-1'
    );
  });

  it('puts known boards with the stored base revision', async () => {
    const adapter = createAdapter();
    const storage = createMemoryStorage({
      'creative-document-cloud-revisions:v1': JSON.stringify({ 'board-1': 8 }),
    });
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage,
      debounceMs: 0,
    });

    service.handleWorkspaceEvent({
      type: 'boardUpdated',
      payload: createBoard(),
      timestamp: 1,
    });
    await service.flushPending();

    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.put).toHaveBeenCalledWith(
      'board-1',
      expect.objectContaining({ id: 'board-1', title: 'Campaign Board' }),
      8
    );
    expect(service.getRevision('board-1')).toBe(2);
  });

  it('freezes duplicate creates with a safe conflict summary instead of overwriting unknown remote state', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = createAdapter();
    adapter.create.mockRejectedValueOnce(
      new CreativeDocumentConflictError({ message: 'duplicate document' })
    );
    adapter.get.mockResolvedValueOnce({
      id: 'board-1',
      title: 'Remote Secret Title',
      snapshot: {
        elements: [
          {
            id: 'remote-1',
            text: 'server-private-content',
            apiKey: 'remote-secret',
          },
        ],
      },
      revision: 5,
    });
    const storage = createMemoryStorage();
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage,
      debounceMs: 0,
    });

    service.handleWorkspaceEvent({
      type: 'boardCreated',
      payload: createBoard(),
      timestamp: 1,
    });
    await service.flushPending();
    await service.flushPending();

    expect(adapter.get).toHaveBeenCalledWith('board-1');
    expect(adapter.put).not.toHaveBeenCalled();
    expect(service.getRevision('board-1')).toBe(5);
    expect(service.isFrozen('board-1')).toBe(true);
    expect(service.getPendingMutationCount('board-1')).toBe(1);
    expect(service.getConflict('board-1')).toMatchObject({
      boardId: 'board-1',
      revision: 5,
      message: 'duplicate document',
      hasRemoteSnapshot: true,
    });
    expect(service.getConflictStatus('board-1')).toMatchObject({
      boardId: 'board-1',
      revision: 5,
      hasRemoteSnapshot: true,
    });
    expect(JSON.stringify(service.getStatus())).not.toMatch(
      /Remote Secret Title|server-private-content|remote-secret|apiKey/i
    );
    expect(storage.getItem(CREATIVE_DOCUMENT_CONFLICT_STORAGE_KEY) || '').not.toMatch(
      /Remote Secret Title|server-private-content|remote-secret|apiKey/i
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toMatch(
      /Remote Secret Title|server-private-content|remote-secret|apiKey/i
    );
  });

  it('freezes a conflicted board queue without silently overwriting remote state', async () => {
    const adapter = createAdapter();
    adapter.put.mockRejectedValue(
      new CreativeDocumentConflictError({
        revision: 9,
        message: 'remote changed',
        snapshot: {
          id: 'board-1',
          snapshot: { elements: ['remote'] },
          revision: 9,
        },
      })
    );
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage: createMemoryStorage({
        'creative-document-cloud-revisions:v1': JSON.stringify({ 'board-1': 8 }),
      }),
      debounceMs: 0,
    });

    service.handleWorkspaceEvent({
      type: 'boardUpdated',
      payload: createBoard(),
      timestamp: 1,
    });
    await service.flushPending();
    await service.flushPending();

    expect(adapter.put).toHaveBeenCalledTimes(1);
    expect(service.isFrozen('board-1')).toBe(true);
    expect(service.getPendingMutationCount('board-1')).toBe(1);
    expect(service.getConflict('board-1')).toMatchObject({
      boardId: 'board-1',
      revision: 9,
      message: 'remote changed',
    });
  });

  it('restores persisted conflicts with only valid normalized revisions', () => {
    const adapter = createAdapter();
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage: createMemoryStorage({
        'creative-document-cloud-conflicts:v1': JSON.stringify({
          'board-1': {
            revision: '10',
            message: 'remote changed',
            recordedAt: 123,
          },
          'board-2': {
            revision: { nested: true },
            message: 'invalid revision',
            recordedAt: 456,
          },
        }),
      }),
      debounceMs: 0,
    });

    expect(service.isFrozen('board-1')).toBe(true);
    expect(service.getConflict('board-1')).toMatchObject({
      boardId: 'board-1',
      revision: 10,
      message: 'remote changed',
      recordedAt: 123,
    });
    expect(service.isFrozen('board-2')).toBe(true);
    expect(service.getConflict('board-2')).toEqual({
      boardId: 'board-2',
      message: 'invalid revision',
      recordedAt: 456,
    });
  });

  it('deletes remote documents and clears local revision/conflict state', async () => {
    const adapter = createAdapter();
    const storage = createMemoryStorage({
      'creative-document-cloud-revisions:v1': JSON.stringify({ 'board-1': 8 }),
    });
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage,
      debounceMs: 0,
    });

    service.handleWorkspaceEvent({
      type: 'boardDeleted',
      payload: createBoard(),
      timestamp: 1,
    });
    await service.flushPending();

    expect(adapter.delete).toHaveBeenCalledWith('board-1');
    expect(service.getRevision('board-1')).toBeUndefined();
    expect(service.getPendingMutationCount('board-1')).toBe(0);
  });

  it('exposes an initial idle sync status with no pending work or conflicts', () => {
    const service = new CreativeDocumentCloudSyncService({
      adapter: createAdapter(),
      storage: createMemoryStorage(),
      debounceMs: 1000,
    });

    expect(service.getStatus()).toMatchObject({
      syncState: 'idle',
      saveState: 'idle',
      pendingMutationCount: 0,
      pendingSnapshotCount: 0,
      pendingDeleteCount: 0,
      syncing: false,
      flushing: false,
      conflictCount: 0,
      frozenBoardCount: 0,
      conflictedBoardIds: [],
      frozenBoardIds: [],
      conflictsByBoardId: {},
      revisionsByBoardId: {},
    });
  });

  it('marks queued boards as locally saved pending work before flushing', () => {
    const service = new CreativeDocumentCloudSyncService({
      adapter: createAdapter(),
      storage: createMemoryStorage(),
      debounceMs: 1000,
    });

    service.handleWorkspaceEvent({
      type: 'boardUpdated',
      payload: createBoard(),
      timestamp: 1,
    });

    expect(service.getStatus()).toMatchObject({
      syncState: 'pending',
      saveState: 'local-saved',
      pendingMutationCount: 1,
      pendingSnapshotCount: 1,
      pendingDeleteCount: 0,
      syncing: false,
      flushing: false,
      conflictCount: 0,
      frozenBoardCount: 0,
    });
    expect(JSON.stringify(service.getStatus())).not.toMatch(
      /Campaign Board|hello|apiKey|Authorization|token|baseUrl|providerSettings|providerProfiles|leak/i
    );

    service.stop();
  });

  it('returns to cloud-saved idle status after a successful flush and exposes revisions', async () => {
    const service = new CreativeDocumentCloudSyncService({
      adapter: createAdapter(),
      storage: createMemoryStorage(),
      debounceMs: 1000,
    });

    service.handleWorkspaceEvent({
      type: 'boardCreated',
      payload: createBoard(),
      timestamp: 1,
    });
    await service.flushPending();

    expect(service.getStatus()).toMatchObject({
      syncState: 'idle',
      saveState: 'cloud-saved',
      pendingMutationCount: 0,
      pendingSnapshotCount: 0,
      pendingDeleteCount: 0,
      syncing: false,
      flushing: false,
      conflictCount: 0,
      frozenBoardCount: 0,
      revisionsByBoardId: { 'board-1': 1 },
    });
  });

  it('exposes conflict and frozen status while keeping the queued board frozen until delete', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = createAdapter();
    adapter.put.mockRejectedValue(
      new CreativeDocumentConflictError({
        revision: 9,
        message: 'remote changed',
        snapshot: {
          id: 'board-1',
          title: 'Remote Secret Title',
          snapshot: {
            elements: [{ id: 'remote-1', text: 'server-private-content' }],
          },
          revision: 9,
        },
      })
    );
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage: createMemoryStorage({
        'creative-document-cloud-revisions:v1': JSON.stringify({ 'board-1': 8 }),
      }),
      debounceMs: 1000,
    });

    service.handleWorkspaceEvent({
      type: 'boardUpdated',
      payload: createBoard(),
      timestamp: 1,
    });
    await service.flushPending();
    await service.flushPending();

    expect(adapter.put).toHaveBeenCalledTimes(1);
    expect(service.getStatus()).toMatchObject({
      syncState: 'conflict',
      saveState: 'conflict',
      pendingMutationCount: 1,
      pendingSnapshotCount: 1,
      pendingDeleteCount: 0,
      conflictCount: 1,
      frozenBoardCount: 1,
      conflictedBoardIds: ['board-1'],
      frozenBoardIds: ['board-1'],
      conflictsByBoardId: {
        'board-1': {
          boardId: 'board-1',
          revision: 9,
          hasRemoteSnapshot: true,
        },
      },
    });
    expect(service.getConflictStatus('board-1')).toMatchObject({
      boardId: 'board-1',
      revision: 9,
      hasRemoteSnapshot: true,
    });
    expect(JSON.stringify(service.getStatus())).not.toMatch(
      /Remote Secret Title|server-private-content|apiKey|leak/i
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toMatch(
      /Remote Secret Title|server-private-content|apiKey|leak/i
    );

    service.queueDelete('board-1');
    await service.flushPending();

    expect(service.getStatus()).toMatchObject({
      syncState: 'idle',
      saveState: 'cloud-saved',
      pendingMutationCount: 0,
      conflictCount: 0,
      frozenBoardCount: 0,
      conflictsByBoardId: {},
    });
  });

  it('notifies status subscribers without exposing document content or secrets', async () => {
    const service = new CreativeDocumentCloudSyncService({
      adapter: createAdapter(),
      storage: createMemoryStorage(),
      debounceMs: 1000,
    });
    const statuses: unknown[] = [];
    const subscription = service.subscribeStatus((status) => {
      statuses.push(status);
    });

    service.handleWorkspaceEvent({
      type: 'boardUpdated',
      payload: createBoard(),
      timestamp: 1,
    });
    await service.flushPending();

    expect(statuses.length).toBeGreaterThanOrEqual(4);
    expect(statuses[0]).toMatchObject({
      syncState: 'idle',
      saveState: 'idle',
      pendingMutationCount: 0,
    });
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          syncState: 'pending',
          saveState: 'local-saved',
          pendingMutationCount: 1,
        }),
        expect.objectContaining({
          syncState: 'syncing',
          syncing: true,
          flushing: true,
        }),
        expect.objectContaining({
          syncState: 'idle',
          saveState: 'cloud-saved',
          pendingMutationCount: 0,
        }),
      ])
    );
    expect(JSON.stringify(statuses)).not.toMatch(
      /Campaign Board|hello|apiKey|Authorization|token|baseUrl|providerSettings|providerProfiles|leak/i
    );

    subscription.unsubscribe();
    const countAfterUnsubscribe = statuses.length;
    service.handleWorkspaceEvent({
      type: 'boardUpdated',
      payload: createBoard({ id: 'board-2' }),
      timestamp: 2,
    });
    expect(statuses).toHaveLength(countAfterUnsubscribe);

    service.stop();
  });

  it('uploads local media into only the outbound snapshot copy before a 409 freeze', async () => {
    const localImageUrl = '/__aitu_cache__/image/local-only.png';
    const board = createBoard({
      elements: [
        {
          id: 'image-1',
          imageUrl: localImageUrl,
        },
      ],
    });
    const adapter = createAdapter();
    adapter.put.mockRejectedValue(
      new CreativeDocumentConflictError({
        revision: 9,
        message: 'remote changed',
      })
    );
    const upload = vi.fn(async () => '/creative/api/assets/asset_image/content');
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage: createMemoryStorage({
        'creative-document-cloud-revisions:v1': JSON.stringify({ 'board-1': 8 }),
      }),
      debounceMs: 0,
      assetSyncEnabled: true,
      assetAdapter: { upload },
      assetCache: {
        getCachedBlob: vi.fn(
          async () => new Blob(['local-image'], { type: 'image/png' })
        ),
        cacheLocalMediaByContent: vi.fn(),
      },
    });

    service.handleWorkspaceEvent({
      type: 'boardUpdated',
      payload: board,
      timestamp: 1,
    });
    await service.flushPending();
    await service.flushPending();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(adapter.put).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(adapter.put.mock.calls[0][1])).toContain(
      '/creative/api/assets/asset_image/content'
    );
    expect(JSON.stringify(adapter.put.mock.calls[0][1])).not.toContain(
      localImageUrl
    );
    expect(JSON.stringify(board)).toContain(localImageUrl);
    expect(service.isFrozen('board-1')).toBe(true);
    expect(service.getPendingMutationCount('board-1')).toBe(1);
  });

  it('keeps local-only media pending when asset sync is disabled and does not call document mutation', async () => {
    const localImageUrl = '/__aitu_cache__/image/disabled.png';
    const adapter = createAdapter();
    const upload = vi.fn();
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage: createMemoryStorage(),
      debounceMs: 0,
      assetSyncEnabled: false,
      assetAdapter: { upload },
      assetCache: {
        getCachedBlob: vi.fn(),
        cacheLocalMediaByContent: vi.fn(),
      },
    });

    service.handleWorkspaceEvent({
      type: 'boardCreated',
      payload: createBoard({
        elements: [{ id: 'image-1', imageUrl: localImageUrl }],
      }),
      timestamp: 1,
    });
    await service.flushPending();

    expect(upload).not.toHaveBeenCalled();
    expect(adapter.create).not.toHaveBeenCalled();
    expect(service.getPendingMutationCount('board-1')).toBe(1);
    expect(service.getStatus().lastAssetSyncError).toMatchObject({
      code: 'creative_asset_sync_disabled',
    });
    expect(JSON.stringify(service.getStatus())).not.toContain(localImageUrl);
  });

  it('hydrates missing remote documents before cold-start workspace import', async () => {
    const cloudImageUrl = '/creative/api/assets/asset_remote/content';
    const adapter = {
      ...createAdapter(),
      list: vi.fn(async () => [
        {
          id: 'remote-board',
          title: 'Remote Board',
          revision: 3,
        },
      ]),
      get: vi.fn(async () => ({
        id: 'remote-board',
        title: 'Remote Board',
        snapshot: {
          elements: [{ id: 'image-1', imageUrl: cloudImageUrl }],
        },
        metadata: {
          folderId: null,
          order: 0,
        },
        revision: 3,
        createdAt: 1710000000,
        updatedAt: 1710000001,
      })),
    } as CreativeDocumentCloudAdapterLike & {
      list: () => Promise<Array<{ id: string; title?: string; revision: number }>>;
    };
    const upsertBoardFromCloud = vi.fn();
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage: createMemoryStorage(),
      debounceMs: 0,
      assetSyncEnabled: true,
      assetAdapter: {
        download: vi.fn(
          async () => new Blob(['remote-image'], { type: 'image/png' })
        ),
      },
      assetCache: {
        getCachedBlob: vi.fn(),
        cacheLocalMediaByContent: vi.fn(async () => ({
          url: '/__aitu_cache__/image/content-remote.png',
          contentHash: 'content-remote',
          reused: false,
        })),
      },
      workspaceRepository: {
        hasBoard: vi.fn(async () => false),
        getStoredRevision: vi.fn(async () => null),
        upsertBoardFromCloud,
      },
    });

    await service.syncRemoteDocumentsForColdStart();

    expect(adapter.get).toHaveBeenCalledWith('remote-board');
    expect(upsertBoardFromCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'remote-board',
        name: 'Remote Board',
        elements: [
          {
            id: 'image-1',
            imageUrl: '/__aitu_cache__/image/content-remote.png',
          },
        ],
        createdAt: 1710000000000,
        updatedAt: 1710000001000,
      }),
      3,
      { suppressOutboundSync: true }
    );
    expect(service.getRevision('remote-board')).toBe(3);
  });

  it('rejects unsafe missing remote documents before cold-start workspace import even without cloud refs', async () => {
    const signedUrl =
      'https://private-bucket.s3.amazonaws.com/path/image.png?X-Amz-Credential=AKIA_TEST&X-Amz-Signature=super-secret';
    const adapter = {
      ...createAdapter(),
      list: vi.fn(async () => [
        {
          id: 'remote-board-unsafe',
          title: 'Remote Unsafe Board',
          revision: 4,
        },
      ]),
      get: vi.fn(async () => ({
        id: 'remote-board-unsafe',
        title: 'Remote Unsafe Board',
        snapshot: {
          elements: [{ id: 'image-unsafe', imageUrl: signedUrl }],
        },
        metadata: {
          folderId: null,
          order: 0,
        },
        revision: 4,
        createdAt: 1710000000,
        updatedAt: 1710000001,
      })),
    } as CreativeDocumentCloudAdapterLike & {
      list: () => Promise<Array<{ id: string; title?: string; revision: number }>>;
    };
    const upsertBoardFromCloud = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new CreativeDocumentCloudSyncService({
      adapter,
      storage: createMemoryStorage(),
      debounceMs: 0,
      assetSyncEnabled: true,
      assetAdapter: {
        download: vi.fn(),
      },
      assetCache: {
        getCachedBlob: vi.fn(),
        cacheLocalMediaByContent: vi.fn(),
      },
      workspaceRepository: {
        hasBoard: vi.fn(async () => false),
        getStoredRevision: vi.fn(async () => null),
        upsertBoardFromCloud,
      },
    });

    await service.syncRemoteDocumentsForColdStart();

    expect(upsertBoardFromCloud).not.toHaveBeenCalled();
    expect(service.getStatus().lastAssetSyncError).toMatchObject({
      code: 'creative_asset_unsafe_url',
    });
    expect(JSON.stringify(service.getStatus())).not.toMatch(
      /AKIA_TEST|super-secret|s3\.amazonaws/i
    );
    warnSpy.mockRestore();
  });
});
