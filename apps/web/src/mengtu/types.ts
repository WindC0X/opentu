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
  recentTasks: [];
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
  models: [];
  opentuWorkspaceId: string;
  projectId: string;
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
