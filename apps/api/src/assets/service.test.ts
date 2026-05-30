import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_ID } from '../auth/types';
import { createTestAppContext, createUserWithQuota } from '../test/helpers';
import { sha256 } from './image-metadata';

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

  it('removes PNG metadata chunks from provider-safe variants only', async () => {
    const {
      assetRepository,
      assetService,
      projectService,
      repository,
      service,
      storageService,
    } = await createTestAppContext();
    const user = await createUserWithQuota(repository, {
      email: 'asset-png-metadata@mengtu.local',
      password: 'user-password',
      username: 'asset-png-metadata',
    });
    const auth = await service.authenticateSession(
      (
        await service.login(user.email, 'user-password')
      ).session.token
    );
    const createdProject = await projectService.createProject(auth, {
      title: 'PNG Metadata',
    });
    const input = pngWithMetadataChunks();

    const result = await assetService.uploadAsset(auth, {
      body: input,
      fileName: 'metadata.png',
      mimeType: 'image/png',
      projectId: createdProject.project.id,
    });

    const original = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'original'
    );
    const providerInput = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'provider_input'
    );
    const thumb = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'thumb'
    );
    expect(original).not.toBeNull();
    expect(providerInput).not.toBeNull();
    expect(thumb).not.toBeNull();

    const originalBody = storageService.objects.get(original!.storageKey)!.body;
    const providerBody = storageService.objects.get(
      providerInput!.storageKey
    )!.body;
    const thumbBody = storageService.objects.get(thumb!.storageKey)!.body;

    expect(originalBody.equals(input)).toBe(true);
    expect(pngChunkTypes(originalBody)).toEqual(
      expect.arrayContaining(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'iCCP'])
    );
    expect(pngChunkTypes(providerBody)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(thumbBody.equals(providerBody)).toBe(true);
    expect(providerInput!.sizeBytes).toBe(providerBody.byteLength);
    expect(providerInput!.sha256).toBe(sha256(providerBody));
    expect(thumb!.sizeBytes).toBe(thumbBody.byteLength);
    expect(thumb!.sha256).toBe(sha256(thumbBody));
    expect(providerInput!.exifRemoved).toBe(true);
    expect(thumb!.exifRemoved).toBe(true);
  });

  it('keeps JPEG EXIF stripping covered for provider-safe variants', async () => {
    const {
      assetRepository,
      assetService,
      projectService,
      repository,
      service,
      storageService,
    } = await createTestAppContext();
    const user = await createUserWithQuota(repository, {
      email: 'asset-jpeg-exif@mengtu.local',
      password: 'user-password',
      username: 'asset-jpeg-exif',
    });
    const auth = await service.authenticateSession(
      (
        await service.login(user.email, 'user-password')
      ).session.token
    );
    const createdProject = await projectService.createProject(auth, {
      title: 'JPEG EXIF',
    });
    const input = jpegWithExif();

    const result = await assetService.uploadAsset(auth, {
      body: input,
      fileName: 'metadata.jpg',
      mimeType: 'image/jpeg',
      projectId: createdProject.project.id,
    });

    const original = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'original'
    );
    const providerInput = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'provider_input'
    );
    const thumb = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'thumb'
    );
    expect(original).not.toBeNull();
    expect(providerInput).not.toBeNull();
    expect(thumb).not.toBeNull();

    const originalBody = storageService.objects.get(original!.storageKey)!.body;
    const providerBody = storageService.objects.get(
      providerInput!.storageKey
    )!.body;
    const thumbBody = storageService.objects.get(thumb!.storageKey)!.body;

    expect(originalBody.equals(input)).toBe(true);
    expect(originalBody.includes(Buffer.from('Exif\u0000\u0000GPS'))).toBe(true);
    expect(providerBody.includes(Buffer.from('Exif\u0000\u0000GPS'))).toBe(false);
    expect(thumbBody.equals(providerBody)).toBe(true);
    expect(providerInput!.sizeBytes).toBe(providerBody.byteLength);
    expect(providerInput!.sha256).toBe(sha256(providerBody));
    expect(thumb!.sizeBytes).toBe(thumbBody.byteLength);
    expect(thumb!.sha256).toBe(sha256(thumbBody));
  });

  it('removes WebP metadata chunks and rewrites provider-safe RIFF size', async () => {
    const {
      assetRepository,
      assetService,
      projectService,
      repository,
      service,
      storageService,
    } = await createTestAppContext();
    const user = await createUserWithQuota(repository, {
      email: 'asset-webp-metadata@mengtu.local',
      password: 'user-password',
      username: 'asset-webp-metadata',
    });
    const auth = await service.authenticateSession(
      (
        await service.login(user.email, 'user-password')
      ).session.token
    );
    const createdProject = await projectService.createProject(auth, {
      title: 'WebP Metadata',
    });
    const input = webpWithMetadataChunks();

    const result = await assetService.uploadAsset(auth, {
      body: input,
      fileName: 'metadata.webp',
      mimeType: 'image/webp',
      projectId: createdProject.project.id,
    });

    const original = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'original'
    );
    const providerInput = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'provider_input'
    );
    const thumb = await assetRepository.findVariant(
      DEFAULT_TENANT_ID,
      result.asset.id,
      'thumb'
    );
    expect(original).not.toBeNull();
    expect(providerInput).not.toBeNull();
    expect(thumb).not.toBeNull();

    const originalBody = storageService.objects.get(original!.storageKey)!.body;
    const providerBody = storageService.objects.get(
      providerInput!.storageKey
    )!.body;
    const thumbBody = storageService.objects.get(thumb!.storageKey)!.body;

    expect(originalBody.equals(input)).toBe(true);
    expect(webpChunkTypes(originalBody)).toEqual(
      expect.arrayContaining(['VP8X', 'EXIF', 'XMP ', 'ICCP'])
    );
    expect(webpChunkTypes(providerBody)).toEqual(['VP8X']);
    expect(providerBody.readUInt32LE(4)).toBe(providerBody.byteLength - 8);
    expect(providerBody[20] & (0x20 | 0x08 | 0x04)).toBe(0);
    expect(thumbBody.equals(providerBody)).toBe(true);
    expect(providerInput!.sizeBytes).toBe(providerBody.byteLength);
    expect(providerInput!.sha256).toBe(sha256(providerBody));
    expect(thumb!.sizeBytes).toBe(thumbBody.byteLength);
    expect(thumb!.sha256).toBe(sha256(thumbBody));
    expect(providerInput!.exifRemoved).toBe(true);
    expect(thumb!.exifRemoved).toBe(true);
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

