import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateImageAsync,
  generateImageSync,
  resumeAsyncImagePolling,
  submitVideoGeneration,
  queryVideoStatus,
  generateVideo,
} from '../media-api';
import {
  clearCreativeSessionAuthMaterial,
  setCreativeSessionAuthMaterial,
} from '../creative-mode';

describe('media-api provider routing', () => {
  afterEach(() => {
    clearCreativeSessionAuthMaterial();
  });
  it('uses header auth and extra headers for sync image generation', async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          'https://api.example.com/v1/images/generations'
        );
        const headers = init?.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['X-API-Key']).toBe('secret');
        expect(headers['X-Trace-Id']).toBe('trace-1');

        return new Response(
          JSON.stringify({
            data: [{ url: 'https://cdn.example.com/image.png' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    );

    const result = await generateImageSync(
      {
        prompt: 'test prompt',
        model: 'gemini-3-pro-image-preview',
      },
      {
        apiKey: 'secret',
        baseUrl: 'https://api.example.com/v1',
        authType: 'header',
        extraHeaders: {
          'X-Trace-Id': 'trace-1',
        },
        fetchImpl,
      }
    );

    expect(result.url).toBe('https://cdn.example.com/image.png');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses query auth for async image polling endpoints', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'https://gateway.example.com/v1/videos/task-1?key=secret'
      );

      return new Response(
        JSON.stringify({
          id: 'task-1',
          status: 'completed',
          url: 'https://cdn.example.com/final.png',
          progress: 100,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const result = await resumeAsyncImagePolling('task-1', {
      apiKey: 'secret',
      baseUrl: 'https://gateway.example.com/v1',
      providerType: 'gemini-compatible',
      authType: 'query',
      fetchImpl,
    });

    expect(result.url).toBe('https://cdn.example.com/final.png');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('submits async image reference images and mask to /v1/videos form data', async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === 'data:image/png;base64,abc123') {
          return new Response(new Blob(['ref'], { type: 'image/png' }), {
            status: 200,
          });
        }
        if (String(input) === 'data:image/png;base64,mask123') {
          return new Response(new Blob(['mask'], { type: 'image/png' }), {
            status: 200,
          });
        }

        if (String(input) === 'https://gateway.example.com/v1/videos') {
          expect(init?.body).toBeInstanceOf(FormData);
          const formData = init?.body as FormData;
          expect(formData.get('model')).toBe('gpt-image-2');
          expect(formData.get('prompt')).toBe('edit with reference');
          expect(formData.get('size')).toBe('1:1');
          expect(formData.get('input_reference')).toBeInstanceOf(Blob);
          expect(formData.get('mask')).toBeInstanceOf(Blob);

          return new Response(
            JSON.stringify({
              id: 'task-1',
              status: 'completed',
              progress: 100,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        expect(String(input)).toBe(
          'https://gateway.example.com/v1/videos/task-1'
        );
        return new Response(
          JSON.stringify({
            id: 'task-1',
            status: 'completed',
            url: 'https://cdn.example.com/final.png',
            progress: 100,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    );

    const result = await generateImageAsync(
      {
        prompt: 'edit with reference',
        model: 'gpt-image-2',
        size: '1:1',
        referenceImages: ['data:image/png;base64,abc123'],
        maskImage: 'data:image/png;base64,mask123',
      },
      {
        apiKey: 'secret',
        baseUrl: 'https://gateway.example.com/v1',
        authType: 'bearer',
        fetchImpl,
      },
      {
        interval: 1,
        maxAttempts: 1,
      }
    );

    expect(result.url).toBe('https://cdn.example.com/final.png');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('uses session-broker routing for shared video submission without direct credentials', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-shared-video',
      nonce: 'nonce-shared-video',
    });
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('/creative/relay/v1/videos');
        const headers = init?.headers as Record<string, string>;
        expect(headers['X-Creative-CSRF']).toBe('csrf-shared-video');
        expect(headers['X-Creative-Nonce']).toBe('nonce-shared-video');
        expect(headers['Idempotency-Key']).toBe('shared-video-action-1');
        expect(headers.Authorization).toBeUndefined();
        expect(headers['X-API-Key']).toBeUndefined();
        expect(init?.credentials).toBe('same-origin');
        expect(init?.method).toBe('POST');
        expect(init?.body).toBeInstanceOf(FormData);
        expect(String(input)).not.toContain('video-secret');

        return new Response(
          JSON.stringify({
            id: 'task-shared-video-1',
            status: 'queued',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    );

    const remoteId = await submitVideoGeneration(
      {
        prompt: 'make a managed video',
        model: 'veo3',
        idempotencyKey: 'shared-video-action-1',
      },
      {
        apiKey: 'video-secret',
        baseUrl: '/creative/relay/v1',
        authType: 'session-broker',
        extraHeaders: {
          Authorization: 'Bearer video-secret',
          'X-API-Key': 'video-secret',
        },
        fetchImpl,
      }
    );

    expect(remoteId).toBe('task-shared-video-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reuses explicit idempotency keys across repeated shared session-broker video submits', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-repeat-video',
      nonce: 'nonce-repeat-video',
    });
    const seenIdempotencyKeys: string[] = [];
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        seenIdempotencyKeys.push(headers['Idempotency-Key']);
        return new Response(
          JSON.stringify({
            id: 'task-repeat-video',
            status: 'queued',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    );

    const config = {
      apiKey: '',
      baseUrl: '/creative/relay/v1',
      authType: 'session-broker' as const,
      fetchImpl,
    };
    const params = {
      prompt: 'repeat a managed video submit',
      model: 'veo3',
      idempotencyKey: 'shared-video-action-repeat',
    };

    await submitVideoGeneration(params, config);
    await submitVideoGeneration(params, config);

    expect(seenIdempotencyKeys).toEqual([
      'shared-video-action-repeat',
      'shared-video-action-repeat',
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects shared session-broker video submit without a stable idempotency key before fetch', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-shared-video',
      nonce: 'nonce-shared-video',
    });
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      submitVideoGeneration(
        {
          prompt: 'make a managed video',
          model: 'veo3',
          referenceImages: ['data:image/png;base64,reference-before-idem'],
        },
        {
          apiKey: '',
          baseUrl: '/creative/relay/v1',
          authType: 'session-broker',
          fetchImpl,
        }
      )
    ).rejects.toThrow(/idempotency/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sanitizes non-unsupported shared session-broker video submit errors without exposing raw bodies', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-shared-video',
      nonce: 'nonce-shared-video',
    });
    const fetchImpl = vi.fn(async () =>
      new Response(
        'Authorization Bearer secret apiKey upstream credential leak',
        { status: 500 }
      )
    );

    let caught: unknown;
    try {
      await submitVideoGeneration(
        {
          prompt: 'make an unsupported managed video',
          model: 'veo3',
          idempotencyKey: 'shared-video-submit-error',
        },
        {
          apiKey: 'video-secret',
          baseUrl: '/creative/relay/v1',
          authType: 'session-broker',
          fetchImpl,
        }
      );
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe('Video submission failed: 500');
    expect((caught as any).apiErrorBody).toBe('creative video relay status 500');
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sanitizes unsupported shared session-broker video submit responses without exposing raw bodies', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-shared-video',
      nonce: 'nonce-shared-video',
    });
    const fetchImpl = vi.fn(async () =>
      new Response(
        'unsupported Authorization Bearer secret apiKey upstream credential leak',
        { status: 501 }
      )
    );

    let caught: unknown;
    try {
      await submitVideoGeneration(
        {
          prompt: 'make an unsupported managed video',
          model: 'veo3',
          idempotencyKey: 'shared-video-submit-unsupported',
        },
        {
          apiKey: 'video-secret',
          baseUrl: '/creative/relay/v1',
          authType: 'session-broker',
          fetchImpl,
        }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      unsupportedCreativeVideo: true,
      httpStatus: 501,
    });
    expect((caught as Error).message).toMatch(/暂不支持嵌入式视频生成/);
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects direct shared video submission without an API key before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      submitVideoGeneration(
        {
          prompt: 'make a direct video without key',
          model: 'veo3',
        },
        {
          apiKey: '',
          baseUrl: 'https://video.example.com/v1',
          authType: 'bearer',
          fetchImpl,
        }
      )
    ).rejects.toThrow(/API Key 未配置/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails unsupported shared session-broker video status without direct fallback', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-shared-video',
      nonce: 'nonce-shared-video',
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/creative/relay/v1/videos/task-unsupported');
      return new Response('unsupported', { status: 501 });
    });

    await expect(
      queryVideoStatus('task-unsupported', {
        apiKey: 'video-secret',
        baseUrl: '/creative/relay/v1',
        authType: 'session-broker',
        fetchImpl,
      })
    ).rejects.toThrow(/暂不支持嵌入式视频生成/);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sanitizes non-unsupported shared session-broker video content download errors without exposing raw bodies', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-shared-video',
      nonce: 'nonce-shared-video',
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/creative/relay/v1/videos') {
        return new Response(
          JSON.stringify({ id: 'task-content-error', status: 'queued' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      if (url === '/creative/relay/v1/videos/task-content-error') {
        return new Response(
          JSON.stringify({
            id: 'task-content-error',
            status: 'completed',
            progress: 100,
            model: 'veo3',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      if (url === '/creative/relay/v1/videos/task-content-error/content') {
        return new Response(
          'Authorization Bearer secret apiKey upstream credential leak',
          { status: 500 }
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    let caught: unknown;
    try {
      await generateVideo(
        {
          prompt: 'make a managed video',
          model: 'veo3',
          idempotencyKey: 'shared-video-content-error',
        },
        {
          apiKey: '',
          baseUrl: '/creative/relay/v1',
          authType: 'session-broker',
          fetchImpl,
        },
        {
          interval: 1,
        }
      );
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe('视频内容下载失败: 500');
    expect((caught as any).apiErrorBody).toBe('creative video relay status 500');
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('uses bearer auth for shared video submission', async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('https://video.example.com/v1/videos');
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer video-secret');
        expect(init?.method).toBe('POST');
        expect(init?.body).toBeInstanceOf(FormData);

        return new Response(
          JSON.stringify({
            id: 'video-task-1',
            status: 'queued',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    );

    const remoteId = await submitVideoGeneration(
      {
        prompt: 'make a video',
        model: 'veo3',
      },
      {
        apiKey: 'video-secret',
        baseUrl: 'https://video.example.com/v1',
        authType: 'bearer',
        fetchImpl,
      }
    );

    expect(remoteId).toBe('video-task-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
