import { describe, expect, it } from 'vitest';

import {
  sanitizeCreativeFailureMessage,
  sanitizeCreativeFailureObjectMessage,
} from './creative-error-sanitizer';

describe('creative-error-sanitizer', () => {
  it('redacts callback, webhook, and notify hook failure material', () => {
    expect(
      sanitizeCreativeFailureMessage(
        'callback delivery failed for notifyHook relay',
        '生成失败'
      )
    ).toBe('生成失败');
    expect(
      sanitizeCreativeFailureObjectMessage(
        { message: 'webhook returned provider callback metadata' },
        '生成失败'
      )
    ).toBe('生成失败');
  });
});
