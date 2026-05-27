import { randomUUID } from 'crypto';

import { AppError } from '../errors';
import type { AuthenticatedSession } from '../auth/types';
import { DEFAULT_TENANT_ID } from '../auth/types';
import { listMockImageModels } from '../providers/mock-provider';
import type {
  CanvasBootContext,
  HomeSummary,
  Project,
  ProjectRepository,
  ProjectView,
} from './types';

interface ProjectServiceOptions {
  now?: () => Date;
  tenantId?: string;
  workspaceIdFactory?: () => string;
}

export class ProjectService {
  private readonly now: () => Date;
  private readonly tenantId: string;
  private readonly workspaceIdFactory: () => string;

  constructor(
    private readonly repository: ProjectRepository,
    options: ProjectServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
    this.workspaceIdFactory =
      options.workspaceIdFactory ?? (() => `workspace_${randomUUID()}`);
  }

  async listProjects(
    auth: AuthenticatedSession
  ): Promise<{ projects: ProjectView[] }> {
    const projects = await this.repository.listProjectsByOwner(
      this.tenantId,
      auth.user.id
    );
    return { projects: projects.map(toProjectView) };
  }

  async createProject(
    auth: AuthenticatedSession,
    input: { title: string }
  ): Promise<{ project: ProjectView }> {
    const title = normalizeTitle(input.title);
    const project = await this.repository.createProject({
      opentuWorkspaceId: this.workspaceIdFactory(),
      ownerUserId: auth.user.id,
      tenantId: this.tenantId,
      title,
    });

    return { project: toProjectView(project) };
  }

  async getProject(
    auth: AuthenticatedSession,
    projectId: string
  ): Promise<{ project: ProjectView }> {
    const project = await this.requireVisibleProject(auth, projectId);
    return { project: toProjectView(project) };
  }

  async openCanvas(
    auth: AuthenticatedSession,
    projectId: string
  ): Promise<CanvasBootContext> {
    const project = await this.requireProject(projectId);
    if (project.ownerUserId !== auth.user.id) {
      throw new AppError('FORBIDDEN', 403, '无权访问该项目');
    }
    if (project.status !== 'active') {
      throw new AppError('PROJECT_NOT_FOUND', 404, '项目不存在');
    }

    const opened = await this.repository.updateProject(project.id, {
      lastOpenedAt: this.now(),
    });
    const opentuWorkspaceId =
      opened.opentuWorkspaceId ?? `workspace_${opened.id}`;

    return {
      canvasUrl: `/canvas?project_id=${encodeURIComponent(
        opened.id
      )}&board=${encodeURIComponent(opentuWorkspaceId)}`,
      featureFlags: {
        agentEnabled: false,
        experimentalToolsEnabled: false,
        imageTaskEnabled: true,
      },
      models: listMockImageModels(),
      opentuWorkspaceId,
      projectId: opened.id,
    };
  }

  async homeSummary(auth: AuthenticatedSession): Promise<HomeSummary> {
    const projects = await this.repository.listProjectsByOwner(
      this.tenantId,
      auth.user.id
    );

    return {
      projects: {
        items: projects.slice(0, 5).map(toProjectView),
        total: projects.length,
      },
      quota: auth.quota,
      recentAssets: [],
      recentTasks: [],
      user: {
        id: auth.user.id,
        role: auth.user.role,
        username: auth.user.username,
      },
    };
  }

  private async requireVisibleProject(
    auth: AuthenticatedSession,
    projectId: string
  ): Promise<Project> {
    const project = await this.requireProject(projectId);
    if (project.status !== 'active') {
      throw new AppError('PROJECT_NOT_FOUND', 404, '项目不存在');
    }
    if (project.ownerUserId === auth.user.id || auth.user.role === 'admin') {
      return project;
    }
    throw new AppError('PROJECT_NOT_FOUND', 404, '项目不存在');
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.repository.findProjectById(
      this.tenantId,
      projectId
    );
    if (!project || project.deletedAt) {
      throw new AppError('PROJECT_NOT_FOUND', 404, '项目不存在');
    }
    return project;
  }
}

export function toProjectView(project: Project): ProjectView {
  return {
    createdAt: project.createdAt,
    id: project.id,
    lastOpenedAt: project.lastOpenedAt,
    opentuWorkspaceId: project.opentuWorkspaceId ?? `workspace_${project.id}`,
    status: project.status,
    title: project.title,
    updatedAt: project.updatedAt,
  };
}

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new AppError('PROJECT_TITLE_REQUIRED', 400, '请输入项目名称');
  }
  if (normalized.length > 120) {
    throw new AppError('PROJECT_TITLE_TOO_LONG', 400, '项目名称过长');
  }
  return normalized;
}
