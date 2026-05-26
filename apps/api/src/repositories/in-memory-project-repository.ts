import { randomUUID } from 'crypto';

import { AppError } from '../errors';
import type {
  CreateProjectInput,
  Project,
  ProjectRepository,
  UpdateProjectInput,
} from '../projects/types';

export class InMemoryProjectRepository implements ProjectRepository {
  readonly projects = new Map<string, Project>();

  async createProject(input: CreateProjectInput): Promise<Project> {
    this.assertUniqueWorkspace(input.tenantId, input.opentuWorkspaceId);

    const now = new Date();
    const project: Project = {
      createdAt: now,
      deletedAt: null,
      id: randomUUID(),
      lastOpenedAt: null,
      opentuWorkspaceId: input.opentuWorkspaceId,
      ownerUserId: input.ownerUserId,
      status: 'active',
      tenantId: input.tenantId,
      title: input.title,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    return project;
  }

  async findProjectById(
    tenantId: string,
    projectId: string
  ): Promise<Project | null> {
    const project = this.projects.get(projectId);
    return project?.tenantId === tenantId ? project : null;
  }

  async listProjectsByOwner(
    tenantId: string,
    ownerUserId: string
  ): Promise<Project[]> {
    return [...this.projects.values()]
      .filter(
        (project) =>
          project.tenantId === tenantId &&
          project.ownerUserId === ownerUserId &&
          project.status === 'active' &&
          !project.deletedAt
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async updateProject(
    id: string,
    patch: UpdateProjectInput
  ): Promise<Project> {
    const project = this.projects.get(id);
    if (!project) {
      throw new AppError('PROJECT_NOT_FOUND', 404, '项目不存在');
    }

    const updated: Project = {
      ...project,
      ...patch,
      updatedAt: new Date(),
    };
    this.projects.set(id, updated);
    return updated;
  }

  private assertUniqueWorkspace(
    tenantId: string,
    opentuWorkspaceId: string
  ): void {
    const existing = [...this.projects.values()].find(
      (project) =>
        project.tenantId === tenantId &&
        project.opentuWorkspaceId === opentuWorkspaceId
    );
    if (existing) {
      throw new AppError('CONFLICT', 409, 'Workspace already exists');
    }
  }
}
