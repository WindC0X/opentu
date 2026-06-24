// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GENERATED_MEDIA_CACHE_MISS_EVENT,
  handleVirtualUrlImageError,
} from '../asset-cleanup';

const mocks = vi.hoisted(() => ({
  removeElements: vi.fn(),
  getCachedBlob: vi.fn(),
}));

vi.mock('@plait/core', () => ({
  CoreTransforms: {
    removeElements: mocks.removeElements,
  },
}));

vi.mock('@plait/draw', () => ({
  PlaitDrawElement: {
    isDrawElement: vi.fn(() => true),
    isImage: vi.fn(() => true),
  },
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
  },
}));

describe('asset-cleanup generated media cache failures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.removeElements.mockReset();
    mocks.getCachedBlob.mockReset();
    mocks.getCachedBlob.mockResolvedValue(null);
  });

  it('does not silently remove generated cache image elements when Cache Storage misses', async () => {
    const board = {
      children: [
        {
          id: 'image-element-1',
          url: '/__aitu_cache__/image/task-1.png',
        },
      ],
    } as any;
    const element = board.children[0];
    const cacheMissListener = vi.fn();
    window.addEventListener(
      GENERATED_MEDIA_CACHE_MISS_EVENT,
      cacheMissListener
    );

    try {
      expect(
        handleVirtualUrlImageError(
          board,
          element,
          '/__aitu_cache__/image/task-1.png'
        )
      ).toMatchObject({ delay: 250 });
      expect(
        handleVirtualUrlImageError(
          board,
          element,
          '/__aitu_cache__/image/task-1.png'
        )
      ).toMatchObject({ delay: 750 });
      expect(
        handleVirtualUrlImageError(
          board,
          element,
          '/__aitu_cache__/image/task-1.png'
        )
      ).toMatchObject({ delay: 1500 });

      expect(
        handleVirtualUrlImageError(
          board,
          element,
          '/__aitu_cache__/image/task-1.png'
        )
      ).toBeUndefined();

      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(mocks.getCachedBlob).toHaveBeenCalledWith(
        '/__aitu_cache__/image/task-1.png'
      );
      expect(cacheMissListener).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            taskId: 'task-1',
            elementId: 'image-element-1',
            imageUrl: '/__aitu_cache__/image/task-1.png',
          }),
        })
      );
      expect(mocks.removeElements).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(
        GENERATED_MEDIA_CACHE_MISS_EVENT,
        cacheMissListener
      );
    }
  });
});
