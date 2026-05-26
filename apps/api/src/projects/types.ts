import type { AuthenticatedSession, QuotaSummary } from '../auth/types';

export type ProjectStatus = 'active' | 'archived' | 'deleted';
export type CanvasSyncStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface Project {
  id: string;
  tenantId: string;
  ownerUserId: string;
  title: string;
  status: ProjectStatus;
  opentuWorkspaceId: string | null;
  lastOpenedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CanvasSyncRecord {
  id: string;
  tenantId: string;
  projectId: string;
  imageTaskId: string | null;
  assetId: string | null;
  status: CanvasSyncStatus;
  retryCount: number;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectView {
  id: string;
  title: string;
  status: ProjectStatus;
  opentuWorkspaceId: string;
  lastOpenedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  tenantId: string;
  ownerUserId: string;
  title: string;
  opentuWorkspaceId: string;
}

export interface UpdateProjectInput {
  lastOpenedAt?: Date | null;
  status?: ProjectStatus;
  title?: string;
}

export interface ProjectRepository {
  createProject(input: CreateProjectInput): Promise<Project>;
  findProjectById(tenantId: string, projectId: string): Promise<Project | null>;
  listProjectsByOwner(tenantId: string, ownerUserId: string): Promise<Project[]>;
  updateProject(id: string, patch: UpdateProjectInput): Promise<Project>;
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

export interface HomeSummary {
  projects: {
    items: ProjectView[];
    total: number;
  };
  quota: QuotaSummary;
  recentAssets: [];
  recentTasks: [];
  user: {
    id: string;
    role: AuthenticatedSession['user']['role'];
    username: string;
  };
}
