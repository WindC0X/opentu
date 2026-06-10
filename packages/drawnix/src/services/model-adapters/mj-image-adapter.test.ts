import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCreativeSessionAuthMaterial,
  setCreativeSessionAuthMaterial,
} from '../creative-mode';
import { mjImageAdapter } from './mj-image-adapter';
import type { AdapterContext } from './types';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;
type FetchCall = Parameters<typeof fetch>;

function getFetchCall(fetcher: FetchMock, index = 0): FetchCall {
  const call = fetcher.mock.calls[index];
  if (!call) {
    throw new Error(`Expected fetch call #${index + 1}`);
  }
  return call;
}

function createSessionBrokerContext(fetcher: FetchMock): AdapterContext {
  return {
    baseUrl: '/creative/relay/v1',
    apiKey: '',
    authType: 'session-broker',
    extraHeaders: {
      Authorization: 'Bearer upstream-header-leak',
      'X-API-Key': 'upstream-api-key-leak',
      'X-Provider': 'provider-header-leak',
      'X-Channel-Id': 'channel-header-leak',
      'X-Group': 'group-header-leak',
      'X-Base-URL': 'base-url-header-leak',
      'X-Model': 'model-header-leak',
      'X-Selected-Key': 'selected-key-header-leak',
      'X-Notify-Hook': 'notify-hook-header-leak',
      'X-Safe-Trace': 'trace-ok',
    },
    fetcher,
  };
}

describe('mjImageAdapter session-broker relay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-mj',
      nonce: 'nonce-mj',
    });
  });

  afterEach(() => {
    clearCreativeSessionAuthMaterial();
    vi.useRealTimers();
  });

  it('uses canonical /creative/relay/v1 MJ submit and fetch with stable idempotency and no credential leakage', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 1,
            description: 'submitted',
            result: 'creative-mj-task-1',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'SUCCESS',
            progress: '100%',
            imageUrl: 'https://cdn.example.com/creative-mj-task-1.jpg',
            imageUrls: [
              { url: 'https://cdn.example.com/creative-mj-task-1.jpg' },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    const promise = mjImageAdapter.generateImage(
      createSessionBrokerContext(fetchMock),
      {
        prompt: 'prompt-secret-must-not-enter-idempotency',
        model: 'model-body-leak',
        referenceImages: ['data:image/png;base64,cmVm'],
        params: {
          idempotencyKey: 'opentu-image-local-image-task-1',
          apiKey: 'body-api-key-leak',
          baseUrl: 'body-base-url-leak',
          provider: 'body-provider-leak',
          channel: 'body-channel-leak',
          group: 'body-group-leak',
          model: 'body-model-leak',
          selectedKey: 'body-selected-key-leak',
          notifyHook: 'body-notify-hook-leak',
        },
      }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result.url).toBe('https://cdn.example.com/creative-mj-task-1.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [submitInput, submitInit] = getFetchCall(fetchMock, 0);
    expect(String(submitInput)).toBe(
      '/creative/relay/v1/mj/submit/imagine'
    );
    expect(submitInit?.method).toBe('POST');
    expect(submitInit?.credentials).toBe('same-origin');
    const submitHeaders = submitInit?.headers as Record<string, string>;
    expect(submitHeaders['Content-Type']).toBe('application/json');
    expect(submitHeaders['Idempotency-Key']).toBe(
      'opentu-image-local-image-task-1'
    );
    expect(submitHeaders['Idempotency-Key']).not.toContain('prompt-secret');
    expect(submitHeaders['X-Creative-CSRF']).toBe('csrf-mj');
    expect(submitHeaders['X-Creative-Nonce']).toBe('nonce-mj');
    expect(submitHeaders['X-Safe-Trace']).toBe('trace-ok');

    const submitBody = JSON.parse(submitInit?.body as string);
    expect(submitBody).toEqual({
      botType: 'MID_JOURNEY',
      prompt: 'prompt-secret-must-not-enter-idempotency',
      base64Array: ['cmVm'],
    });

    const [fetchInput, fetchInit] = getFetchCall(fetchMock, 1);
    expect(String(fetchInput)).toBe(
      '/creative/relay/v1/mj/task/creative-mj-task-1/fetch'
    );
    expect(fetchInit?.method).toBe('GET');
    expect(fetchInit?.credentials).toBe('same-origin');

    expect(JSON.stringify([submitInput, fetchInput, submitInit, fetchInit]))
      .not.toMatch(
        /upstream|apiKey|api-key|Authorization|provider|channel|group|baseUrl|base-url|model-leak|selected-key|selectedKey|notify-hook|notifyHook|body-.*-leak/i
      );
  });

  it('sanitizes unsupported session-broker MJ submit errors without exposing backend bodies', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        'unsupported Authorization Bearer secret apiKey upstream credential leak',
        { status: 501 }
      )
    );

    let caught: unknown;
    try {
      await mjImageAdapter.generateImage(createSessionBrokerContext(fetchMock), {
        prompt: 'draw a cat',
        params: { idempotencyKey: 'opentu-image-local-submit-unsupported' },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'unsupported-backend',
      httpStatus: 501,
    });
    expect((caught as Error).message).toMatch(/暂不支持嵌入式 MJ/);
    expect((caught as Error).message).not.toMatch(
      /Authorization|apiKey|upstream|credential|secret/i
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input] = getFetchCall(fetchMock);
    expect(String(input)).toBe('/creative/relay/v1/mj/submit/imagine');
  });

  it('sanitizes unsupported session-broker MJ fetch errors without retrying direct providers', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 1,
            description: 'submitted',
            result: 'unsupported-mj-task-1',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          'unsupported Authorization Bearer secret apiKey upstream credential leak',
          { status: 404 }
        )
      );

    const promise = mjImageAdapter.generateImage(
      createSessionBrokerContext(fetchMock),
      {
        prompt: 'draw a cat',
        params: { idempotencyKey: 'opentu-image-local-fetch-unsupported' },
      }
    ).catch((error) => error);

    await vi.advanceTimersByTimeAsync(5000);

    const caught = await promise;

    expect(caught).toMatchObject({
      code: 'unsupported-backend',
      httpStatus: 404,
    });
    expect((caught as Error).message).toMatch(/暂不支持嵌入式 MJ/);
    expect((caught as Error).message).not.toMatch(
      /Authorization|apiKey|upstream|credential|secret/i
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [submitInput] = getFetchCall(fetchMock, 0);
    const [fetchInput] = getFetchCall(fetchMock, 1);
    expect(String(submitInput)).toBe('/creative/relay/v1/mj/submit/imagine');
    expect(String(fetchInput)).toBe(
      '/creative/relay/v1/mj/task/unsupported-mj-task-1/fetch'
    );
  });

  it('rejects direct MJ providers without an API key before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      mjImageAdapter.generateImage(
        {
          baseUrl: 'https://api.tu-zi.com/v1',
          apiKey: '',
          authType: 'bearer',
          fetcher: fetchMock,
        },
        {
          prompt: 'draw a cat',
        }
      )
    ).rejects.toThrow(/API Key 未配置/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
