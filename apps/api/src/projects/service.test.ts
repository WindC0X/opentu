import { describe, expect, it } from 'vitest';

import { AppError } from '../errors';
import {
  createTestAuthContext,
  createUserWithQuota,
} from '../test/helpers';
import { InMemoryProjectRepository } from '../repositories/in-memory-project-repository';
import { ProjectService } from './service';

describe('ProjectService', () => {
  it('creates owner projects and returns home summary fields', async () => {
    const { repository: authRepository, service: authService } =
      await createTestAuthContext();
    const user = await createUserWithQuota(authRepository, {
      email: 'owner@mengtu.local',
      password: 'user-password',
      username: 'owner',
    });
    const auth = await authService.authenticateSession(
      (await authService.login(user.email, 'user-password')).session.token
    );
    const projectRepository = new InMemoryProjectRepository();
    const service = new ProjectService(projectRepository, {
      now: () => new Date('2026-05-26T00:00:00.000Z'),
      workspaceIdFactory: () => 'workspace-owner-1',
    });

    const created = await service.createProject(auth, {
      title: '  我的项目  ',
    });

    expect(created.project).toMatchObject({
      opentuWorkspaceId: 'workspace-owner-1',
      status: 'active',
      title: '我的项目',
    });

    const summary = await service.homeSummary(auth);
    expect(summary.projects.total).toBe(1);
    expect(summary.projects.items[0]?.id).toBe(created.project.id);
    expect(summary.quota.balanceAmount).toBe(0);
    expect(summary.recentAssets).toEqual([]);
    expect(summary.recentTasks).toEqual([]);
  });

  it('requires a non-empty project title', async () => {
    const { service: authService } = await createTestAuthContext();
    const auth = await authService.authenticateSession(
      (await authService.login('admin@mengtu.local', 'admin-password')).session
        .token
    );
    const service = new ProjectService(new InMemoryProjectRepository());

    await expect(service.createProject(auth, { title: '   ' })).rejects.toEqual(
      expect.objectContaining({
        code: 'PROJECT_TITLE_REQUIRED',
        status: 400,
      } satisfies Partial<AppError>)
    );
  });

  it('allows admin detail reads but keeps canvas entry owner-only', async () => {
    const { repository: authRepository, service: authService } =
      await createTestAuthContext();
    const owner = await createUserWithQuota(authRepository, {
      email: 'project-owner@mengtu.local',
      password: 'user-password',
      username: 'project-owner',
    });
    const ownerAuth = await authService.authenticateSession(
      (await authService.login(owner.email, 'user-password')).session.token
    );
    const adminAuth = await authService.authenticateSession(
      (await authService.login('admin@mengtu.local', 'admin-password')).session
        .token
    );
    const service = new ProjectService(new InMemoryProjectRepository(), {
      now: () => new Date('2026-05-26T00:00:00.000Z'),
      workspaceIdFactory: () => 'workspace-owner-2',
    });

    const created = await service.createProject(ownerAuth, {
      title: 'Owner Project',
    });

    await expect(
      service.getProject(adminAuth, created.project.id)
    ).resolves.toMatchObject({
      project: { id: created.project.id },
    });
    await expect(service.openCanvas(adminAuth, created.project.id)).rejects.toEqual(
      expect.objectContaining({
        code: 'FORBIDDEN',
        status: 403,
      } satisfies Partial<AppError>)
    );
    await expect(service.openCanvas(ownerAuth, created.project.id)).resolves.toMatchObject({
      canvasUrl: `/canvas?project_id=${created.project.id}&board=workspace-owner-2`,
      featureFlags: {
        agentEnabled: false,
        experimentalToolsEnabled: false,
        imageTaskEnabled: true,
      },
      models: expect.arrayContaining([
        expect.objectContaining({ modelKey: 'mock-image-v1' }),
      ]),
      opentuWorkspaceId: 'workspace-owner-2',
      projectId: created.project.id,
    });
  });
});
