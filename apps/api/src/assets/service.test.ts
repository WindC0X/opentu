import { describe, expect, it } from 'vitest';

import { createTestAppContext, createUserWithQuota } from '../test/helpers';

describe('AssetService', () => {
  it('creates upload assets with stable object keys and required variants', async () => {
    const {
      assetService,
      projectService,
      repository,
      service,
      storageService,
    } = await createTestAppContext();
    const user = await createUserWithQuota(repository, {
      email: 'asset-service@mengtu.local',
      password: 'user-password',
      username: 'asset-service',
    });
    const auth = await service.authenticateSession(
      (
        await service.login(user.email, 'user-password')
      ).session.token
    );
    const createdProject = await projectService.createProject(auth, {
      title: 'Asset Service',
    });

    const result = await assetService.uploadAsset(auth, {
      body: tinyPng(),
      fileName: 'pixel.png',
      mimeType: 'image/png',
      projectId: createdProject.project.id,
    });

    expect(result.asset).toMatchObject({
      assetKind: 'image',
      height: 1,
      origin: 'upload',
      projectId: createdProject.project.id,
      visibilityStatus: 'normal',
      width: 1,
    });
    expect(result.asset.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'original', exifRemoved: false }),
        expect.objectContaining({ type: 'provider_input', exifRemoved: true }),
        expect.objectContaining({ type: 'thumb', exifRemoved: true }),
      ])
    );
    expect([...storageService.objects.keys()]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^test\/tenants\/00000000-0000-0000-0000-000000000001\/users\/[^/]+\/projects\/[^/]+\/assets\/[^/]+\/original\.png$/
        ),
      ])
    );
  });

  it('creates mask uploads without changing normal image upload defaults', async () => {
    const { assetService, projectService, repository, service } =
      await createTestAppContext();
    const user = await createUserWithQuota(repository, {
      email: 'asset-mask-service@mengtu.local',
      password: 'user-password',
      username: 'asset-mask-service',
    });
    const auth = await service.authenticateSession(
      (
        await service.login(user.email, 'user-password')
      ).session.token
    );
    const createdProject = await projectService.createProject(auth, {
      title: 'Mask Asset Service',
    });

    const result = await assetService.uploadAsset(auth, {
      assetKind: 'mask',
      body: tinyPng(),
      fileName: 'mask.png',
      mimeType: 'image/png',
      projectId: createdProject.project.id,
    });

    expect(result.asset).toMatchObject({
      assetKind: 'mask',
      origin: 'mask',
      projectId: createdProject.project.id,
      visibilityStatus: 'normal',
    });
  });

  it('rejects mismatched MIME and owner-crossed project uploads', async () => {
    const { assetService, projectService, repository, service } =
      await createTestAppContext();
    const owner = await createUserWithQuota(repository, {
      email: 'owner-service@mengtu.local',
      password: 'owner-password',
      username: 'owner-service',
    });
    const other = await createUserWithQuota(repository, {
      email: 'other-service@mengtu.local',
      password: 'other-password',
      username: 'other-service',
    });
    const ownerAuth = await service.authenticateSession(
      (
        await service.login(owner.email, 'owner-password')
      ).session.token
    );
    const otherAuth = await service.authenticateSession(
      (
        await service.login(other.email, 'other-password')
      ).session.token
    );
    const createdProject = await projectService.createProject(ownerAuth, {
      title: 'Owner Project',
    });

    await expect(
      assetService.uploadAsset(ownerAuth, {
        body: tinyPng(),
        fileName: 'pixel.jpg',
        mimeType: 'image/jpeg',
        projectId: createdProject.project.id,
      })
    ).rejects.toMatchObject({ code: 'UPLOAD_INVALID_FORMAT' });

    await expect(
      assetService.uploadAsset(otherAuth, {
        body: tinyPng(),
        fileName: 'pixel.png',
        mimeType: 'image/png',
        projectId: createdProject.project.id,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
}
