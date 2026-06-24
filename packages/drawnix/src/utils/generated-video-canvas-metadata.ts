export interface GeneratedVideoCanvasMetadata {
  contentUrl?: string;
  remoteTaskId?: string;
  providerTaskId?: string;
  mimeType?: string;
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getGeneratedVideoCanvasMetadata(
  metadata: Record<string, unknown> | undefined
): GeneratedVideoCanvasMetadata {
  if (!metadata) {
    return {};
  }

  const result: GeneratedVideoCanvasMetadata = {};
  const contentUrl = stringMetadataValue(metadata.contentUrl);
  const remoteTaskId = stringMetadataValue(metadata.remoteTaskId);
  const providerTaskId = stringMetadataValue(metadata.providerTaskId);
  const mimeType = stringMetadataValue(metadata.mimeType);
  if (contentUrl) {
    result.contentUrl = contentUrl;
  }
  if (remoteTaskId) {
    result.remoteTaskId = remoteTaskId;
  }
  if (providerTaskId) {
    result.providerTaskId = providerTaskId;
  }
  if (mimeType) {
    result.mimeType = mimeType;
  }
  return result;
}
