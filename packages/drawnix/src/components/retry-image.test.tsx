// @vitest-environment jsdom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCachedBlob: vi.fn(),
  cacheMediaFromBlob: vi.fn(),
}));

vi.mock('@aitu/utils', () => ({
  normalizeImageDataUrl: (value: string) => value,
}));

vi.mock('../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
  },
}));

import { RetryImage } from './retry-image';

describe('RetryImage', () => {
  beforeEach(() => {
    mocks.getCachedBlob.mockReset();
    mocks.cacheMediaFromBlob.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('关闭 skeleton 时加载中的图片保持可见', () => {
    render(
      <RetryImage
        src="https://example.com/preview.png"
        alt="结果预览"
        showSkeleton={false}
      />
    );

    expect(screen.getByAltText('结果预览')).toHaveProperty(
      'style.opacity',
      '1'
    );
  });

  it('开启 skeleton 时图片加载完成后再淡入', () => {
    render(<RetryImage src="https://example.com/preview.png" alt="结果预览" />);

    const image = screen.getByAltText('结果预览');
    expect(image).toHaveProperty('style.opacity', '0');

    fireEvent.load(image);

    expect(image).toHaveProperty('style.opacity', '1');
  });

  it('reports every native image error before final load failure', () => {
    const onAttemptError = vi.fn();
    const onFinalError = vi.fn();
    render(
      <RetryImage
        src="/__aitu_cache__/image/missing.png"
        alt="缺失图片"
        showSkeleton={false}
        initialRetryDelay={60_000}
        maxRetries={2}
        onAttemptError={onAttemptError}
        onError={onFinalError}
      />
    );

    fireEvent.error(screen.getByAltText('缺失图片'));

    expect(onAttemptError).toHaveBeenCalledTimes(1);
    expect(onFinalError).not.toHaveBeenCalled();
  });

  it('rehydrates a generated cache image from broker content when local Cache Storage misses', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    mocks.getCachedBlob.mockResolvedValue(null);
    mocks.cacheMediaFromBlob.mockResolvedValue(
      '/__aitu_cache__/image/task-1.png'
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(blob, { status: 200 }))
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:rehydrated'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    render(
      <RetryImage
        src="/__aitu_cache__/image/task-1.png?thumbnail=small"
        rehydrateCacheUrl="/__aitu_cache__/image/task-1.png"
        rehydrateSourceUrl="/creative/relay/v1/images/tasks/remote-1/content"
        rehydrateMetadata={{ taskId: 'task-1' }}
        alt="结果预览"
      />
    );

    await waitFor(() => {
      expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
        '/__aitu_cache__/image/task-1.png',
        expect.anything(),
        'image',
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskId: 'task-1',
            contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
          }),
        })
      );
    });
  });

  it('derives generated content URL from remoteTaskId metadata when contentUrl is missing', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    mocks.getCachedBlob.mockResolvedValue(null);
    mocks.cacheMediaFromBlob.mockResolvedValue(
      '/__aitu_cache__/image/task-remote.png'
    );
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:remote-only'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    render(
      <RetryImage
        src="/__aitu_cache__/image/task-remote.png?thumbnail=small"
        rehydrateCacheUrl="/__aitu_cache__/image/task-remote.png"
        rehydrateMetadata={{
          taskId: 'task-remote',
          remoteTaskId: 'remote-only-1',
        }}
        alt="远程恢复预览"
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/creative/relay/v1/images/tasks/remote-only-1/content',
        expect.objectContaining({ credentials: 'same-origin' })
      );
      expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
        '/__aitu_cache__/image/task-remote.png',
        expect.anything(),
        'image',
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskId: 'task-remote',
            remoteTaskId: 'remote-only-1',
            contentUrl: '/creative/relay/v1/images/tasks/remote-only-1/content',
          }),
        })
      );
    });
  });

  it('retries generated content rehydration across image load retries', async () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    mocks.getCachedBlob.mockResolvedValue(null);
    mocks.cacheMediaFromBlob.mockResolvedValue(
      '/__aitu_cache__/image/task-2.png'
    );
    let fetchAttempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchAttempts += 1;
        if (fetchAttempts < 3) {
          return new Response('warming up', { status: 503 });
        }
        return new Response(blob, { status: 200 });
      })
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:rehydrated-after-retry'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });

    render(
      <RetryImage
        src="/__aitu_cache__/image/task-2.png?thumbnail=small"
        rehydrateCacheUrl="/__aitu_cache__/image/task-2.png"
        rehydrateSourceUrl="/creative/relay/v1/images/tasks/remote-2/content"
        rehydrateMetadata={{ taskId: 'task-2' }}
        alt="重试预览"
        initialRetryDelay={1}
        bypassSWAfterRetries={1}
        maxRetries={3}
      />
    );

    await waitFor(() => {
      expect(fetchAttempts).toBe(1);
    });

    const image = screen.getByAltText('重试预览');
    fireEvent.error(image);
    await waitFor(() => {
      expect(fetchAttempts).toBe(2);
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    fireEvent.error(image);

    await waitFor(() => {
      expect(fetchAttempts).toBe(3);
      expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
        '/__aitu_cache__/image/task-2.png',
        expect.anything(),
        'image',
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskId: 'task-2',
            contentUrl: '/creative/relay/v1/images/tasks/remote-2/content',
          }),
        })
      );
    });
  });
});
