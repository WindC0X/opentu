import {
  assertNoHighConfidenceCreativeCloudSecretValues,
  removeSensitiveCloudFields,
} from './creative-cloud-sanitizer';
import {
  CREATIVE_DOCUMENTS_ENDPOINT,
  getCreativeAssetSyncConfig,
  isCreativeEmbeddedMode,
  requireCreativeSessionAuthHeaders,
} from './creative-mode';
import {
  creativeAssetCloudAdapter,
  assertNoUnsafeCreativeAssetPersistenceRefs,
  getSafeCreativeAssetSyncErrorMessage,
  hydrateCreativeDocumentAssets,
  prepareCreativeDocumentAssetsForSync,
  toCreativeAssetSyncErrorStatus,
  type CreativeAssetCacheLike,
  type CreativeAssetCloudAdapterLike,
  type CreativeAssetSyncErrorStatus,
} from './creative-document-assets';
import { workspaceService } from './workspace-service';
import { workspaceStorageService } from './workspace-storage-service';
import type { Board, WorkspaceEvent } from '../types/workspace.types';

export interface CreativeDocumentSummary {
  id: string;
  title?: string;
  revision: string | number;
  createdAt?: string | number;
  updatedAt?: string | number;
}

export interface CreativeDocumentSnapshot<TSnapshot = unknown> {
  id?: string;
  title?: string;
  name?: string;
  snapshot: TSnapshot;
  revision?: string | number | null;
  createdAt?: string | number;
  updatedAt?: string | number;
  metadata?: Record<string, unknown>;
}

export interface CreativeDocumentMutation<TSnapshot = unknown> {
  documentId: string;
  snapshot: CreativeDocumentSnapshot<TSnapshot>;
  baseRevision?: string | number | null;
}

export interface CreativeWorkspaceBoardSnapshot {
  elements: Board['elements'];
  viewport?: Board['viewport'];
  theme?: Board['theme'];
}

export interface CreativeDocumentSyncConflict<TSnapshot = unknown> {
  boardId: string;
  revision?: string | number | null;
  snapshot?: CreativeDocumentSnapshot<TSnapshot>;
  hasRemoteSnapshot?: boolean;
  message?: string;
  recordedAt: number;
}

export type CreativeDocumentCloudSyncState =
  | 'idle'
  | 'pending'
  | 'syncing'
  | 'conflict';

export type CreativeDocumentCloudSaveState =
  | 'idle'
  | 'local-saved'
  | 'cloud-saved'
  | 'conflict';

export interface CreativeDocumentSyncConflictStatus {
  boardId: string;
  revision?: string | number | null;
  recordedAt: number;
  hasRemoteSnapshot: boolean;
}

export interface CreativeDocumentCloudSyncStatus {
  syncState: CreativeDocumentCloudSyncState;
  saveState: CreativeDocumentCloudSaveState;
  pendingMutationCount: number;
  pendingSnapshotCount: number;
  pendingDeleteCount: number;
  syncing: boolean;
  flushing: boolean;
  conflictCount: number;
  frozenBoardCount: number;
  conflictedBoardIds: string[];
  frozenBoardIds: string[];
  conflictsByBoardId: Record<string, CreativeDocumentSyncConflictStatus>;
  revisionsByBoardId: Record<string, string | number>;
  assetSyncEnabled: boolean;
  lastAssetSyncError?: CreativeAssetSyncErrorStatus;
}

export type CreativeDocumentCloudSyncStatusListener = (
  status: CreativeDocumentCloudSyncStatus
) => void;

export function createIdleCreativeDocumentCloudSyncStatus(): CreativeDocumentCloudSyncStatus {
  return {
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
    assetSyncEnabled: getCreativeAssetSyncConfig().assetSyncEnabled,
  };
}

export interface CreativeDocumentCloudAdapterLike {
  list?(): Promise<CreativeDocumentSummary[]>;
  create<TSnapshot = unknown>(
    snapshot: CreativeDocumentSnapshot<TSnapshot>
  ): Promise<CreativeDocumentSnapshot<TSnapshot>>;
  get<TSnapshot = unknown>(
    documentId: string
  ): Promise<CreativeDocumentSnapshot<TSnapshot>>;
  put<TSnapshot = unknown>(
    documentId: string,
    snapshot: CreativeDocumentSnapshot<TSnapshot>,
    baseRevision?: string | number | null
  ): Promise<CreativeDocumentSnapshot<TSnapshot>>;
  delete(documentId: string): Promise<void>;
}

interface WorkspaceEventSubscription {
  unsubscribe(): void;
}

export interface CreativeWorkspaceEventSource {
  observeEvents(): {
    subscribe(next: (event: WorkspaceEvent) => void): WorkspaceEventSubscription;
  };
}

