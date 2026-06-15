import React, { useEffect } from 'react';
import fs from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CreativeDocumentCloudSyncBadge,
  getCreativeDocumentCloudSyncStatusLabel,
} from '../components/creative-document-sync-status/CreativeDocumentCloudSyncBadge';
import { useCreativeDocumentCloudSyncStatus } from './use-creative-document-sync-status';
import {
  CreativeDocumentCloudSyncService,
  getCreativeDocumentCloudSyncStatusSnapshot,
  initializeCreativeDocumentCloudSync,
  type CreativeDocumentCloudAdapterLike,
  type CreativeDocumentCloudSyncStatus,
  type CreativeDocumentSnapshot,
} from '../services/creative-document-sync';
import { isCreativeEmbeddedMode } from '../services/creative-mode';
import type { Board } from '../types/workspace.types';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
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
    order: 1,
    elements: [
      {
        id: 'element-1',
        type: 'text',
        apiKey: 'leak',
        Authorization: 'Bearer leak',
        children: [{ text: 'private canvas text', token: 'leak' }],
      },
    ],
    viewport: { x: 1, y: 2, zoom: 1, baseUrl: 'https://leak.example' },
    theme: { colorMode: 'dark', providerOverride: 'leak' },
    ...overrides,
  } as unknown as Board;
}

function createAdapter(): CreativeDocumentCloudAdapterLike {
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
        snapshot: ({ elements: [] } as unknown) as TSnapshot,
        revision: 1,
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
  } as unknown as CreativeDocumentCloudAdapterLike;
}

function createService(): CreativeDocumentCloudSyncService {
  return new CreativeDocumentCloudSyncService({
    adapter: createAdapter(),
    storage: createMemoryStorage(),
    debounceMs: 1000,
  });
}

function StatusProbe({
  service,
  onStatus,
}: {
  service: CreativeDocumentCloudSyncService;
  onStatus: (status: CreativeDocumentCloudSyncStatus) => void;
}) {
  const status = useCreativeDocumentCloudSyncStatus({ service });

  useEffect(() => {
    onStatus(status);
  }, [onStatus, status]);

  return <pre data-testid="sync-status">{JSON.stringify(status)}</pre>;
}

describe('useCreativeDocumentCloudSyncStatus', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('subscribes to safe cloud-sync status snapshots and unsubscribes on unmount', async () => {
    const service = createService();
    const statuses: CreativeDocumentCloudSyncStatus[] = [];

    const { unmount } = render(
      <StatusProbe service={service} onStatus={(status) => statuses.push(status)} />
    );

    expect(screen.getByTestId('sync-status').textContent).toContain(
      '"saveState":"idle"'
    );

    act(() => {
      service.queueSnapshot(createBoard());
    });

    expect(screen.getByTestId('sync-status').textContent).toContain(
      '"saveState":"local-saved"'
    );

    await act(async () => {
      await service.flushPending();
    });

    expect(screen.getByTestId('sync-status').textContent).toContain(
      '"saveState":"cloud-saved"'
    );
    expect(JSON.stringify(statuses)).not.toMatch(
      /Campaign Board|private canvas text|apiKey|Authorization|token|baseUrl|providerOverride|leak/i
    );

    const countAfterUpdates = statuses.length;
    unmount();

    act(() => {
      service.queueSnapshot(createBoard({ id: 'board-2' }));
    });

    expect(statuses).toHaveLength(countAfterUpdates);
    service.stop();
  });
});

describe('CreativeDocumentCloudSyncBadge', () => {
  it('exports embedded helpers and renders nothing outside /creative', () => {
    window.history.pushState({}, '', '/');
    const service = createService();
    const indexSource = fs.readFileSync('src/index.ts', 'utf8');

    render(
      <CreativeDocumentCloudSyncBadge
        service={service}
        locationLike={window.location}
      />
    );

    expect(screen.queryByTestId('creative-document-sync-status')).toBeNull();
    expect(isCreativeEmbeddedMode(window.location)).toBe(false);
    expect(initializeCreativeDocumentCloudSync({ locationLike: window.location })).toBeNull();
    expect(getCreativeDocumentCloudSyncStatusSnapshot(null)).toMatchObject({
      syncState: 'idle',
      saveState: 'idle',
      pendingMutationCount: 0,
    });
    expect(indexSource).toContain("export * from './services/creative-mode'");
    expect(indexSource).toContain(
      "export * from './services/creative-document-sync'"
    );
    expect(indexSource).toContain(
      "export * from './hooks/use-creative-document-sync-status'"
    );
    expect(indexSource).toContain(
      "export * from './components/creative-document-sync-status/CreativeDocumentCloudSyncBadge'"
    );

    act(() => {
      service.queueSnapshot(createBoard());
    });
    expect(document.body.textContent).not.toMatch(
      /Campaign Board|private canvas text|apiKey|Authorization|token|baseUrl|providerOverride|leak/i
    );
    service.stop();
  });

  it('renders a fresh-browser-verifiable embedded status badge without document content', () => {
    window.history.pushState({}, '', '/creative');
    const service = createService();

    render(<CreativeDocumentCloudSyncBadge service={service} />);

    expect(screen.getByTestId('creative-document-sync-status').textContent).toContain(
      '云同步就绪'
    );

    act(() => {
      service.queueSnapshot(createBoard());
    });

    const badge = screen.getByTestId('creative-document-sync-status');
    expect(badge.textContent).toContain('已保存到此浏览器');
    expect(badge.textContent).not.toMatch(
      /Campaign Board|private canvas text|leak/i
    );
    service.stop();
  });

  it('explains pending browser-only saves when cloud asset sync is disabled', () => {
    const status: CreativeDocumentCloudSyncStatus = {
      ...getCreativeDocumentCloudSyncStatusSnapshot(null),
      saveState: 'local-saved',
      syncState: 'pending',
      pendingMutationCount: 1,
      pendingSnapshotCount: 1,
      assetSyncEnabled: false,
    };

    expect(getCreativeDocumentCloudSyncStatusLabel(status)).toBe(
      '云同步不可用 · 已保存到此浏览器'
    );
  });
});
