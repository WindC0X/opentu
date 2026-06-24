// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoPosterPreview } from './VideoPosterPreview';

const mocks = vi.hoisted(() => ({
  rehydrateGeneratedVideoCacheUrl: vi.fn(),
}));

vi.mock('../../hooks/useThumbnailUrl', () => ({
  useThumbnailUrl: () => undefined,
}));

vi.mock('../../utils/generated-media-cache', () => ({
  rehydrateGeneratedVideoCacheUrl: mocks.rehydrateGeneratedVideoCacheUrl,
}));

describe('VideoPosterPreview generated video rehydrate', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rehydrates generated video cache on playback error and reloads the video element', async () => {
    mocks.rehydrateGeneratedVideoCacheUrl.mockResolvedValue(
      new Blob(['video'], { type: 'video/mp4' })
    );

    const { container } = render(
      <VideoPosterPreview
        src="/__aitu_cache__/video/remote-video-1.mp4"
        activateVideoOnClick
        rehydrateCacheUrl="/__aitu_cache__/video/remote-video-1.mp4"
        rehydrateSourceUrl="/creative/relay/v1/videos/remote-video-1/content"
        rehydrateMetadata={{ remoteTaskId: 'remote-video-1' }}
      />
    );

    fireEvent.click(container.querySelector('.video-poster-preview__placeholder')!);
    const firstVideo = container.querySelector('video')!;
    fireEvent.error(firstVideo);

    await waitFor(() => {
      expect(mocks.rehydrateGeneratedVideoCacheUrl).toHaveBeenCalledWith(
        '/__aitu_cache__/video/remote-video-1.mp4',
        '/creative/relay/v1/videos/remote-video-1/content',
        expect.objectContaining({
          remoteTaskId: 'remote-video-1',
          contentUrl: '/creative/relay/v1/videos/remote-video-1/content',
        })
      );
    });
    await waitFor(() => {
      expect(container.querySelector('video')).not.toBe(firstVideo);
    });
  });
});
