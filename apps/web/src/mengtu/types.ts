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
