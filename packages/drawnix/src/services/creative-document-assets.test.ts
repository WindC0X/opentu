import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CreativeAssetCloudAdapter,
  hydrateCreativeDocumentAssets,
  isCreativeAssetContentUrl,
  prepareCreativeDocumentAssetsForSync,
} from './creative-document-assets';
import {
  clearCreativeSessionAuthMaterial,
  resetCreativeAssetSyncConfigForTests,
  setCreativeSessionAuthMaterial,
} from './creative-mode';

describe('creative document asset preparation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearCreativeSessionAuthMaterial();
    resetCreativeAssetSyncConfigForTests();
  });

  function createCache() {
    return {
      getCachedBlob: vi.fn(async (url: string) => {
        const type = url.includes('/audio/')
          ? 'audio/mpeg'
          : url.includes('/video/') ||
            url.includes('/videos/') ||
            url.includes('/clips/') ||
            url.endsWith('.mp4')
          ? 'video/mp4'
          : 'image/png';
        return new Blob([`cached:${url}`], { type });
      }),
      cacheLocalMediaByContent: vi.fn(async (blob: Blob, type: string) => ({
        url: `/__aitu_cache__/${type}/content-local.${type === 'audio' ? 'mp3' : type === 'video' ? 'mp4' : 'png'}`,
        contentHash: 'content-local',
        reused: false,
      })),
    };
  }

  it('deep-copies, uploads required local media URL fields once, and rewrites only the outbound copy', async () => {
    const repeatedImageUrl = '/__aitu_cache__/image/repeated.png';
    const audioUrl = '/__aitu_generated__/audio/music.mp3';
    const assetLibraryUrl = '/asset-library/video/demo.mp4';
    const dataUrl = 'data:image/png;base64,aGVsbG8=';
    const payload = {
      id: 'board-1',
      snapshot: {
        elements: [
          {
            id: 'el-1',
            url: repeatedImageUrl,
            urls: [repeatedImageUrl],
            imageUrl: dataUrl,
            videoUrl: assetLibraryUrl,
            audioUrl,
            poster: repeatedImageUrl,
            src: repeatedImageUrl,
            thumbnail: repeatedImageUrl,
            thumbnailUrl: repeatedImageUrl,
            thumbnailUrls: [repeatedImageUrl],
            previewImageUrl: repeatedImageUrl,
            coverUrl: repeatedImageUrl,
            clips: [
              {
                audioUrl,
                imageUrl: repeatedImageUrl,
                imageLargeUrl: repeatedImageUrl,
              },
            ],
          },
        ],
      },
    };
    const original = structuredClone(payload);
    const cache = createCache();
    const upload = vi.fn(async (_blob: Blob, metadata?: { sourceUrl?: string }) => {
      const suffix = metadata?.sourceUrl?.includes('/audio/')
        ? 'audio'
        : metadata?.sourceUrl?.includes('/video/')
        ? 'video'
        : metadata?.sourceUrl?.startsWith('data:')
        ? 'data'
        : 'image';
      return `/creative/api/assets/asset_${suffix}/content`;
    });

    const prepared = await prepareCreativeDocumentAssetsForSync(payload, {
      assetSyncEnabled: true,
      assetAdapter: { upload },
      cache,
    });

    expect(payload).toEqual(original);
    expect(upload).toHaveBeenCalledTimes(4);
    expect(cache.getCachedBlob).toHaveBeenCalledWith(repeatedImageUrl);
    expect(cache.getCachedBlob).toHaveBeenCalledWith(audioUrl);
    expect(cache.getCachedBlob).toHaveBeenCalledWith(assetLibraryUrl);

    const preparedJson = JSON.stringify(prepared);
    expect(preparedJson).toContain('/creative/api/assets/asset_image/content');
    expect(preparedJson).toContain('/creative/api/assets/asset_audio/content');
    expect(preparedJson).toContain('/creative/api/assets/asset_video/content');
    expect(preparedJson).toContain('/creative/api/assets/asset_data/content');
    expect(preparedJson).not.toContain(repeatedImageUrl);
    expect(preparedJson).not.toContain(audioUrl);
    expect(preparedJson).not.toContain(assetLibraryUrl);
    expect(preparedJson).not.toContain(dataUrl);
  });

  it('uploads generated image/video URLs across poster/cover/clips fields before sync', async () => {
    const generatedPoster = '/__aitu_generated__/images/poster.png';
    const generatedPosterArray = '/__aitu_generated__/images/poster-array.png';
    const generatedCover = '/__aitu_generated__/images/cover.png';
    const generatedCoverArray = '/__aitu_generated__/images/cover-array.png';
    const generatedClip = '/__aitu_generated__/videos/clip.mp4';
    const generatedClipString = '/__aitu_generated__/clips/clip-string.mp4';
    const generatedClipPoster = '/__aitu_generated__/images/clip-poster.png';
    const generatedClipCover = '/__aitu_generated__/images/clip-cover.png';
    const payload = {
      snapshot: {
        elements: [
          {
            id: 'video-card-1',
            posterUrl: generatedPoster,
            posters: [generatedPosterArray],
            cover: generatedCover,
            covers: [generatedCoverArray],
            clips: [
              generatedClipString,
              {
                url: generatedClip,
                posterUrl: generatedClipPoster,
                cover: generatedClipCover,
              },
            ],
          },
        ],
      },
    };
    const cache = createCache();
    const upload = vi.fn(async (_blob: Blob, metadata?: { sourceUrl?: string }) =>
      `/creative/api/assets/${metadata?.sourceUrl
        ?.split('/')
        .pop()
        ?.replace(/\W+/g, '_')}/content`
    );

    const prepared = await prepareCreativeDocumentAssetsForSync(payload, {
      assetSyncEnabled: true,
      assetAdapter: { upload },
      cache,
    });

    expect(upload).toHaveBeenCalledTimes(8);
    for (const localUrl of [
      generatedPoster,
      generatedPosterArray,
      generatedCover,
      generatedCoverArray,
      generatedClipString,
      generatedClip,
      generatedClipPoster,
      generatedClipCover,
    ]) {
      expect(cache.getCachedBlob).toHaveBeenCalledWith(localUrl);
      expect(JSON.stringify(prepared)).not.toContain(localUrl);
    }
    expect(JSON.stringify(prepared)).toContain('/creative/api/assets/');
  });

  it('keeps local-only media pending when asset sync is disabled without leaking the raw URL', async () => {
    const rawLocalUrl = '/__aitu_cache__/image/private.png';
    const upload = vi.fn();

    await expect(
      prepareCreativeDocumentAssetsForSync(
        { snapshot: { elements: [{ imageUrl: rawLocalUrl }] } },
        {
          assetSyncEnabled: false,
          assetAdapter: { upload },
          cache: createCache(),
        }
      )
    ).rejects.toMatchObject({
      code: 'creative_asset_sync_disabled',
    });

    expect(upload).not.toHaveBeenCalled();
    await expect(
      prepareCreativeDocumentAssetsForSync(
        { snapshot: { elements: [{ imageUrl: rawLocalUrl }] } },
        { assetSyncEnabled: false, assetAdapter: { upload }, cache: createCache() }
      )
    ).rejects.not.toThrow(rawLocalUrl);
  });

  it('blocks signed or provider object-storage URLs before persistence with a sanitized error', async () => {
    const signedUrl =
      'https://private-bucket.s3.amazonaws.com/path/image.png?X-Amz-Credential=AKIA_TEST&X-Amz-Signature=super-secret';

    await expect(
      prepareCreativeDocumentAssetsForSync(
        { snapshot: { elements: [{ imageUrl: signedUrl }] } },
        {
          assetSyncEnabled: true,
          assetAdapter: { upload: vi.fn() },
          cache: createCache(),
        }
      )
    ).rejects.toMatchObject({
      code: 'creative_asset_unsafe_url',
    });

    await expect(
      prepareCreativeDocumentAssetsForSync(
        { snapshot: { elements: [{ imageUrl: signedUrl }] } },
        {
          assetSyncEnabled: true,
          assetAdapter: { upload: vi.fn() },
          cache: createCache(),
        }
      )
    ).rejects.not.toThrow(/AKIA_TEST|super-secret|s3\.amazonaws/i);
  });

  it('hydrates cloud asset refs into content-addressed local cache URLs without mutating the remote snapshot', async () => {
    const cloudUrl = '/creative/api/assets/asset_remote/content';
    const payload = {
      id: 'board-remote',
      snapshot: {
        elements: [{ id: 'image-1', imageUrl: cloudUrl }],
      },
    };
    const original = structuredClone(payload);
    const cache = createCache();
    const download = vi.fn(async () => new Blob(['remote'], { type: 'image/png' }));

    const hydrated = await hydrateCreativeDocumentAssets(payload, {
      assetSyncEnabled: true,
      assetAdapter: { download },
      cache,
    });

    expect(payload).toEqual(original);
    expect(download).toHaveBeenCalledWith(cloudUrl);
    expect(cache.cacheLocalMediaByContent).toHaveBeenCalledWith(
      expect.any(Blob),
      'image',
      expect.objectContaining({ creativeCloudAssetRef: cloudUrl })
    );
    expect(JSON.stringify(hydrated)).toContain('/__aitu_cache__/image/content-local.png');
    expect(JSON.stringify(hydrated)).not.toContain(cloudUrl);
  });

  it('rejects signed remote URLs during hydrate even when there are no cloud asset refs', async () => {
    const signedUrl =
      'https://private-bucket.s3.amazonaws.com/path/image.png?X-Amz-Credential=AKIA_TEST&X-Amz-Signature=super-secret';
    const download = vi.fn(async () => new Blob(['remote'], { type: 'image/png' }));

    await expect(
      hydrateCreativeDocumentAssets(
        { snapshot: { elements: [{ imageUrl: signedUrl }] } },
        {
          assetSyncEnabled: true,
          assetAdapter: { download },
          cache: createCache(),
        }
      )
    ).rejects.toMatchObject({
      code: 'creative_asset_unsafe_url',
    });

    expect(download).not.toHaveBeenCalled();
    await expect(
      hydrateCreativeDocumentAssets(
        { snapshot: { elements: [{ imageUrl: signedUrl }] } },
        {
          assetSyncEnabled: true,
          assetAdapter: { download },
          cache: createCache(),
        }
      )
    ).rejects.not.toThrow(/AKIA_TEST|super-secret|s3\.amazonaws/i);
  });

  it('recognizes only query-free same-origin creative asset content refs', () => {
    const runtimeOrigin = window.location.origin;

    expect(isCreativeAssetContentUrl('/creative/api/assets/asset_123/content')).toBe(
      true
    );
    expect(
      isCreativeAssetContentUrl(
        `${runtimeOrigin}/creative/api/assets/asset_123/content`
      )
    ).toBe(true);
    expect(isCreativeAssetContentUrl('/creative/api/assets/asset_123/content?x=1')).toBe(
      false
    );
    expect(isCreativeAssetContentUrl('//example.com/creative/api/assets/asset_123/content')).toBe(
      false
    );
    expect(isCreativeAssetContentUrl('https://evil.example/creative/api/assets/asset_123/content')).toBe(
      false
    );
  });
});

