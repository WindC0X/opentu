import { describe, expect, it } from 'vitest';

import { GrsaiImageProviderAdapter } from './grsai-adapter';
import type { ImageProviderExecutionInput } from './types';

describe('GrsaiImageProviderAdapter', () => {
  it('executes async generation with fake fetch and never exposes the credential in snapshots', async () => {
    const calls: Array<{ body?: unknown; headers?: HeadersInit; url: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: init?.headers,
        url,
      });
      if (url.endsWith('/v1/api/generate')) {
        return jsonResponse({ id: 'grsai-task-1', status: 'running' });
      }
      if (url.includes('/v1/api/result')) {
        return jsonResponse({
          status: 'succeeded',
          urls: ['https://cdn.example.test/generated.png'],
        });
      }
      if (url === 'https://cdn.example.test/generated.png') {
        return new Response(tinyPng(), {
          headers: { 'content-type': 'image/png' },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const adapter = new GrsaiImageProviderAdapter({
      baseUrl: 'https://fake-grsai.example',
      fetchImpl,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });
    const result = await adapter.execute(
      createExecutionInput({ credentialSecret: 'secret-token' })
    );

    expect(result).toMatchObject({
      failureCount: 0,
      providerRequestId: 'grsai-task-1',
      status: 'succeeded',
      successCount: 1,
    });
    expect(result.images).toEqual([
      expect.objectContaining({ candidateIndex: 0, mimeType: 'image/png' }),
    ]);
    expect(calls[0]?.headers).toMatchObject({
      authorization: 'Bearer secret-token',
    });
    expect(calls[0]?.body).toMatchObject({
      aspectRatio: '1024x1024',
      images: [],
      model: 'gpt-image-2-vip',
      prompt: 'generate a test image',
      quality: 'auto',
      replyType: 'async',
    });
    expect(JSON.stringify(result.responseSnapshot)).not.toContain(
      'secret-token'
    );
  });

  it('normalizes provider violation into a failed result', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/api/generate')) {
        return jsonResponse({ id: 'grsai-task-2', status: 'running' });
      }
      return jsonResponse({
        error: { message: 'Bearer secret-token blocked by policy' },
        status: 'violation',
      });
    };
    const adapter = new GrsaiImageProviderAdapter({
      baseUrl: 'https://fake-grsai.example',
      fetchImpl,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    const result = await adapter.execute(
      createExecutionInput({ batchSize: 2, credentialSecret: 'secret-token' })
    );

    expect(result).toMatchObject({
      failureCount: 2,
      rawErrorCode: 'PROVIDER_VIOLATION',
      status: 'failed',
      successCount: 0,
    });
    expect(result.rawErrorMessage).not.toContain('secret-token');
    expect(JSON.stringify(result.responseSnapshot)).not.toContain(
      'secret-token'
    );
  });

  it('can defer a transient provider terminal status until success', async () => {
    let resultPolls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/api/generate')) {
        return jsonResponse({ id: 'grsai-task-3', status: 'running' });
      }
      if (url.includes('/v1/api/result')) {
        resultPolls += 1;
        if (resultPolls === 1) {
          return jsonResponse({
            error: { message: 'temporary provider state' },
            status: 'violation',
          });
        }
        return jsonResponse({
          status: 'succeeded',
          urls: ['https://cdn.example.test/generated.png'],
        });
      }
      if (url === 'https://cdn.example.test/generated.png') {
        return new Response(tinyPng(), {
          headers: { 'content-type': 'image/png' },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const adapter = new GrsaiImageProviderAdapter({
      baseUrl: 'https://fake-grsai.example',
      deferTerminalStatusUntilTimeout: true,
      fetchImpl,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    const result = await adapter.execute(
      createExecutionInput({ credentialSecret: 'secret-token' })
    );

    expect(result).toMatchObject({
      failureCount: 0,
      providerRequestId: 'grsai-task-3',
      status: 'succeeded',
      successCount: 1,
    });
    expect(resultPolls).toBe(2);
  });

  it('can defer succeeded results until an image URL is available', async () => {
    let resultPolls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/api/generate')) {
        return jsonResponse({ id: 'grsai-task-4', status: 'running' });
      }
      if (url.includes('/v1/api/result')) {
        resultPolls += 1;
        if (resultPolls === 1) {
          return jsonResponse({ status: 'succeeded' });
        }
        return jsonResponse({
          status: 'succeeded',
          urls: ['https://cdn.example.test/generated.png'],
        });
      }
      if (url === 'https://cdn.example.test/generated.png') {
        return new Response(tinyPng(), {
          headers: { 'content-type': 'image/png' },
          status: 200,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const adapter = new GrsaiImageProviderAdapter({
      baseUrl: 'https://fake-grsai.example',
      deferTerminalStatusUntilTimeout: true,
      fetchImpl,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    const result = await adapter.execute(
      createExecutionInput({ credentialSecret: 'secret-token' })
    );

    expect(result).toMatchObject({
      failureCount: 0,
      providerRequestId: 'grsai-task-4',
      status: 'succeeded',
      successCount: 1,
    });
    expect(resultPolls).toBe(2);
  });
});

function createExecutionInput(input: {
  batchSize?: 1 | 2 | 4;
  credentialSecret: string | null;
}): ImageProviderExecutionInput {
  const batchSize = input.batchSize ?? 1;
  return {
    credentialSecret: input.credentialSecret,
    input: {
      batchSize,
      idempotencyKey: 'grsai-test',
      modelKey: 'grsai-gpt-image-2-vip',
      operationType: 'text_to_image',
      prompt: 'generate a test image',
      projectId: 'project-1',
      ratio: '1:1',
    },
    maskImage: null,
    model: {
      capabilities: [],
      credential: {
        credentialKind: 'api_key',
        id: 'credential-1',
        lastRotatedAt: new Date('2026-05-29T00:00:00.000Z'),
        maskedValue: '********oken',
        rotatedByAdminId: 'admin-1',
      },
      displayName: 'GrsAI GPT Image 2 VIP',
      modelFamily: 'gpt-image',
      modelKey: 'grsai-gpt-image-2-vip',
      modelVersion: 'gpt-image-2-vip',
      price: {
        amount: 10,
        policyId: 'price-1',
        unit: 'per_image',
        version: 1,
      },
      providerConfigId: 'provider-1',
      providerKey: 'grsai',
      providerModelId: 'gpt-image-2-vip',
    },
    referenceImages: [],
    sourceImage: null,
    task: {
      actualModelKey: null,
      actualProvider: null,
      batchSize,
      canvasSyncStatus: 'pending',
      createdAt: new Date('2026-05-29T00:00:00.000Z'),
      failureCode: null,
      failureCount: 0,
      failureMessage: null,
      finalPrompt: 'generate a test image',
      id: 'task-1',
      idempotencyKey: 'grsai-test',
      modelFamily: 'gpt-image',
      modelVersion: 'gpt-image-2-vip',
      normalizedParams: {},
      operationType: 'text_to_image',
      optimizedPrompt: null,
      ownerUserId: 'user-1',
      parentTaskId: null,
      pricePolicyId: 'price-1',
      priceVersion: 1,
      projectId: 'project-1',
      providerUsageId: null,
      quotaHoldLedgerId: 'hold-1',
      quotedPriceAmount: 10 * batchSize,
      quotedPriceUnit: 'points',
      ratio: '1:1',
      rawProviderParams: {},
      requestedModelKey: 'grsai-gpt-image-2-vip',
      requestedProvider: 'grsai',
      settledAt: null,
      settledPriceAmount: null,
      status: 'running',
      successCount: 0,
      tenantId: 'tenant-1',
      updatedAt: new Date('2026-05-29T00:00:00.000Z'),
      userPrompt: 'generate a test image',
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
}
