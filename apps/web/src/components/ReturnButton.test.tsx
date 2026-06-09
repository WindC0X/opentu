import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReturnButton } from './ReturnButton';

describe('ReturnButton', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders in embedded /creative mode', () => {
    window.history.pushState({}, '', '/creative/board/demo');

    render(<ReturnButton />);

    expect(
      screen.getByRole('button', { name: '返回控制台' })
    ).not.toBeNull();
  });

  it('does not render in standalone mode', () => {
    window.history.pushState({}, '', '/board/demo');

    render(<ReturnButton />);

    expect(
      screen.queryByRole('button', { name: '返回控制台' })
    ).toBeNull();
  });
});
