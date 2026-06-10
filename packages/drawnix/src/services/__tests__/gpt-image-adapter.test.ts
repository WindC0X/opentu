import { describe, expect, it, vi } from 'vitest';
import {
  buildGPTImageEditFormData,
  buildGPTImageGenerationBody,
  gptImageAdapter,
  parseGPTImageResponse,
} from '../model-adapters/gpt-image-adapter';

const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const tinyPngBase64Only =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;
type FetchCall = Parameters<typeof fetch>;

function getFetchCall(fetcher: FetchMock, index = 0): FetchCall {
  const call = fetcher.mock.calls[index];
  if (!call) {
    throw new Error(`Expected fetch call #${index + 1}`);
  }
  return call;
}

describe('gpt-image-adapter', () => {
  it('builds official GPT Image generation JSON with url response_format by default', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '16x9',
      params: {
        resolution: '2k',
        quality: 'high',
        output_format: 'webp',
        output_compression: 80,
        response_format: 'url',
        n: 2,
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      response_format: 'url',
      size: '2736x1536',
      quality: 'high',
      output_format: 'webp',
      output_compression: 80,
      n: 2,
    });
  });

  it('treats legacy 1K/2K/4K quality values as resolution compatibility hints', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '4x3',
      params: {
        quality: '2k',
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      response_format: 'url',
      size: '2368x1776',
    });
  });

  it('normalizes invalid GPT Image pixel sizes back to a supported mapped size', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      size: '800x600',
      params: {
        resolution: '2k',
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      response_format: 'url',
      size: '2368x1776',
    });
  });

  it('keeps legacy GPT Image models on official standard sizes only', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-1',
      prompt: 'Draw a clean product photo',
      size: '16x9',
      params: {
        resolution: '4k',
        quality: 'high',
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-1',
      prompt: 'Draw a clean product photo',
      response_format: 'url',
      size: '1536x1024',
      quality: 'high',
    });
  });

  it('preserves explicit b64_json response_format for GPT Image generation', () => {
    const body = buildGPTImageGenerationBody({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      params: {
        response_format: 'b64_json',
      },
    });

    expect(body).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      response_format: 'b64_json',
    });
  });

  it('builds official GPT Image edit form data with image files', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'Change the style',
      size: '1x1',
      referenceImages: [tinyPngDataUrl],
      maskImage: tinyPngDataUrl,
      inputFidelity: 'high',
      background: 'transparent',
      outputFormat: 'png',
      outputCompression: 80,
      params: {
        response_format: 'url',
      },
    });

    expect(body.get('model')).toBe('gpt-image-2');
    expect(body.get('prompt')).toBe('Change the style');
    expect(body.get('response_format')).toBe('url');
    expect(body.get('input_fidelity')).toBe('high');
    expect(body.get('size')).toBe('1024x1024');
    expect(body.get('output_format')).toBe('png');
    expect(body.get('output_compression')).toBe('80');
    expect(body.get('background')).toBe('transparent');
    expect(body.getAll('image[]')).toHaveLength(1);
    expect(body.get('image[]')).toBeInstanceOf(Blob);
    expect(body.get('mask')).toBeInstanceOf(Blob);
  });

  it('defaults official GPT Image edit form data response_format to url', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'Change the style',
      referenceImages: [tinyPngDataUrl],
      generationMode: 'image_edit',
    });

    expect(body.get('response_format')).toBe('url');
  });

  it('accepts params.mask_image as a compatible edit mask input', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'Change the style',
      referenceImages: [tinyPngDataUrl],
      generationMode: 'image_edit',
      params: {
        mask_image: tinyPngDataUrl,
      },
    });

    expect(body.getAll('image[]')).toHaveLength(1);
    expect(body.get('image[]')).toBeInstanceOf(Blob);
    expect(body.get('mask')).toBeInstanceOf(Blob);
  });

  it('maps GPT Image 2 edit requests through resolution tiers', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-2',
      prompt: 'Change the style',
      size: '800x600',
      referenceImages: [tinyPngDataUrl],
      params: {
        resolution: '4k',
      },
    });

    expect(body.get('size')).toBe('3312x2480');
  });

  it('keeps legacy GPT Image edit requests on standard edit sizes', async () => {
    const body = await buildGPTImageEditFormData({
      model: 'gpt-image-1',
      prompt: 'Change the style',
      size: '16x9',
      referenceImages: [tinyPngDataUrl],
      params: {
        resolution: '4k',
      },
    });

    expect(body.get('size')).toBe('1536x1024');
  });

  it('fetches remote image and mask URLs for edit form data', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const type = url.endsWith('.webp') ? 'image/webp' : 'image/png';
      return new Response(new Blob(['ok'], { type }), { status: 200 });
    });

    const body = await buildGPTImageEditFormData(
      {
        model: 'gpt-image-2',
        prompt: 'Change the style',
        size: '16x9',
        referenceImages: ['https://example.com/source.webp'],
        maskImage: 'https://example.com/mask.png',
      },
      fetcher as unknown as typeof fetch
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://example.com/source.webp'
    );
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://example.com/mask.png');
    expect(body.get('size')).toBe('1360x768');
    expect(body.get('image[]')).toBeInstanceOf(Blob);
    expect(body.get('mask')).toBeInstanceOf(Blob);
  });

  it('accepts bare base64 image inputs without fetching', async () => {
    const fetcher = vi.fn();

    const body = await buildGPTImageEditFormData(
      {
        model: 'gpt-image-2',
        prompt: 'Change the style',
        referenceImages: [tinyPngBase64Only],
      },
      fetcher as unknown as typeof fetch
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(body.get('image[]')).toBeInstanceOf(Blob);
  });

  it('surfaces remote image fetch failures for edit form data', async () => {
    const fetcher = vi.fn(async () => {
      return new Response('missing', {
        status: 404,
        statusText: 'Not Found',
      });
    });

    await expect(
      buildGPTImageEditFormData(
        {
          model: 'gpt-image-2',
          prompt: 'Change the style',
          referenceImages: ['https://example.com/missing.png'],
        },
        fetcher as unknown as typeof fetch
      )
    ).rejects.toThrow('GPT Image 编辑图片读取失败: 404 Not Found');
  });

  it('requires reference images for official GPT Image edit form data', async () => {
    await expect(
      buildGPTImageEditFormData({
        model: 'gpt-image-2',
        prompt: 'Change the style',
      })
    ).rejects.toThrow('GPT Image 编辑请求缺少参考图片');
  });

  it('parses GPT Image b64_json results into data URLs', () => {
    const result = parseGPTImageResponse(
      {
        output_format: 'png',
        data: [
          {
            b64_json:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
        ],
      },
      'png'
    );

    expect(result.url).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    );
    expect(result.format).toBe('png');
  });

  it('accepts gateway URL results for compatibility', () => {
    const result = parseGPTImageResponse({
      data: [
        {
          url: 'https://example.com/image.webp',
        },
      ],
    });

    expect(result.url).toBe('https://example.com/image.webp');
    expect(result.format).toBe('webp');
  });

  it('sends official GPT Image requests through provider transport', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    await gptImageAdapter.generateImage(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret-key',
        authType: 'bearer',
        fetcher,
        binding: {
          id: 'binding',
          profileId: 'openai',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'openai.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: 320,
          confidence: 'high',
          source: 'template',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Draw a clean product photo',
        size: '1x1',
        params: {
          response_format: 'url',
        },
      }
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = getFetchCall(fetcher);
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-image-2',
      prompt: 'Draw a clean product photo',
      response_format: 'url',
      size: '1024x1024',
    });
  });

  it('sends official GPT Image edit requests to the edits endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          output_format: 'png',
          data: [
            {
              b64_json:
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    await gptImageAdapter.generateImage(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret-key',
        authType: 'bearer',
        fetcher,
        binding: {
          id: 'binding',
          profileId: 'openai',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.edits',
          requestSchema: 'openai.image.gpt-edit-form',
          responseSchema: 'openai.image.data',
          submitPath: '/images/edits',
          priority: 319,
          confidence: 'high',
          source: 'template',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Change the style',
        size: '1x1',
        referenceImages: [tinyPngDataUrl],
        generationMode: 'image_edit',
        maskImage: tinyPngDataUrl,
      }
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = getFetchCall(fetcher);
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret-key',
    });
    expect(
      (init?.headers as Record<string, string>)['Content-Type']
    ).toBeUndefined();
    expect(init?.body).toBeInstanceOf(FormData);
    const formData = init?.body as FormData;
    expect(formData.get('model')).toBe('gpt-image-2');
    expect(formData.get('prompt')).toBe('Change the style');
    expect(formData.get('response_format')).toBe('url');
    expect(formData.get('size')).toBe('1024x1024');
    expect(formData.getAll('image[]')).toHaveLength(1);
    expect(formData.get('image[]')).toBeInstanceOf(Blob);
    expect(formData.get('mask')).toBeInstanceOf(Blob);
  });

  it('keeps edit mode on the edits endpoint even with a generation binding fallback', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              url: 'https://example.com/out.png',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    await gptImageAdapter.generateImage(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret-key',
        authType: 'bearer',
        fetcher,
        binding: {
          id: 'binding',
          profileId: 'openai',
          modelId: 'gpt-image-2',
          operation: 'image',
          protocol: 'openai.images.generations',
          requestSchema: 'openai.image.gpt-generation-json',
          responseSchema: 'openai.image.data',
          submitPath: '/images/generations',
          priority: 320,
          confidence: 'high',
          source: 'template',
        },
      },
      {
        model: 'gpt-image-2',
        prompt: 'Change the style',
        referenceImages: [tinyPngDataUrl],
        generationMode: 'image_to_image',
      }
    );

    const [url] = getFetchCall(fetcher);
    expect(url).toBe('https://api.openai.com/v1/images/edits');
  });
});
