// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertVideoFromUrl } from './video';

const mocks = vi.hoisted(() => ({
  insertImage: vi.fn(),
}));

vi.mock('@plait/draw', () => ({
  DrawTransforms: {
    insertImage: mocks.insertImage,
  },
}));

vi.mock('../utils/selection-utils', () => ({
  getInsertionPointForSelectedElements: vi.fn(),
  getInsertionPointBelowBottommostElement: vi.fn(() => [100, 100]),
  scrollToPointIfNeeded: vi.fn(),
}));

vi.mock('../utils/canvas-insertion-layout', () => ({
  getInsertionPointFromSavedSelection: vi.fn(() => undefined),
}));

vi.mock('../utils/posthog-analytics', () => ({
  analytics: {
    track: vi.fn(),
  },
}));

describe('insertVideoFromUrl generated video metadata', () => {
  beforeEach(() => {
    mocks.insertImage.mockReset();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists durable generated video rehydrate metadata on inserted canvas video nodes', async () => {
    const board = { children: [] } as any;

    await insertVideoFromUrl(
      board,
      '/__aitu_cache__/video/remote-video-1.mp4',
      [10, 20],
      false,
      { width: 320, height: 180 },
      true,
      true,
      true,
      {
        taskId: 'local-task-1',
        contentUrl: '/creative/relay/v1/videos/remote-video-1/content',
        remoteTaskId: 'remote-video-1',
        providerTaskId: 'provider-video-1',
        mimeType: 'video/mp4',
        callback: 'https://attacker.invalid/should-not-persist',
      }
    );

    expect(mocks.insertImage).toHaveBeenCalledWith(
      board,
      expect.objectContaining({
        url: '/__aitu_cache__/video/remote-video-1.mp4#video',
        width: 320,
        height: 180,
        isVideo: true,
        videoType: 'video',
        contentUrl: '/creative/relay/v1/videos/remote-video-1/content',
        remoteTaskId: 'remote-video-1',
        providerTaskId: 'provider-video-1',
        mimeType: 'video/mp4',
      }),
      [10, 20]
    );
    expect(mocks.insertImage.mock.calls[0]?.[1]).not.toHaveProperty('callback');
    expect(mocks.insertImage.mock.calls[0]?.[1]).not.toHaveProperty('taskId');
  });
});
