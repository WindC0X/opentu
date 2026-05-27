export interface ApiEnvelope<T> {
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
  request_id: string;
}

export interface QuotaSummary {
  accountId: string;
  balanceAmount: number;
  heldAmount: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: 'active' | 'archived' | 'deleted';
  opentuWorkspaceId: string;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomeSummary {
  projects: {
    items: ProjectSummary[];
    total: number;
  };
  quota: QuotaSummary;
  recentAssets: [];
  recentTasks: ImageTaskSummary[];
  user: {
    id: string;
    role: 'user' | 'admin';
    username: string;
  };
}

export interface CanvasBootContext {
  canvasUrl: string;
  featureFlags: {
    agentEnabled: boolean;
    experimentalToolsEnabled: boolean;
    imageTaskEnabled: boolean;
  };
  models: ImageModelSummary[];
  opentuWorkspaceId: string;
  projectId: string;
}

export interface ImageModelSummary {
  capabilities: {
    maxBatchSize: 1 | 2 | 4;
    operationType: 'text_to_image';
    supportedRatios: string[];
    supportsBatch: boolean;
  };
  displayName: string;
  modelKey: string;
  price: {
    amount: number;
    unit: 'per_image';
    version: number;
  };
  providerKey: string;
}

export interface ImageTaskQuote {
  amount: number;
  batchSize: 1 | 2 | 4;
  modelKey: string;
  operationType: 'text_to_image';
  pricePolicyId: string;
  priceVersion: number;
  ratio: string;
  unit: 'points';
}

export type ImageTaskStatus =
  | 'queued'
  | 'running'
  | 'persisting'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type ImageTaskCanvasSyncStatus =
  | 'not_required'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface ImageTaskSummary {
  actualModelKey: string | null;
  actualProvider: string | null;
  assets: AssetSummary[];
  batchSize: 1 | 2 | 4;
  canvasSyncStatus: ImageTaskCanvasSyncStatus;
  createdAt: string;
  failureCode: string | null;
  failureCount: number;
  failureMessage: string | null;
  finalPrompt: string;
  id: string;
  modelFamily: string;
  modelVersion: string;
  operationType: 'text_to_image';
  optimizedPrompt: string | null;
  ownerUserId: string;
  priceVersion: number;
  projectId: string;
  quotedPriceAmount: number;
  quotedPriceUnit: 'points';
  ratio: string;
  requestedModelKey: string;
  requestedProvider: string;
  settledAt: string | null;
  settledPriceAmount: number | null;
  status: ImageTaskStatus;
  successCount: number;
  updatedAt: string;
  userPrompt: string;
}

export type AssetVisibilityStatus = 'normal' | 'discarded' | 'hidden' | 'deleted';
export type AssetVariantType =
  | 'original'
  | 'provider_input'
  | 'thumb'
  | 'preview';

export interface AssetSummary {
  id: string;
  projectId: string;
  assetKind: 'image' | 'mask' | 'preset';
  origin: 'upload' | 'generated' | 'mask' | 'preset';
  visibilityStatus: AssetVisibilityStatus;
  favorite: boolean;
  selected: boolean;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  aiGenerated: boolean;
  aigcMetadataStatus: 'unknown' | 'present' | 'removed' | 'not_applicable';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  variants: Array<{
    exifRemoved: boolean;
    height: number;
    mimeType: string;
    sizeBytes: number;
    type: AssetVariantType;
    url: string;
    width: number;
  }>;
}
