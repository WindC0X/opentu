// @vitest-environment jsdom

import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Video } from './video';
import { GENERATED_MEDIA_CACHE_MISS_EVENT } from '../../utils/asset-cleanup';

describe('Video generated cache miss reporting', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('dispatches a generated video cache miss event when a generated cache video fails to load', () => {
    const listener = vi.fn();
    window.addEventListener(GENERATED_MEDIA_CACHE_MISS_EVENT, listener);

    try {
      const { container } = render(
        <Video
          videoItem={
            {
              url: '/__aitu_cache__/video/remote-video-1.mp4#video',
              elementId: 'video-element-1',
            } as any
          }
        />
      );

      const video = container.querySelector('video');
      expect(video).toBeTruthy();
      fireEvent.error(video!);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual(
        expect.objectContaining({
          mediaType: 'video',
          taskId: 'remote-video-1',
          elementId: 'video-element-1',
          mediaUrl: '/__aitu_cache__/video/remote-video-1.mp4#video',
        })
      );
    } finally {
      window.removeEventListener(GENERATED_MEDIA_CACHE_MISS_EVENT, listener);
    }
  });

  it('includes boardId in generated video cache miss events when available', () => {
    const listener = vi.fn();
    window.addEventListener(GENERATED_MEDIA_CACHE_MISS_EVENT, listener);

    try {
      const { container } = render(
        <Video
          videoItem={
            {
              url: '/__aitu_cache__/video/remote-video-board.mp4#video',
              elementId: 'video-element-board',
              boardId: 'board-video-1',
            } as any
          }
        />
      );

      fireEvent.error(container.querySelector('video')!);

      expect(listener).toHaveBeenCalledTimes(1);
      const event = listener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual(
        expect.objectContaining({
          boardId: 'board-video-1',
          mediaType: 'video',
          elementId: 'video-element-board',
        })
      );
    } finally {
      window.removeEventListener(GENERATED_MEDIA_CACHE_MISS_EVENT, listener);
    }
  });

  it('clears the local error placeholder when a recovered generated video URL changes', () => {
    const { container, rerender, queryByText } = render(
      <Video
        videoItem={
          {
            url: '/__aitu_cache__/video/remote-video-retry.mp4#video',
            elementId: 'video-element-retry',
          } as any
        }
      />
    );

    fireEvent.error(container.querySelector('video')!);
    expect(queryByText('Video failed to load')).toBeTruthy();

    rerender(
      <Video
        videoItem={
          {
            url: '/__aitu_cache__/video/remote-video-retry.mp4?_retry=1#video',
            elementId: 'video-element-retry',
          } as any
        }
      />
    );

    expect(queryByText('Video failed to load')).toBeNull();
    expect(container.querySelector('video')?.getAttribute('src')).toBe(
      '/__aitu_cache__/video/remote-video-retry.mp4?_retry=1'
    );
  });
});