function jpegWithExif(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe1, Buffer.from('Exif\u0000\u0000GPS')),
    jpegSegment(
      0xc0,
      Buffer.from([
        0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11,
        0x00, 0x03, 0x11, 0x00,
      ])
    ),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from([0x00, 0xff, 0xd9]),
  ]);
}

function jpegSegment(marker: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(data.byteLength + 2, 2);
  return Buffer.concat([header, data]);
}

function pngWithMetadataChunks(): Buffer {
  const base = tinyPng();
  return Buffer.concat([
    base.subarray(0, 33),
    pngChunk('eXIf', Buffer.from('Exif\u0000\u0000gps')),
    pngChunk('tEXt', Buffer.from('Comment\u0000location')),
    pngChunk('zTXt', Buffer.from('Raw\u0000compressed')),
    pngChunk('iTXt', Buffer.from('Prompt\u0000\u0000\u0000\u0000\u0000secret')),
    pngChunk('iCCP', Buffer.from('profile\u0000icc')),
    base.subarray(33),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.byteLength, 0);
  header.write(type, 4, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])));
  return Buffer.concat([header, data, crc]);
}

function pngChunkTypes(buffer: Buffer): string[] {
  const result: string[] = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const dataLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    result.push(chunkType);
    offset += 12 + dataLength;
    if (chunkType === 'IEND') {
      break;
    }
  }
  return result;
}

function webpWithMetadataChunks(): Buffer {
  const body = Buffer.concat([
    Buffer.from('WEBP', 'ascii'),
    webpChunk(
      'VP8X',
      Buffer.from([0x20 | 0x08 | 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    ),
    webpChunk('EXIF', Buffer.from('Exif\u0000\u0000gps')),
    webpChunk('XMP ', Buffer.from('<xmp>secret</xmp>')),
    webpChunk('ICCP', Buffer.from('profile')),
  ]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32LE(data.byteLength, 4);
  const padding = data.byteLength % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, data, padding]);
}

function webpChunkTypes(buffer: Buffer): string[] {
  const result: string[] = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const dataLength = buffer.readUInt32LE(offset + 4);
    result.push(chunkType);
    offset += 8 + dataLength + (dataLength % 2);
  }
  return result;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crc ^ byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
