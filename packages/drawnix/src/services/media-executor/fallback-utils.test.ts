import { afterEach, describe, expect, it, vi } from 'vitest';
import { TASK_TIMEOUT } from '../../constants/TASK_CONSTANTS';

vi.mock('../provider-routing/provider-transport', () => ({
  providerTransport: {
    send: vi.fn(),
  },
}));

describe('fallback video polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps polling remote video tasks for the configured video timeout instead of the old 10 minute cap', async () => {
    vi.useFakeTimers();
    const { providerTransport } = await import(
      '../provider-routing/provider-transport'
    );
    const { pollVideoStatus } = await import('./fallback-utils');
    const controller = new AbortController();
    let settled = false;

    vi.mocked(providerTransport.send).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'processing',
        progress: 50,
      }),
    } as Response);

    const polling = pollVideoStatus(
      'remote-video-slow-1',
      {
        baseUrl: 'https://provider.example/v1',
        apiKey: 'test-key',
        model: 'slow-video',
      },
      vi.fn(),
      controller.signal
    )
      .catch((error: Error) => error.message)
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(TASK_TIMEOUT.VIDEO - 5_000);
    expect(settled).toBe(false);

    controller.abort();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(polling).resolves.toBe('Video generation cancelled');
  });
});