describe('CreativeAssetCloudAdapter', () => {
  afterEach(() => {
    clearCreativeSessionAuthMaterial();
    resetCreativeAssetSyncConfigForTests();
  });

  it('uploads through same-origin creative asset API without provider or Authorization headers', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-asset',
      nonce: 'nonce-asset',
    });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            asset: {
              id: 'asset_1',
              url: '/creative/api/assets/asset_1/content',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;
    const adapter = new CreativeAssetCloudAdapter(fetcher);

    await expect(
      adapter.upload(new Blob(['image-bytes'], { type: 'image/png' }), {
        mediaType: 'image',
      })
    ).resolves.toBe('/creative/api/assets/asset_1/content');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(calls[0].input).toBe('/creative/api/assets');
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Creative-CSRF')).toBe('csrf-asset');
    expect(headers.get('X-Creative-Nonce')).toBe('nonce-asset');
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('X-API-Key')).toBe(false);
    expect(JSON.stringify(calls[0].init?.headers)).not.toMatch(
      /bucket|objectkey|access.*key|secret|provider|baseurl/i
    );
  });

  it('uses an injected fetcher without rebinding it to the browser owner', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-injected-fetch',
      nonce: 'nonce-injected-fetch',
    });
    const browserOwner = typeof window !== 'undefined' ? window : globalThis;
    const fetchContexts: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>(async function (
      this: unknown,
      _input,
      _init
    ) {
      fetchContexts.push(this);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            asset: {
              id: 'asset_injected_fetch',
              url: '/creative/api/assets/asset_injected_fetch/content',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    const adapter = new CreativeAssetCloudAdapter(fetcher);

    await expect(
      adapter.upload(new Blob(['image-bytes'], { type: 'image/png' }), {
        mediaType: 'image',
      })
    ).resolves.toBe('/creative/api/assets/asset_injected_fetch/content');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetchContexts).toEqual([adapter]);
    expect(fetchContexts[0]).not.toBe(browserOwner);
  });

  it('fails unsafe asset uploads locally when session auth material is missing', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    const adapter = new CreativeAssetCloudAdapter(
      fetcher as unknown as typeof fetch
    );

    await expect(
      adapter.upload(new Blob(['image-bytes'], { type: 'image/png' }), {
        mediaType: 'image',
      })
    ).rejects.toThrow(/Creative.*CSRF.*nonce/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('binds the default browser fetcher when uploading assets', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-default-fetch-upload',
      nonce: 'nonce-default-fetch-upload',
    });
    const owner = typeof window !== 'undefined' ? window : globalThis;
    const originalGlobalFetch = globalThis.fetch;
    const originalWindowFetch =
      typeof window !== 'undefined' ? window.fetch : undefined;
    const fetchContexts: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>(async function (
      this: unknown,
      _input,
      _init
    ) {
      fetchContexts.push(this);
      if (this !== owner) {
        throw new TypeError('Illegal invocation');
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            asset: {
              id: 'asset_default_fetch_upload',
              url: '/creative/api/assets/asset_default_fetch_upload/content',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetcher,
    });
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        writable: true,
        value: fetcher,
      });
    }

    try {
      const adapter = new CreativeAssetCloudAdapter();

      await expect(
        adapter.upload(new Blob(['image-bytes'], { type: 'image/png' }), {
          mediaType: 'image',
        })
      ).resolves.toBe(
        '/creative/api/assets/asset_default_fetch_upload/content'
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetchContexts).toEqual([owner]);
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: originalGlobalFetch,
      });
      if (typeof window !== 'undefined') {
        Object.defineProperty(window, 'fetch', {
          configurable: true,
          writable: true,
          value: originalWindowFetch,
        });
      }
    }
  });

  it('binds the default browser fetcher when downloading assets', async () => {
    const owner = typeof window !== 'undefined' ? window : globalThis;
    const originalGlobalFetch = globalThis.fetch;
    const originalWindowFetch =
      typeof window !== 'undefined' ? window.fetch : undefined;
    const fetchContexts: unknown[] = [];
    const fetcher = vi.fn<typeof fetch>(async function (
      this: unknown,
      _input,
      _init
    ) {
      fetchContexts.push(this);
      if (this !== owner) {
        throw new TypeError('Illegal invocation');
      }
      return new Response('asset-bytes', {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetcher,
    });
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        writable: true,
        value: fetcher,
      });
    }

    try {
      const adapter = new CreativeAssetCloudAdapter();

      const blob = await adapter.download(
        '/creative/api/assets/asset_default_fetch_download/content'
      );
      await expect(blob.text()).resolves.toBe('asset-bytes');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetchContexts).toEqual([owner]);
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: originalGlobalFetch,
      });
      if (typeof window !== 'undefined') {
        Object.defineProperty(window, 'fetch', {
          configurable: true,
          writable: true,
          value: originalWindowFetch,
        });
      }
    }
  });
});
