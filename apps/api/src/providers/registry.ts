import { AppError } from '../errors';
import { GrsaiImageProviderAdapter, type GrsaiAdapterOptions } from './grsai-adapter';
import { MockImageProvider } from './mock-provider';
import type { ImageProviderAdapter } from './types';

export class ImageProviderRegistry {
  private readonly adapters = new Map<string, ImageProviderAdapter>();

  constructor(adapters: ImageProviderAdapter[] = []) {
    for (const adapter of adapters) {
      this.register(adapter);
    }
  }

  register(adapter: ImageProviderAdapter): void {
    this.adapters.set(adapter.providerKey, adapter);
  }

  require(providerKey: string): ImageProviderAdapter {
    const adapter = this.adapters.get(providerKey);
    if (!adapter) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        400,
        `Provider adapter is not registered: ${providerKey}`
      );
    }
    return adapter;
  }
}

export function createDefaultProviderRegistry(
  options: { grsai?: GrsaiAdapterOptions } = {}
): ImageProviderRegistry {
  return new ImageProviderRegistry([
    new MockImageProvider(),
    new GrsaiImageProviderAdapter(options.grsai),
  ]);
}
