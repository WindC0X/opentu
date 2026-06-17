import { describe, expect, it } from 'vitest';

import { getChatDrawerSendReadiness } from './chat-drawer-readiness';

describe('chat drawer send readiness', () => {
  it('does not require a local API key when embedded managed session is ready', () => {
    expect(
      getChatDrawerSendReadiness({
        isEmbedded: true,
        hasManagedSessionRoute: true,
        hasLocalApiKey: false,
      })
    ).toEqual({ ready: true, shouldOpenSettings: false });
  });

  it('returns an actionable embedded error when managed session or models are unavailable', () => {
    const readiness = getChatDrawerSendReadiness({
      isEmbedded: true,
      hasManagedSessionRoute: false,
      hasLocalApiKey: false,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.shouldOpenSettings).toBe(false);
    expect(readiness.message).toMatch(/New API|refresh|administrator|model/i);
    expect(readiness.message).not.toMatch(/API Key|Gemini/i);
  });

  it('preserves standalone local API key setup behavior', () => {
    expect(
      getChatDrawerSendReadiness({
        isEmbedded: false,
        hasManagedSessionRoute: false,
        hasLocalApiKey: false,
      })
    ).toEqual({
      ready: false,
      shouldOpenSettings: true,
      message: 'API Key 是必需的，请先在设置中配置。',
    });
  });
});
