import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeModelDiscoveryState } from '../utils/runtime-model-discovery';

const mocks = vi.hoisted(() => {
  let listener: (() => void) | null = null;
  let state = {
    profileId: 'new-api-creative',
    status: 'idle',
    discoveredModels: [],
    selectedModelIds: [],
    models: [],
    error: null,
  } as unknown as RuntimeModelDiscoveryState;
  const readyState = {
    ...state,
    status: 'ready',
    discoveredModels: [
      {
        id: 'Gpt-image-2',
        type: 'image',
        label: 'gpt-image-2',
        shortCode: 'gpt2',
      },
    ],
    selectedModelIds: ['Gpt-image-2'],
    models: [
      {
        id: 'Gpt-image-2',
        type: 'image',
        label: 'gpt-image-2',
        shortCode: 'gpt2',
      },
    ],
  } as unknown as RuntimeModelDiscoveryState;

  return {
    getState: vi.fn(() => state),
    refreshFromSettings: vi.fn(() => {
      state = readyState;
      listener?.();
    }),
    subscribe: vi.fn((next: () => void) => {
      listener = next;
      return () => {
        if (listener === next) {
          listener = null;
        }
      };
    }),
    reset: () => {
      listener = null;
      state = {
        profileId: 'new-api-creative',
        status: 'idle',
        discoveredModels: [],
        selectedModelIds: [],
        models: [],
        error: null,
      } as unknown as RuntimeModelDiscoveryState;
    },
  };
});

vi.mock('../utils/runtime-model-discovery', () => ({
  runtimeModelDiscovery: {
    getState: mocks.getState,
    refreshFromSettings: mocks.refreshFromSettings,
    subscribe: mocks.subscribe,
  },
  getPreferredModels: vi.fn(() => []),
  getSelectableModels: vi.fn(() => []),
  getProfilePreferredModels: vi.fn(() => []),
}));

import { useRuntimeModelDiscoveryState } from './use-runtime-models';

function RuntimeStateProbe() {
  const state = useRuntimeModelDiscoveryState('new-api-creative');
  return <pre data-testid="runtime-state">{JSON.stringify(state)}</pre>;
}

describe('useRuntimeModelDiscoveryState', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.reset();
  });

  it('refreshes persisted runtime discovery state on mount for deferred Creative chunks', async () => {
    window.history.pushState({}, '', '/creative/');

    render(<RuntimeStateProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('runtime-state').textContent).toContain(
        '"status":"ready"'
      );
    });
    expect(mocks.refreshFromSettings).toHaveBeenCalledTimes(1);
    expect(mocks.refreshFromSettings).toHaveBeenCalledWith({
      reloadFromStorage: true,
    });
    expect(mocks.getState).toHaveBeenCalledWith('new-api-creative');
    expect(screen.getByTestId('runtime-state').textContent).toContain('gpt2');
  });

  it('refreshes again when the managed catalog update event arrives from another chunk', async () => {
    window.history.pushState({}, '', '/creative/');
    render(<RuntimeStateProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('runtime-state').textContent).toContain(
        '"status":"ready"'
      );
    });

    mocks.refreshFromSettings.mockClear();
    act(() => {
      window.dispatchEvent(new CustomEvent('creative:managed-catalog-updated'));
    });

    await waitFor(() => {
      expect(mocks.refreshFromSettings).toHaveBeenCalledWith({
        reloadFromStorage: true,
      });
    });
  });
});
