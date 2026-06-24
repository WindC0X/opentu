// @vitest-environment jsdom

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetItem } from './AssetItem';
import { AssetSource, AssetType, type Asset } from '../../types/asset.types';

const mocks = vi.hoisted(() => ({
  lazyImageProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('../lazy-image', async () => {
  const ReactModule = await import('react');
  return {
    LazyImage: (props: Record<string, unknown>) => {
      mocks.lazyImageProps.push(props);
      return ReactModule.createElement('img', {
        alt: String(props.alt || ''),
        'data-testid': 'lazy-image',
      });
    },
  };
});

vi.mock('../../hooks/useThumbnailUrl', () => ({
  useThumbnailUrl: (url: string | undefined) =>
    url ? `${url}?thumbnail=large` : undefined,
}));

vi.mock('../../hooks/useAssetSize', () => ({
  useAssetSize: (_id: string, _url: string, size?: number) => size,
}));

vi.mock('../../hooks/useUnifiedCache', () => ({
  useUnifiedCache: () => ({ isCached: true, cacheWarning: undefined }),
}));

vi.mock('../shared/VideoPosterPreview', () => ({
  VideoPosterPreview: () => null,
}));

vi.mock('../shared/hover', async () => {
  const ReactModule = await import('react');
  return {
    HoverTip: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

describe('AssetItem', () => {
  beforeEach(() => {
    mocks.lazyImageProps.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('passes generated image rehydrate metadata to LazyImage thumbnails', () => {
    const asset: Asset = {
      id: 'asset-1',
      type: AssetType.IMAGE,
      source: AssetSource.AI_GENERATED,
      url: '/__aitu_cache__/image/remote-1.png',
      name: 'generated image',
      mimeType: 'image/png',
      createdAt: 1,
      taskId: 'task-local-1',
      remoteTaskId: 'remote-1',
      contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
      prompt: 'cat',
      modelName: 'mock:gpt-image-2:preview',
    };

    render(
      <AssetItem
        asset={asset}
        viewMode="grid"
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    expect(mocks.lazyImageProps[0]).toMatchObject({
      src: '/__aitu_cache__/image/remote-1.png?thumbnail=large',
      rehydrateCacheUrl: '/__aitu_cache__/image/remote-1.png',
      rehydrateSourceUrl: '/creative/relay/v1/images/tasks/remote-1/content',
      rehydrateMetadata: {
        taskId: 'task-local-1',
        remoteTaskId: 'remote-1',
        contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
        mimeType: 'image/png',
        prompt: 'cat',
        model: 'mock:gpt-image-2:preview',
      },
    });
  });

  it('derives generated image rehydrate source from remoteTaskId when contentUrl is missing', () => {
    const asset: Asset = {
      id: 'asset-remote-only',
      type: AssetType.IMAGE,
      source: AssetSource.AI_GENERATED,
      url: '/__aitu_cache__/image/remote-only.png',
      name: 'generated image without content url',
      mimeType: 'image/png',
      createdAt: 1,
      taskId: 'task-local-remote-only',
      remoteTaskId: 'remote-only',
      prompt: 'cat',
      modelName: 'mock:gpt-image-2:preview',
    };

    render(
      <AssetItem
        asset={asset}
        viewMode="grid"
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    expect(mocks.lazyImageProps[0]).toMatchObject({
      src: '/__aitu_cache__/image/remote-only.png?thumbnail=large',
      rehydrateCacheUrl: '/__aitu_cache__/image/remote-only.png',
      rehydrateSourceUrl: '/creative/relay/v1/images/tasks/remote-only/content',
      rehydrateMetadata: expect.objectContaining({
        taskId: 'task-local-remote-only',
        remoteTaskId: 'remote-only',
        contentUrl: '/creative/relay/v1/images/tasks/remote-only/content',
      }),
    });
  });
});