export interface CreativeWorkspaceCloudRepository {
  hasBoard(boardId: string): Promise<boolean>;
  getStoredRevision(boardId: string): Promise<string | number | null>;
  upsertBoardFromCloud(
    board: Board,
    revision: string | number,
    options?: { suppressOutboundSync?: boolean }
  ): Promise<void>;
}

export interface CreativeDocumentCloudSyncServiceOptions {
  adapter?: CreativeDocumentCloudAdapterLike;
  assetAdapter?: CreativeAssetCloudAdapterLike;
  assetCache?: CreativeAssetCacheLike;
  assetSyncEnabled?: boolean;
  workspaceRepository?: CreativeWorkspaceCloudRepository;
  workspace?: CreativeWorkspaceEventSource;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  debounceMs?: number;
  enableColdStartSync?: boolean;
}

export interface CreativeDocumentCloudSyncInitializeOptions
  extends CreativeDocumentCloudSyncServiceOptions {
  locationLike?: Pick<Location, 'pathname'> | null;
}

export const CREATIVE_DOCUMENT_REVISION_STORAGE_KEY =
  'creative-document-cloud-revisions:v1';
export const CREATIVE_DOCUMENT_CONFLICT_STORAGE_KEY =
  'creative-document-cloud-conflicts:v1';
const DEFAULT_DOCUMENT_SYNC_DEBOUNCE_MS = 800;

export interface CreativeDocumentConflictBody<TSnapshot = unknown> {
  revision?: string | number | null;
  snapshot?: CreativeDocumentSnapshot<TSnapshot>;
  message?: string;
}

export class CreativeDocumentConflictError<TSnapshot = unknown> extends Error {
  readonly status = 409;

  constructor(readonly conflict: CreativeDocumentConflictBody<TSnapshot>) {
    super(conflict.message || 'Document revision conflict');
    this.name = 'CreativeDocumentConflictError';
  }
}

export function sanitizeCreativeDocumentPayload<T>(value: T): T {
  return removeSensitiveCloudFields(value);
}

function prepareOutboundCreativeDocumentPayload<T>(value: T): T {
  const sanitized = sanitizeCreativeDocumentPayload(value);
  assertNoUnsafeCreativeAssetPersistenceRefs(sanitized);
  assertNoHighConfidenceCreativeCloudSecretValues(
    sanitized,
    'outbound creative document payload'
  );
  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBaseRevision(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  return undefined;
}

function normalizeCloudRevision(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  return undefined;
}

class DefaultCreativeWorkspaceCloudRepository
  implements CreativeWorkspaceCloudRepository
{
  async hasBoard(boardId: string): Promise<boolean> {
    if (workspaceService.getBoard(boardId)) {
      return true;
    }
    return (await workspaceStorageService.loadBoard(boardId)) !== null;
  }

  async getStoredRevision(_boardId: string): Promise<string | number | null> {
    return null;
  }

  async upsertBoardFromCloud(
    board: Board,
    _revision: string | number,
    options: { suppressOutboundSync?: boolean } = {}
  ): Promise<void> {
    const serviceWithCloudImport = workspaceService as typeof workspaceService & {
      upsertBoardFromCloud?: (
        board: Board,
        options?: { suppressOutboundSync?: boolean }
      ) => Promise<void>;
    };
    if (typeof serviceWithCloudImport.upsertBoardFromCloud === 'function') {
      await serviceWithCloudImport.upsertBoardFromCloud(board, options);
      return;
    }
    await workspaceStorageService.saveBoard(board);
  }
}

function getDefaultStorage():
  | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readStorageRecord(
  storage: Pick<Storage, 'getItem'> | null,
  key: string
): Record<string, unknown> {
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorageRecord(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
  key: string,
  record: Record<string, unknown>
): void {
  if (!storage) {
    return;
  }
  try {
    const keys = Object.keys(record);
    if (keys.length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // Local-first sync must keep working in memory even when storage is full
    // or browser privacy settings block localStorage.
  }
}

function sortIds(ids: Iterable<string>): string[] {
  return Array.from(ids).sort((left, right) => left.localeCompare(right));
}

function isConflictError<TSnapshot = unknown>(
  error: unknown
): error is CreativeDocumentConflictError<TSnapshot> {
  return (
    error instanceof CreativeDocumentConflictError ||
    (isRecord(error) && error.status === 409)
  );
}

function isBoardLike(value: unknown): value is Board {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0;
}

function extractBoardId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === 'string' && value.id
    ? value.id
    : null;
}

function normalizeBoardName(board: Board): string {
  return typeof board.name === 'string' && board.name.trim()
    ? board.name.trim()
    : board.id;
}

function getDocumentRevision(
  document: CreativeDocumentSnapshot | null | undefined
): string | number | undefined {
  return normalizeCloudRevision(document?.revision);
}

function normalizeCloudTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return normalizeCloudTimestamp(parsed, fallback);
    }
  }
  return fallback;
}

