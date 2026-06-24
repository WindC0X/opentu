import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCachedBlob: vi.fn(),
  cacheMediaFromBlob: vi.fn(),
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
  },
}));

describe('generated media cache readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.getCachedBlob.mockResolvedValue(null);
    mocks.cacheMediaFromBlob.mockResolvedValue(undefined);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 640,
        height: 360,
        close: vi.fn(),
      }))
    );
  });

  it('bounded-retries Creative content rehydrate before failing canvas readiness on slow content availability', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        '/creative/relay/v1/images/tasks/remote-slow-content/content'
      );
      attempts += 1;
      if (attempts < 3) {
        return new Response('warming up', { status: 503 });
      }
      return new Response(new Blob(['png-bytes'], { type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ensureGeneratedImageCacheUrlReady } = await import(
      '../generated-media-cache'
    );

    try {
      const verification = ensureGeneratedImageCacheUrlReady(
        '/__aitu_cache__/image/remote-slow-content.png',
        {
          contentUrl:
            '/creative/relay/v1/images/tasks/remote-slow-content/content',
          metadata: { taskId: 'task-slow-content' },
        }
      );

      await vi.advanceTimersByTimeAsync(5_000);

      await expect(verification).resolves.toMatchObject({
        url: '/__aitu_cache__/image/remote-slow-content.png',
        mimeType: 'image/png',
        width: 640,
        height: 360,
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
        '/__aitu_cache__/image/remote-slow-content.png',
        expect.any(Blob),
        'image',
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskId: 'task-slow-content',
            contentUrl:
              '/creative/relay/v1/images/tasks/remote-slow-content/content',
          }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
