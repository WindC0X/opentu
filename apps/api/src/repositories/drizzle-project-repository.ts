import { and, desc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { AppError } from '../errors';
import type {
  CreateProjectInput,
  Project,
  ProjectRepository,
  UpdateProjectInput,
} from '../projects/types';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleProjectRepository implements ProjectRepository {
  constructor(private readonly db: Db) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const [row] = await this.db
      .insert(schema.mtProjects)
      .values({
        opentuWorkspaceId: input.opentuWorkspaceId,
        ownerUserId: input.ownerUserId,
        tenantId: input.tenantId,
        title: input.title,
      })
      .returning();
    return mapProject(requireRow(row, 'Project insert failed'));
  }

  async findProjectById(
    tenantId: string,
    projectId: string
  ): Promise<Project | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtProjects)
      .where(
        and(
          eq(schema.mtProjects.tenantId, tenantId),
          eq(schema.mtProjects.id, projectId),
          isNull(schema.mtProjects.deletedAt)
        )
      )
      .limit(1);
    return row ? mapProject(row) : null;
  }

  async listProjectsByOwner(
    tenantId: string,
    ownerUserId: string
  ): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(schema.mtProjects)
      .where(
        and(
          eq(schema.mtProjects.tenantId, tenantId),
          eq(schema.mtProjects.ownerUserId, ownerUserId),
          eq(schema.mtProjects.status, 'active'),
          isNull(schema.mtProjects.deletedAt)
        )
      )
      .orderBy(desc(schema.mtProjects.updatedAt));
    return rows.map(mapProject);
  }

  async updateProject(
    id: string,
    patch: UpdateProjectInput
  ): Promise<Project> {
    const [row] = await this.db
      .update(schema.mtProjects)
      .set({
        lastOpenedAt: patch.lastOpenedAt,
        status: patch.status,
        title: patch.title,
        updatedAt: new Date(),
      })
      .where(eq(schema.mtProjects.id, id))
      .returning();
    return mapProject(requireRow(row, 'Project not found'));
  }
}

function mapProject(row: typeof schema.mtProjects.$inferSelect): Project {
  return {
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    id: row.id,
    lastOpenedAt: row.lastOpenedAt,
    opentuWorkspaceId: row.opentuWorkspaceId,
    ownerUserId: row.ownerUserId,
    status: row.status,
    tenantId: row.tenantId,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new AppError('PROJECT_NOT_FOUND', 404, message);
  }
  return row;
}
