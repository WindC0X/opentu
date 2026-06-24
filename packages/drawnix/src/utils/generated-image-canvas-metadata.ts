export interface GeneratedImageCanvasMetadata {
  contentUrl?: string;
  remoteTaskId?: string;
  providerTaskId?: string;
  mimeType?: string;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getGeneratedImageCanvasMetadata(
  metadata: Record<string, unknown> | undefined
): GeneratedImageCanvasMetadata {
  if (!metadata) {
    return {};
  }
  return {
    contentUrl: cleanString(metadata.contentUrl),
    remoteTaskId: cleanString(metadata.remoteTaskId),
    providerTaskId: cleanString(metadata.providerTaskId),
    mimeType: cleanString(metadata.mimeType),
  };
}

export function hasGeneratedImageCanvasMetadata(
  metadata: GeneratedImageCanvasMetadata
): boolean {
  return Boolean(
    metadata.contentUrl ||
      metadata.remoteTaskId ||
      metadata.providerTaskId ||
      metadata.mimeType
  );
}
