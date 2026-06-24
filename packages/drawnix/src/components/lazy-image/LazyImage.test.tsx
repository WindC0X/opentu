// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LazyImage } from './LazyImage';

const mocks = vi.hoisted(() => ({
  retryImageProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('../retry-image', async () => {
  const ReactModule = await import('react');
  return {
    RetryImage: (props: Record<string, unknown>) => {
      mocks.retryImageProps.push(props);
      return ReactModule.createElement('img', {
        alt: String(props.alt || ''),
        'data-testid': 'retry-image',
      });
    },
  };
});

class ImmediateIntersectionObserver {
  constructor(
    private readonly callback: IntersectionObserverCallback
  ) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          isIntersecting: true,
          target,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver
    );
  }

  disconnect(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

describe('LazyImage', () => {
  beforeEach(() => {
    mocks.retryImageProps.length = 0;
    vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('forwards generated-media rehydrate props to RetryImage', async () => {
    render(
      <LazyImage
        src="/__aitu_cache__/image/remote-1.png?thumbnail=large"
        alt="generated thumbnail"
        rehydrateCacheUrl="/__aitu_cache__/image/remote-1.png"
        rehydrateSourceUrl="/creative/relay/v1/images/tasks/remote-1/content"
        rehydrateMetadata={{
          taskId: 'task-local-1',
          remoteTaskId: 'remote-1',
          mimeType: 'image/png',
        }}
      />
    );

    await waitFor(() => {
      expect(mocks.retryImageProps[0]).toMatchObject({
        rehydrateCacheUrl: '/__aitu_cache__/image/remote-1.png',
        rehydrateSourceUrl:
          '/creative/relay/v1/images/tasks/remote-1/content',
        rehydrateMetadata: {
          taskId: 'task-local-1',
          remoteTaskId: 'remote-1',
          mimeType: 'image/png',
        },
      });
    });
  });
});
