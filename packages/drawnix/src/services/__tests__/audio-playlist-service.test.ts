import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioPlaylist } from '../../types/audio-playlist.types';

const stores = new Map<string, Map<string, unknown>>();

vi.mock('localforage', () => ({
  default: {
    createInstance: ({ storeName }: { storeName: string }) => {
      const store = stores.get(storeName) || new Map<string, unknown>();
      stores.set(storeName, store);
      return {
        async getItem<T>(key: string): Promise<T | null> {
          return (store.get(key) as T) || null;
        },
        async setItem<T>(key: string, value: T): Promise<T> {
          store.set(key, value);
          return value;
        },
        async removeItem(key: string): Promise<void> {
          store.delete(key);
        },
        async keys(): Promise<string[]> {
          return Array.from(store.keys());
        },
      };
    },
  },
}));

describe('audioPlaylistService', () => {
  beforeEach(() => {
    stores.clear();
    vi.resetModules();
    vi.stubGlobal('crypto', {
      randomUUID: () => 'playlist-1',
    });
  });

  it('creates default favorites playlist on initialize', async () => {
    const { audioPlaylistService } = await import('../audio-playlist-service');
    await audioPlaylistService.initialize();

    const playlists = await audioPlaylistService.listPlaylists();
    expect(playlists).toHaveLength(1);
    expect(playlists[0]).toMatchObject<AudioPlaylist>({
      id: 'favorites',
      name: '收藏',
      isSystem: true,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
  });

  it('prevents duplicate items in the same playlist', async () => {
    const { audioPlaylistService } = await import('../audio-playlist-service');
    await audioPlaylistService.initialize();
    const playlist = await audioPlaylistService.createPlaylist('Lo-fi');

    await audioPlaylistService.addAssetToPlaylist('asset-1', playlist.id);
    await audioPlaylistService.addAssetToPlaylist('asset-1', playlist.id);

    const items = await audioPlaylistService.getPlaylistItems(playlist.id);
    expect(items).toHaveLength(1);
  });

  it('removes asset references from all playlists', async () => {
    const { audioPlaylistService } = await import('../audio-playlist-service');
    await audioPlaylistService.initialize();
    const playlist = await audioPlaylistService.createPlaylist('Synth');

    await audioPlaylistService.addAssetToPlaylist('asset-1', 'favorites');
    await audioPlaylistService.addAssetToPlaylist('asset-1', playlist.id);
    await audioPlaylistService.removeAssetFromAllPlaylists('asset-1');

    expect(await audioPlaylistService.getPlaylistItems('favorites')).toHaveLength(0);
    expect(await audioPlaylistService.getPlaylistItems(playlist.id)).toHaveLength(0);
  });
});
