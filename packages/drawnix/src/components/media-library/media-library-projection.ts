import { normalizeImageDataUrl } from '@aitu/utils';
import type { AssetTaskRecord } from '../../services/task-storage-reader';
import { TaskType } from '../../types/task.types';
import {
  AssetCategory as AssetCategoryEnum,
  AssetSource as AssetSourceEnum,
  AssetType as AssetTypeEnum,
  type Asset,
} from '../../types/asset.types';
import {
  resolveGeneratedImageContentUrl,
  resolveGeneratedVideoContentUrl,
} from '../../utils/generated-media-cache';
import type { MediaItem as UnifiedMediaItem } from '../shared/media-preview';

function normalizeAssetCategory(
  category: unknown
): AssetCategoryEnum | undefined {
  return category === AssetCategoryEnum.CHARACTER
    ? AssetCategoryEnum.CHARACTER
    : category === AssetCategoryEnum.GENERAL
    ? AssetCategoryEnum.GENERAL
    : undefined;
}

function buildCharacterMeta(params: {
  characterName?: string;
  characterPrompt?: string;
  prompt?: string;
}): Asset['characterMeta'] | undefined {
  const name = params.characterName?.trim();
  const prompt = params.characterPrompt?.trim() || params.prompt?.trim();
  if (!name && !prompt) {
    return undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

function getAssetMimeType(task: AssetTaskRecord): string {
  const result = task.result;
  if (result?.mimeType) {
    return result.mimeType;
  }
  if (task.type === TaskType.AUDIO) {
    return 'audio/mpeg';
  }
  if (result?.format === 'mp4') {
    return 'video/mp4';
  }
  if (result?.format === 'webm') {
    return 'video/webm';
  }
  return `image/${result?.format || 'png'}`;
}

function getTaskThumbnailUrl(task: AssetTaskRecord): string | undefined {
  const result = task.result;
  if (!result) {
    return undefined;
  }

  const thumbnail =
    result.thumbnailUrls?.find(
      (url) => typeof url === 'string' && url.trim()
    ) ||
    result.thumbnailUrl ||
    result.previewImageUrl;
  return task.type === TaskType.IMAGE && thumbnail
    ? normalizeImageDataUrl(thumbnail)
    : thumbnail;
}

export function assetTaskRecordToAssets(task: AssetTaskRecord): Asset[] {
  const result = task.result;
  if (!result) {
    return [];
  }

  const assetType =
    task.type === TaskType.IMAGE
      ? AssetTypeEnum.IMAGE
      : task.type === TaskType.AUDIO
      ? AssetTypeEnum.AUDIO
      : AssetTypeEnum.VIDEO;
  const mimeType = getAssetMimeType(task);
  const assetCategory = normalizeAssetCategory(
    task.params.assetMetadata?.category
  );
  const characterMeta = buildCharacterMeta({
    characterName: task.params.assetMetadata?.characterName,
    characterPrompt: task.params.assetMetadata?.characterPrompt,
    prompt: task.params.prompt,
  });

  if (task.type === TaskType.AUDIO) {
    const clipAssets = (result.clips || [])
      .map((clip, index): Asset | null => {
        const audioUrl =
          typeof clip.audioUrl === 'string' && clip.audioUrl.trim()
            ? clip.audioUrl
            : result.urls?.[index];
        if (!audioUrl) {
          return null;
        }

        const fallbackBaseName =
          result.title ||
          task.params.title ||
          task.params.prompt?.substring(0, 30) ||
          'AI音频';
        const clipKey = clip.clipId || clip.id || String(index);
        const clipDuration =
          typeof clip.duration === 'number' ? clip.duration : result.duration;

        return {
          id: `${task.id}::${clipKey}`,
          taskId: task.id,
          type: AssetTypeEnum.AUDIO,
          source: AssetSourceEnum.AI_GENERATED,
          url: audioUrl,
          name:
            clip.title ||
            ((result.clips?.length || result.urls?.length || 0) > 1
              ? `${fallbackBaseName} ${index + 1}`
              : fallbackBaseName),
          mimeType,
          createdAt: task.completedAt || task.createdAt,
          size: result.size,
          category: assetCategory,
          characterMeta,
          prompt: task.params.prompt,
          modelName: task.params.model,
          duration: clipDuration,
          clipId: clip.clipId || clip.id,
          providerTaskId: result.providerTaskId || task.remoteId || task.id,
          thumbnail:
            clip.imageLargeUrl || clip.imageUrl || result.previewImageUrl,
        };
      })
      .filter((asset): asset is Asset => asset !== null);

    if (clipAssets.length > 0) {
      return clipAssets;
    }
  }

  const remoteTaskId = result.remoteTaskId || task.remoteId;
  const providerTaskId =
    task.type === TaskType.AUDIO
      ? result.providerTaskId || task.remoteId || task.id
      : result.providerTaskId || remoteTaskId;
  const name =
    task.type === TaskType.AUDIO
      ? result.title ||
        task.params.title ||
        task.params.prompt?.substring(0, 30) ||
        'AI音频'
      : task.params.prompt?.substring(0, 30) || 'AI生成';
  const thumbnail = getTaskThumbnailUrl(task);

  return [
    {
      id: task.id,
      taskId: task.id,
      type: assetType,
      source: AssetSourceEnum.AI_GENERATED,
      url:
        task.type === TaskType.IMAGE
          ? normalizeImageDataUrl(result.url)
          : result.url,
      name,
      mimeType,
      createdAt: task.completedAt || task.createdAt,
      size: result.size,
      category: assetCategory,
      characterMeta,
      cacheWarning: result.cacheWarning,
      prompt: task.params.prompt,
      modelName: task.params.model,
      duration: task.type === TaskType.AUDIO ? result.duration : undefined,
      providerTaskId,
      remoteTaskId,
      contentUrl: result.contentUrl,
      clipId:
        task.type === TaskType.AUDIO
          ? result.primaryClipId || result.clipIds?.[0]
          : undefined,
      ...(thumbnail && { thumbnail }),
    },
  ];
}

export function assetToUnifiedMediaItem(asset: Asset): UnifiedMediaItem {
  const url =
    asset.type === AssetTypeEnum.IMAGE
      ? normalizeImageDataUrl(asset.url)
      : asset.url;
  const rehydrateSourceUrl =
    asset.type === AssetTypeEnum.VIDEO
      ? resolveGeneratedVideoContentUrl({
          contentUrl: asset.contentUrl,
          remoteTaskId: asset.remoteTaskId,
          providerTaskId: asset.providerTaskId,
        })
      : resolveGeneratedImageContentUrl({
          contentUrl: asset.contentUrl,
          remoteTaskId: asset.remoteTaskId,
          providerTaskId: asset.providerTaskId,
        });
  const shouldRehydrate =
    (asset.type === AssetTypeEnum.IMAGE ||
      asset.type === AssetTypeEnum.VIDEO) &&
    asset.source === AssetSourceEnum.AI_GENERATED &&
    Boolean(rehydrateSourceUrl);

  return {
    id: asset.id,
    url,
    type:
      asset.type === AssetTypeEnum.VIDEO
        ? 'video'
        : asset.type === AssetTypeEnum.AUDIO
        ? 'audio'
        : 'image',
    title: asset.name,
    alt: asset.name,
    posterUrl: asset.thumbnail,
    prompt: asset.prompt,
    artist: asset.modelName,
    album: asset.type === AssetTypeEnum.AUDIO ? 'Aitu Generated' : undefined,
    ...(shouldRehydrate
      ? {
          rehydrateCacheUrl: url,
          rehydrateSourceUrl,
          rehydrateMetadata: {
            taskId: asset.taskId || asset.id,
            remoteTaskId: asset.remoteTaskId,
            providerTaskId: asset.providerTaskId,
            contentUrl: rehydrateSourceUrl,
            mimeType: asset.mimeType,
            prompt: asset.prompt,
            model: asset.modelName,
          },
        }
      : {}),
  };
}
