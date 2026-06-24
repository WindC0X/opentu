import { normalizeImageDataUrl } from '@aitu/utils';
import type { Asset } from '../types/asset.types';
import { ensureGeneratedImageCacheUrlReady } from './generated-media-cache';

export async function getReadyMediaLibraryImageInsertUrl(
  asset: Pick<
    Asset,
    | 'id'
    | 'url'
    | 'mimeType'
    | 'taskId'
    | 'remoteTaskId'
    | 'providerTaskId'
    | 'contentUrl'
    | 'prompt'
    | 'modelName'
  >
): Promise<string> {
  const normalizedUrl = normalizeImageDataUrl(asset.url);
  const ready = await ensureGeneratedImageCacheUrlReady(normalizedUrl, {
    contentUrl: asset.contentUrl,
    metadata: {
      taskId: asset.taskId || asset.id,
      remoteTaskId: asset.remoteTaskId,
      providerTaskId: asset.providerTaskId,
      contentUrl: asset.contentUrl,
      mimeType: asset.mimeType,
      prompt: asset.prompt,
      model: asset.modelName,
    },
  });
  return ready.url;
}