function documentToBoard(
  document: CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>
): Board | null {
  if (!isCreativeWorkspaceDocumentSnapshot(document)) {
    return null;
  }
  const id =
    typeof document.id === 'string' && document.id.trim()
      ? document.id.trim()
      : null;
  if (!id) {
    return null;
  }
  const metadata = isRecord(document.metadata) ? document.metadata : {};
  const now = Date.now();
  const name =
    (typeof document.title === 'string' && document.title.trim()) ||
    (typeof document.name === 'string' && document.name.trim()) ||
    id;
  const folderId =
    typeof metadata.folderId === 'string' && metadata.folderId.trim()
      ? metadata.folderId
      : null;
  const order = typeof metadata.order === 'number' ? metadata.order : 0;
  return {
    id,
    name,
    folderId,
    order,
    elements: Array.isArray(document.snapshot.elements)
      ? document.snapshot.elements
      : [],
    ...(document.snapshot.viewport !== undefined
      ? { viewport: document.snapshot.viewport }
      : {}),
    ...(document.snapshot.theme !== undefined
      ? { theme: document.snapshot.theme }
      : {}),
    createdAt: normalizeCloudTimestamp(document.createdAt, now),
    updatedAt: normalizeCloudTimestamp(document.updatedAt, now),
  };
}

function isCreativeWorkspaceDocumentSnapshot(
  value: unknown
): value is CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot> {
  return (
    isRecord(value) &&
    isRecord(value.snapshot) &&
    Array.isArray(value.snapshot.elements)
  );
}

function conflictFromError<TSnapshot = unknown>(
  boardId: string,
  error: CreativeDocumentConflictError<TSnapshot>
): CreativeDocumentSyncConflict<TSnapshot> {
  const safeConflict = sanitizeCreativeDocumentPayload(error.conflict || {});
  const revision = normalizeBaseRevision(safeConflict.revision);
  return {
    boardId,
    ...(revision !== undefined ? { revision } : {}),
    ...(safeConflict.snapshot !== undefined ? { hasRemoteSnapshot: true } : {}),
    ...(safeConflict.message ? { message: safeConflict.message } : {}),
    recordedAt: Date.now(),
  };
}

function summarizeConflict<TSnapshot = unknown>(
  conflict: CreativeDocumentSyncConflict<TSnapshot>
): CreativeDocumentSyncConflictStatus {
  return {
    boardId: conflict.boardId,
    ...(conflict.revision !== undefined ? { revision: conflict.revision } : {}),
    recordedAt: conflict.recordedAt,
    hasRemoteSnapshot:
      conflict.hasRemoteSnapshot === true || conflict.snapshot !== undefined,
  };
}

function mapBackendTimeFields<T extends Record<string, unknown>>(value: T): T {
  const { createdTime, updatedTime, ...rest } = value;
  const result: Record<string, unknown> = { ...rest };
  if (result.createdAt === undefined && createdTime !== undefined) {
    result.createdAt = createdTime;
  }
  if (result.updatedAt === undefined && updatedTime !== undefined) {
    result.updatedAt = updatedTime;
  }
  return result as T;
}

function normalizeDocumentSummary(
  value: unknown
): CreativeDocumentSummary | null {
  const stripped = sanitizeCreativeDocumentPayload(value);
  if (!isRecord(stripped)) {
    return null;
  }
  return mapBackendTimeFields(stripped) as unknown as CreativeDocumentSummary;
}

function normalizeDocumentSnapshot<TSnapshot = unknown>(
  value: unknown
): CreativeDocumentSnapshot<TSnapshot> {
  const stripped = sanitizeCreativeDocumentPayload(value);
  if (!isRecord(stripped)) {
    return { snapshot: stripped as TSnapshot };
  }
  return mapBackendTimeFields(
    stripped
  ) as unknown as CreativeDocumentSnapshot<TSnapshot>;
}

function unwrapResponseData(payload: unknown): unknown {
  return isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
}

function unwrapDocumentListPayload(payload: unknown): CreativeDocumentSummary[] {
  const data = unwrapResponseData(payload);
  const documents =
    isRecord(data) && Array.isArray(data.documents) ? data.documents : data;
  if (!Array.isArray(documents)) {
    return [];
  }
  return documents
    .map((item) => normalizeDocumentSummary(item))
    .filter(Boolean) as CreativeDocumentSummary[];
}

function unwrapDocumentPayload<TSnapshot = unknown>(
  payload: unknown
): CreativeDocumentSnapshot<TSnapshot> {
  const data = unwrapResponseData(payload);
  const document = isRecord(data) && 'document' in data ? data.document : data;
  return normalizeDocumentSnapshot<TSnapshot>(document);
}

