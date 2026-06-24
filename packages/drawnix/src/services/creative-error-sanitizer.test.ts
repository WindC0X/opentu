import { describe, expect, it } from 'vitest';

import {
  sanitizeCreativeFailureMessage,
  sanitizeCreativeFailureObjectMessage,
} from './creative-error-sanitizer';

describe('creative-error-sanitizer', () => {
  it('preserves safe provider rejection messages without URLs or credentials', () => {
    expect(
      sanitizeCreativeFailureMessage(
        'provider rejected prompt: image policy violation',
        '生成失败'
      )
    ).toBe('provider rejected prompt: image policy violation');
    expect(
      sanitizeCreativeFailureMessage(
        'upstream returned invalid image size',
        '生成失败'
      )
    ).toBe('upstream returned invalid image size');
  });

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
