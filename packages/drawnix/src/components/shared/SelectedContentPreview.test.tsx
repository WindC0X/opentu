// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectedContentPreview } from './SelectedContentPreview';

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

describe('SelectedContentPreview', () => {
  afterEach(() => {
    cleanup();
    mocks.retryImageProps.length = 0;
  });

  it('uses RetryImage rehydration props for generated selected images', () => {
    render(
      <SelectedContentPreview
        items={[
          {
            type: 'image',
            url: '/__aitu_cache__/image/remote-selected.png',
            name: 'Selected generated image',
            contentUrl:
              '/creative/relay/v1/images/tasks/remote-selected/content',
            remoteTaskId: 'remote-selected',
            mimeType: 'image/png',
          },
        ]}
      />
    );

    expect(screen.getByTestId('retry-image')).toBeTruthy();
    expect(mocks.retryImageProps[0]).toMatchObject({
      src: '/__aitu_cache__/image/remote-selected.png',
      rehydrateCacheUrl: '/__aitu_cache__/image/remote-selected.png',
      rehydrateSourceUrl:
        '/creative/relay/v1/images/tasks/remote-selected/content',
      rehydrateMetadata: expect.objectContaining({
        remoteTaskId: 'remote-selected',
        providerTaskId: 'remote-selected',
        contentUrl: '/creative/relay/v1/images/tasks/remote-selected/content',
        mimeType: 'image/png',
      }),
    });
  });

  it('derives selected image rehydration from remoteTaskId when contentUrl is missing', () => {
    render(
      <SelectedContentPreview
        items={[
          {
            type: 'image',
            url: '/__aitu_cache__/image/remote-selected-only.png',
            name: 'Selected generated image without contentUrl',
            remoteTaskId: 'remote-selected-only',
            mimeType: 'image/png',
          },
        ]}
      />
    );

    expect(screen.getByTestId('retry-image')).toBeTruthy();
    expect(mocks.retryImageProps[0]).toMatchObject({
      src: '/__aitu_cache__/image/remote-selected-only.png',
      rehydrateCacheUrl: '/__aitu_cache__/image/remote-selected-only.png',
      rehydrateSourceUrl:
        '/creative/relay/v1/images/tasks/remote-selected-only/content',
      rehydrateMetadata: expect.objectContaining({
        remoteTaskId: 'remote-selected-only',
        providerTaskId: 'remote-selected-only',
        contentUrl:
          '/creative/relay/v1/images/tasks/remote-selected-only/content',
      }),
    });
  });
});