function unwrapConflictPayload<TSnapshot = unknown>(
  payload: unknown
): CreativeDocumentConflictBody<TSnapshot> {
  const root = isRecord(payload) ? payload : {};
  const data = unwrapResponseData(payload);
  const dataRecord = isRecord(data) ? data : {};
  const document =
    'document' in dataRecord
      ? dataRecord.document
      : 'snapshot' in dataRecord
        ? dataRecord.snapshot
        : undefined;
  const snapshot =
    document !== undefined
      ? unwrapDocumentPayload<TSnapshot>({ data: { document } })
      : undefined;
  const revision = normalizeBaseRevision(
    dataRecord.revision ?? root.revision ?? snapshot?.revision
  );
  const message =
    typeof dataRecord.message === 'string'
      ? dataRecord.message
      : typeof root.message === 'string'
        ? root.message
        : undefined;

  return {
    ...(revision !== undefined ? { revision } : {}),
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(message ? { message } : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

export function buildCreativeWorkspaceDocumentSnapshot(
  board: Board
): CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot> {
  const name = normalizeBoardName(board);
  return sanitizeCreativeDocumentPayload({
    id: board.id,
    title: name,
    name,
    snapshot: {
      elements: Array.isArray(board.elements) ? board.elements : [],
      ...(board.viewport !== undefined ? { viewport: board.viewport } : {}),
      ...(board.theme !== undefined ? { theme: board.theme } : {}),
    },
    metadata: {
      folderId: board.folderId ?? null,
      order: typeof board.order === 'number' ? board.order : 0,
    },
  });
}

export class CreativeDocumentCloudAdapter {
  private readonly queue: Array<CreativeDocumentMutation> = [];

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = CREATIVE_DOCUMENTS_ENDPOINT
  ) {}

  async list(): Promise<CreativeDocumentSummary[]> {
    const response = await this.fetcher(this.endpoint, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`文档列表同步失败: HTTP ${response.status}`);
    }
    return unwrapDocumentListPayload(await readJson(response));
  }

  async create<TSnapshot = unknown>(
    snapshot: CreativeDocumentSnapshot<TSnapshot>
  ): Promise<CreativeDocumentSnapshot<TSnapshot>> {
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...requireCreativeSessionAuthHeaders(),
      },
      body: JSON.stringify(
        prepareOutboundCreativeDocumentPayload(snapshot)
      ),
    });
    if (response.status === 409) {
      throw new CreativeDocumentConflictError(
        unwrapConflictPayload<TSnapshot>(await readJson(response))
      );
    }
    if (!response.ok) {
      throw new Error(`文档创建同步失败: HTTP ${response.status}`);
    }
    return unwrapDocumentPayload<TSnapshot>(await readJson(response));
  }

  async get<TSnapshot = unknown>(
    documentId: string
  ): Promise<CreativeDocumentSnapshot<TSnapshot>> {
    const response = await this.fetcher(`${this.endpoint}/${encodeURIComponent(documentId)}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`文档读取同步失败: HTTP ${response.status}`);
    }
    return unwrapDocumentPayload<TSnapshot>(await readJson(response));
  }

  async put<TSnapshot = unknown>(
    documentId: string,
    snapshot: CreativeDocumentSnapshot<TSnapshot>,
    baseRevision?: string | number | null
  ): Promise<CreativeDocumentSnapshot<TSnapshot>> {
    const normalizedBaseRevision = normalizeBaseRevision(baseRevision);
    const body = prepareOutboundCreativeDocumentPayload({
      ...snapshot,
      ...(normalizedBaseRevision !== undefined
        ? { baseRevision: normalizedBaseRevision }
        : {}),
    });
    const response = await this.fetcher(`${this.endpoint}/${encodeURIComponent(documentId)}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...requireCreativeSessionAuthHeaders(),
      },
      body: JSON.stringify(body),
    });

    if (response.status === 409) {
      throw new CreativeDocumentConflictError(
        unwrapConflictPayload<TSnapshot>(await readJson(response))
      );
    }
    if (!response.ok) {
      throw new Error(`文档保存同步失败: HTTP ${response.status}`);
    }

    return unwrapDocumentPayload<TSnapshot>(await readJson(response));
  }

  async delete(documentId: string): Promise<void> {
    const response = await this.fetcher(`${this.endpoint}/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: requireCreativeSessionAuthHeaders(),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`文档删除同步失败: HTTP ${response.status}`);
    }
  }

  enqueuePut<TSnapshot = unknown>(
    documentId: string,
    snapshot: CreativeDocumentSnapshot<TSnapshot>,
    baseRevision?: string | number | null
  ): void {
    this.queue.push({ documentId, snapshot, baseRevision });
  }

  getQueuedMutationCount(): number {
    return this.queue.length;
  }

  async flushQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      try {
        await this.put(next.documentId, next.snapshot, next.baseRevision);
        this.queue.shift();
      } catch (error) {
        if (error instanceof CreativeDocumentConflictError) {
          throw error;
        }
        throw error;
      }
    }
  }
}

export class CreativeDocumentCloudSyncService {
  private readonly adapter: CreativeDocumentCloudAdapterLike;
  private readonly assetAdapter: CreativeAssetCloudAdapterLike;
  private readonly assetCache?: CreativeAssetCacheLike;
  private readonly assetSyncEnabled: boolean;
  private readonly workspaceRepository: CreativeWorkspaceCloudRepository;
  private readonly workspace: CreativeWorkspaceEventSource;
  private readonly storage: Pick<
    Storage,
    'getItem' | 'setItem' | 'removeItem'
  > | null;
  private readonly debounceMs: number;
  private readonly pendingSnapshots = new Map<
    string,
    CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>
  >();
  private readonly pendingDeletes = new Set<string>();
  private readonly revisions = new Map<string, string | number>();
  private readonly conflicts = new Map<
    string,
    CreativeDocumentSyncConflict<CreativeWorkspaceBoardSnapshot>
  >();
  private readonly frozenBoards = new Set<string>();
  private readonly statusListeners = new Set<CreativeDocumentCloudSyncStatusListener>();
  private subscription: WorkspaceEventSubscription | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private hasCloudSaved = false;
  private lastAssetSyncError: CreativeAssetSyncErrorStatus | undefined;
  private coldStartSynced = false;
  private readonly enableColdStartSync: boolean;

  constructor(options: CreativeDocumentCloudSyncServiceOptions = {}) {
    this.adapter = options.adapter || creativeDocumentCloudAdapter;
    this.assetAdapter = options.assetAdapter || creativeAssetCloudAdapter;
    this.assetCache = options.assetCache;
    this.assetSyncEnabled =
      options.assetSyncEnabled ?? getCreativeAssetSyncConfig().assetSyncEnabled;
    this.workspaceRepository =
      options.workspaceRepository || new DefaultCreativeWorkspaceCloudRepository();
    this.workspace = options.workspace || workspaceService;
    this.storage =
      options.storage === undefined ? getDefaultStorage() : options.storage;
    this.debounceMs =
      options.debounceMs ?? DEFAULT_DOCUMENT_SYNC_DEBOUNCE_MS;
    this.enableColdStartSync = options.enableColdStartSync !== false;
    this.loadPersistedState();
  }

  start(): void {
    if (this.subscription) {
      return;
    }
    this.subscription = this.workspace.observeEvents().subscribe((event) => {
      this.handleWorkspaceEvent(event);
    });
    if (this.enableColdStartSync && !this.coldStartSynced) {
      this.coldStartSynced = true;
      void this.syncRemoteDocumentsForColdStart().catch((error) => {
        this.recordAssetSyncError(error);
        console.warn(
          '[CreativeDocumentCloudSync] cold-start sync failed:',
          getSafeCreativeAssetSyncErrorMessage(error)
        );
      });
    }
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  handleWorkspaceEvent(event: WorkspaceEvent): void {
    if (
      event.type !== 'boardCreated' &&
      event.type !== 'boardUpdated' &&
      event.type !== 'boardDeleted'
    ) {
      return;
    }

    if (event.type === 'boardDeleted') {
      const boardId = extractBoardId(event.payload);
      if (!boardId) {
        return;
      }
      this.queueDelete(boardId);
      return;
    }

    if (!isBoardLike(event.payload)) {
      return;
    }
    this.queueSnapshot(event.payload);
  }

  queueSnapshot(board: Board): void {
    const document = buildCreativeWorkspaceDocumentSnapshot(board);
    this.pendingDeletes.delete(board.id);
    this.pendingSnapshots.set(board.id, document);
    this.notifyStatusListeners();
    if (!this.frozenBoards.has(board.id)) {
      this.scheduleFlush();
    }
  }

  queueDelete(boardId: string): void {
    this.pendingSnapshots.delete(boardId);
    this.pendingDeletes.add(boardId);
    this.frozenBoards.delete(boardId);
    this.conflicts.delete(boardId);
    this.persistConflicts();
    this.notifyStatusListeners();
    this.scheduleFlush();
  }

  async flushPending(): Promise<void> {
    if (this.flushing) {
      return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushing = true;
    this.notifyStatusListeners();
    try {
      for (const boardId of Array.from(this.pendingDeletes)) {
        await this.flushDelete(boardId);
      }

      for (const [boardId, document] of Array.from(
        this.pendingSnapshots.entries()
      )) {
        if (this.frozenBoards.has(boardId)) {
          continue;
        }
        await this.flushSnapshot(boardId, document);
      }
    } finally {
      this.flushing = false;
      this.notifyStatusListeners();
    }
  }

  getRevision(boardId: string): string | number | undefined {
    return this.revisions.get(boardId);
  }

  getConflict(
    boardId: string
  ): CreativeDocumentSyncConflict<CreativeWorkspaceBoardSnapshot> | undefined {
    return this.conflicts.get(boardId);
  }

  isFrozen(boardId: string): boolean {
    return this.frozenBoards.has(boardId);
  }

  getPendingMutationCount(boardId?: string): number {
    if (boardId) {
      return (
        (this.pendingSnapshots.has(boardId) ? 1 : 0) +
        (this.pendingDeletes.has(boardId) ? 1 : 0)
      );
    }
    return this.pendingSnapshots.size + this.pendingDeletes.size;
  }

  getStatus(): CreativeDocumentCloudSyncStatus {
    const pendingMutationCount = this.getPendingMutationCount();
    const conflictedBoardIds = Array.from(this.conflicts.keys()).sort();
    const frozenBoardIds = Array.from(this.frozenBoards.values()).sort();
    const conflictsByBoardId: Record<
      string,
      CreativeDocumentSyncConflictStatus
    > = {};
    conflictedBoardIds.forEach((boardId) => {
      const conflict = this.conflicts.get(boardId);
      if (conflict) {
        conflictsByBoardId[boardId] = summarizeConflict(conflict);
      }
    });

    const revisionsByBoardId: Record<string, string | number> = {};
    Array.from(this.revisions.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([boardId, revision]) => {
        revisionsByBoardId[boardId] = revision;
      });

    const syncState: CreativeDocumentCloudSyncState =
      conflictedBoardIds.length > 0
        ? 'conflict'
        : this.flushing
        ? 'syncing'
        : pendingMutationCount > 0
        ? 'pending'
        : 'idle';
    const saveState: CreativeDocumentCloudSaveState =
      conflictedBoardIds.length > 0
        ? 'conflict'
        : pendingMutationCount > 0
        ? 'local-saved'
        : this.hasCloudSaved
        ? 'cloud-saved'
        : 'idle';

    return {
      syncState,
      saveState,
      pendingMutationCount,
      pendingSnapshotCount: this.pendingSnapshots.size,
      pendingDeleteCount: this.pendingDeletes.size,
      syncing: this.flushing,
      flushing: this.flushing,
      conflictCount: this.conflicts.size,
      frozenBoardCount: this.frozenBoards.size,
      conflictedBoardIds,
      frozenBoardIds,
      conflictsByBoardId,
      revisionsByBoardId,
      assetSyncEnabled: this.assetSyncEnabled,
      ...(this.lastAssetSyncError
        ? { lastAssetSyncError: this.lastAssetSyncError }
        : {}),
    };
  }

  getConflictStatus(
    boardId: string
  ): CreativeDocumentSyncConflictStatus | undefined {
    const conflict = this.conflicts.get(boardId);
    return conflict ? summarizeConflict(conflict) : undefined;
  }

  subscribeStatus(
    listener: CreativeDocumentCloudSyncStatusListener
  ): WorkspaceEventSubscription {
    listener(this.getStatus());
    this.statusListeners.add(listener);
    return {
      unsubscribe: () => {
        this.statusListeners.delete(listener);
      },
    };
  }

  private notifyStatusListeners(): void {
    if (this.statusListeners.size === 0) {
      return;
    }
    const status = this.getStatus();
    this.statusListeners.forEach((listener) => {
      listener(status);
    });
  }

  private recordAssetSyncError(error: unknown): void {
    this.lastAssetSyncError = toCreativeAssetSyncErrorStatus(error);
    this.notifyStatusListeners();
  }

  private clearAssetSyncError(): void {
    if (!this.lastAssetSyncError) {
      return;
    }
    this.lastAssetSyncError = undefined;
    this.notifyStatusListeners();
  }

  private loadPersistedState(): void {
    const revisionRecord = readStorageRecord(
      this.storage,
      CREATIVE_DOCUMENT_REVISION_STORAGE_KEY
    );
    Object.entries(revisionRecord).forEach(([boardId, revision]) => {
      const normalized = normalizeCloudRevision(revision);
      if (normalized !== undefined) {
        this.revisions.set(boardId, normalized);
      }
    });

    const conflictRecord = readStorageRecord(
      this.storage,
      CREATIVE_DOCUMENT_CONFLICT_STORAGE_KEY
    );
    Object.entries(conflictRecord).forEach(([boardId, conflict]) => {
      if (!isRecord(conflict)) {
        return;
      }
      const safeConflict = sanitizeCreativeDocumentPayload(conflict);
      const revision = normalizeBaseRevision(safeConflict.revision);
      const hasRemoteSnapshot =
        safeConflict.hasRemoteSnapshot === true ||
        isCreativeWorkspaceDocumentSnapshot(safeConflict.snapshot);
      const restoredConflict: CreativeDocumentSyncConflict<CreativeWorkspaceBoardSnapshot> =
        {
          boardId,
          ...(revision !== undefined ? { revision } : {}),
          ...(hasRemoteSnapshot ? { hasRemoteSnapshot: true } : {}),
          ...(typeof safeConflict.message === 'string'
            ? { message: safeConflict.message }
            : {}),
          recordedAt:
            typeof safeConflict.recordedAt === 'number'
              ? safeConflict.recordedAt
              : Date.now(),
        };
      this.conflicts.set(boardId, restoredConflict);
      this.frozenBoards.add(boardId);
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending().catch((error) => {
        console.warn(
          '[CreativeDocumentCloudSync] flush failed:',
          getSafeCreativeAssetSyncErrorMessage(error)
        );
      });
    }, this.debounceMs);
  }

  private async flushDelete(boardId: string): Promise<void> {
    try {
      await this.adapter.delete(boardId);
      this.pendingDeletes.delete(boardId);
      this.revisions.delete(boardId);
      this.conflicts.delete(boardId);
      this.frozenBoards.delete(boardId);
      this.persistRevisions();
      this.persistConflicts();
      this.hasCloudSaved = true;
    } catch (error) {
      console.warn(
        '[CreativeDocumentCloudSync] delete failed:',
        getSafeCreativeAssetSyncErrorMessage(error)
      );
    }
  }

  private async flushSnapshot(
    boardId: string,
    document: CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>
  ): Promise<void> {
    try {
      const baseRevision = this.revisions.get(boardId);
      const outboundDocument = await this.prepareDocumentForCloud(document);
      const saved =
        baseRevision === undefined
          ? await this.createOrUpdateUnknownRevision(boardId, outboundDocument)
          : await this.putWithKnownRevision(
              boardId,
              outboundDocument,
              baseRevision
            );

      this.applyRevisionFromDocument(boardId, saved);
      this.pendingSnapshots.delete(boardId);
      this.conflicts.delete(boardId);
      this.frozenBoards.delete(boardId);
      this.persistConflicts();
      this.hasCloudSaved = true;
      this.clearAssetSyncError();
    } catch (error) {
      if (isConflictError<CreativeWorkspaceBoardSnapshot>(error)) {
        this.freezeBoard(boardId, error);
        return;
      }
      this.recordAssetSyncError(error);
      console.warn(
        '[CreativeDocumentCloudSync] upload failed:',
        getSafeCreativeAssetSyncErrorMessage(error)
      );
    }
  }

  private async prepareDocumentForCloud(
    document: CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>
  ): Promise<CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>> {
    return await prepareCreativeDocumentAssetsForSync(document, {
      assetSyncEnabled: this.assetSyncEnabled,
      assetAdapter: this.assetAdapter,
      ...(this.assetCache ? { cache: this.assetCache } : {}),
    });
  }

  private async createOrUpdateUnknownRevision(
    boardId: string,
    document: CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>
  ): Promise<CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>> {
    try {
      const created = await this.adapter.create(document);
      const createdRevision = getDocumentRevision(created);
      if (createdRevision !== undefined) {
        return created;
      }
      const remoteRevision = await this.refreshRemoteRevision(boardId);
      if (remoteRevision === undefined) {
        throw new CreativeDocumentConflictError({
          message: 'Remote document revision is missing after create',
        });
      }
      return created;
    } catch (error) {
      if (!isConflictError<CreativeWorkspaceBoardSnapshot>(error)) {
        throw error;
      }
      throw await this.buildUnknownRevisionConflict(boardId, error);
    }
  }

  private async buildUnknownRevisionConflict(
    boardId: string,
    error: CreativeDocumentConflictError<CreativeWorkspaceBoardSnapshot>
  ): Promise<CreativeDocumentConflictError<CreativeWorkspaceBoardSnapshot>> {
    try {
      const remote = await this.adapter.get<CreativeWorkspaceBoardSnapshot>(
        boardId
      );
      const remoteRevision = this.applyRevisionFromDocument(boardId, remote);
      return new CreativeDocumentConflictError({
        ...error.conflict,
        ...(remoteRevision !== undefined ? { revision: remoteRevision } : {}),
        snapshot: remote,
        message:
          error.conflict.message ||
          'Remote document already exists; manual conflict resolution required',
      });
    } catch {
      return new CreativeDocumentConflictError({
        ...error.conflict,
        message:
          error.conflict.message ||
          'Remote document already exists; manual conflict resolution required',
      });
    }
  }

  private async putWithKnownRevision(
    boardId: string,
    document: CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>,
    baseRevision: string | number
  ): Promise<CreativeDocumentSnapshot<CreativeWorkspaceBoardSnapshot>> {
    const saved = await this.adapter.put(boardId, document, baseRevision);
    if (getDocumentRevision(saved) === undefined) {
      await this.refreshRemoteRevision(boardId);
    }
    return saved;
  }

  async syncRemoteDocumentsForColdStart(): Promise<void> {
    if (!this.adapter.list) {
      return;
    }
    if (!this.assetSyncEnabled) {
      return;
    }

    const summaries = await this.adapter.list();
    for (const summary of summaries) {
      const boardId = typeof summary.id === 'string' ? summary.id : '';
      if (!boardId) {
        continue;
      }

      const remoteRevision = normalizeCloudRevision(summary.revision);
      if (await this.workspaceRepository.hasBoard(boardId)) {
        const localRevision =
          this.revisions.get(boardId) ??
          (await this.workspaceRepository.getStoredRevision(boardId));
        if (
          localRevision !== null &&
          localRevision !== undefined &&
          remoteRevision !== undefined &&
          String(localRevision) !== String(remoteRevision)
        ) {
          this.conflicts.set(boardId, {
            boardId,
            revision: remoteRevision,
            hasRemoteSnapshot: false,
            message:
              'Remote document revision differs from the local board; manual review required',
            recordedAt: Date.now(),
          });
          this.frozenBoards.add(boardId);
          this.persistConflicts();
          this.notifyStatusListeners();
        }
        continue;
      }

      try {
        const remote = await this.adapter.get<CreativeWorkspaceBoardSnapshot>(
          boardId
        );
        const hydrated = await hydrateCreativeDocumentAssets(remote, {
          assetSyncEnabled: this.assetSyncEnabled,
          assetAdapter: this.assetAdapter,
          ...(this.assetCache ? { cache: this.assetCache } : {}),
        });
        const board = documentToBoard(hydrated);
        if (!board) {
          continue;
        }
        const revision = getDocumentRevision(hydrated) ?? remoteRevision;
        if (revision === undefined) {
          continue;
        }
        await this.workspaceRepository.upsertBoardFromCloud(board, revision, {
          suppressOutboundSync: true,
        });
        this.revisions.set(boardId, revision);
        this.persistRevisions();
        this.clearAssetSyncError();
      } catch (error) {
        this.recordAssetSyncError(error);
        console.warn(
          '[CreativeDocumentCloudSync] remote hydrate failed:',
          getSafeCreativeAssetSyncErrorMessage(error)
        );
      }
    }
  }

  private async refreshRemoteRevision(
    boardId: string
  ): Promise<string | number | undefined> {
    const remote = await this.adapter.get<CreativeWorkspaceBoardSnapshot>(
      boardId
    );
    return this.applyRevisionFromDocument(boardId, remote);
  }

  private applyRevisionFromDocument(
    boardId: string,
    document: CreativeDocumentSnapshot | null | undefined
  ): string | number | undefined {
    const revision = getDocumentRevision(document);
    if (revision !== undefined) {
      this.revisions.set(boardId, revision);
      this.persistRevisions();
    }
    return revision;
  }

  private freezeBoard(
    boardId: string,
    error: CreativeDocumentConflictError<CreativeWorkspaceBoardSnapshot>
  ): void {
    const conflict = conflictFromError<CreativeWorkspaceBoardSnapshot>(
      boardId,
      error
    );
    this.frozenBoards.add(boardId);
    this.conflicts.set(boardId, conflict);
    this.persistConflicts();
    this.notifyStatusListeners();
    console.warn(
      '[CreativeDocumentCloudSync] conflict recorded:',
      summarizeConflict(conflict)
    );
  }

  private persistRevisions(): void {
    writeStorageRecord(
      this.storage,
      CREATIVE_DOCUMENT_REVISION_STORAGE_KEY,
      Object.fromEntries(this.revisions.entries())
    );
  }

  private persistConflicts(): void {
    writeStorageRecord(
      this.storage,
      CREATIVE_DOCUMENT_CONFLICT_STORAGE_KEY,
      Object.fromEntries(this.conflicts.entries())
    );
  }
}

export const creativeDocumentCloudAdapter = new CreativeDocumentCloudAdapter();

let creativeDocumentCloudSyncService:
  | CreativeDocumentCloudSyncService
  | null = null;

export function initializeCreativeDocumentCloudSync(
  options: CreativeDocumentCloudSyncInitializeOptions = {}
): CreativeDocumentCloudSyncService | null {
  if (!isCreativeEmbeddedMode(options.locationLike)) {
    return null;
  }

  creativeDocumentCloudSyncService ||= new CreativeDocumentCloudSyncService(
    options
  );
  creativeDocumentCloudSyncService.start();
  return creativeDocumentCloudSyncService;
}

export function getCreativeDocumentCloudSyncServiceForTests():
  | CreativeDocumentCloudSyncService
  | null {
  return creativeDocumentCloudSyncService;
}

export function getCreativeDocumentCloudSyncService():
  | CreativeDocumentCloudSyncService
  | null {
  return creativeDocumentCloudSyncService;
}

export function getCreativeDocumentCloudSyncStatusSnapshot(
  service: CreativeDocumentCloudSyncService | null = creativeDocumentCloudSyncService
): CreativeDocumentCloudSyncStatus {
  return service?.getStatus() || createIdleCreativeDocumentCloudSyncStatus();
}

export function resetCreativeDocumentCloudSyncForTests(): void {
  creativeDocumentCloudSyncService?.stop();
  creativeDocumentCloudSyncService = null;
}
