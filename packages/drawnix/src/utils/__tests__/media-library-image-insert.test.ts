import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetSource, AssetType, type Asset } from '../../types/asset.types';

const mocks = vi.hoisted(() => ({
  ensureGeneratedImageCacheUrlReady: vi.fn(),
}));

vi.mock('../generated-media-cache', () => ({
  ensureGeneratedImageCacheUrlReady: mocks.ensureGeneratedImageCacheUrlReady,
}));

describe('media-library image insert helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureGeneratedImageCacheUrlReady.mockResolvedValue({
      url: '/__aitu_cache__/image/generated-ready.png',
      blob: new Blob(['x'], { type: 'image/png' }),
    });
  });

  it('rehydrates generated image cache assets using durable content metadata', async () => {
    const { getReadyMediaLibraryImageInsertUrl } = await import(
      '../media-library-image-insert'
    );
    const asset: Asset = {
      id: 'asset-1',
      type: AssetType.IMAGE,
      source: AssetSource.AI_GENERATED,
      url: '/__aitu_cache__/image/generated.png',
      name: 'generated',
      mimeType: 'image/png',
      createdAt: 1,
      taskId: 'task-1',
      remoteTaskId: 'remote-1',
      providerTaskId: 'provider-1',
      contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
      prompt: 'prompt',
      modelName: 'gpt-image-2',
    };

    await expect(getReadyMediaLibraryImageInsertUrl(asset)).resolves.toBe(
      '/__aitu_cache__/image/generated-ready.png'
    );
    expect(mocks.ensureGeneratedImageCacheUrlReady).toHaveBeenCalledWith(
      '/__aitu_cache__/image/generated.png',
      {
        contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
        metadata: {
          taskId: 'task-1',
          remoteTaskId: 'remote-1',
          providerTaskId: 'provider-1',
          contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
          mimeType: 'image/png',
          prompt: 'prompt',
          model: 'gpt-image-2',
        },
      }
    );
  });
});
