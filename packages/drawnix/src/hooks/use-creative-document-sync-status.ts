import { useEffect, useState } from 'react';
import {
  createIdleCreativeDocumentCloudSyncStatus,
  getCreativeDocumentCloudSyncService,
  getCreativeDocumentCloudSyncStatusSnapshot,
  initializeCreativeDocumentCloudSync,
  type CreativeDocumentCloudSyncInitializeOptions,
  type CreativeDocumentCloudSyncService,
  type CreativeDocumentCloudSyncStatus,
} from '../services/creative-document-sync';

export interface UseCreativeDocumentCloudSyncStatusOptions
  extends CreativeDocumentCloudSyncInitializeOptions {
  /** Use a specific service instance, primarily for focused UI tests. */
  service?: CreativeDocumentCloudSyncService | null;
  /** Disable subscribing without changing the returned safe idle shape. */
  enabled?: boolean;
  /** Initialize the embedded singleton when no explicit service is provided. */
  autoInitialize?: boolean;
}

export function useCreativeDocumentCloudSyncStatus(
  options: UseCreativeDocumentCloudSyncStatusOptions = {}
): CreativeDocumentCloudSyncStatus {
  const {
    service: providedService,
    enabled = true,
    autoInitialize = true,
    adapter,
    workspace,
    storage,
    debounceMs,
    locationLike,
  } = options;
  const [status, setStatus] = useState<CreativeDocumentCloudSyncStatus>(() =>
    getCreativeDocumentCloudSyncStatusSnapshot(
      providedService === undefined
        ? getCreativeDocumentCloudSyncService()
        : providedService
    )
  );

  useEffect(() => {
    if (!enabled) {
      setStatus(createIdleCreativeDocumentCloudSyncStatus());
      return;
    }

    const service =
      providedService !== undefined
        ? providedService
        : autoInitialize
        ? initializeCreativeDocumentCloudSync({
            adapter,
            workspace,
            storage,
            debounceMs,
            locationLike,
          })
        : getCreativeDocumentCloudSyncService();

    if (!service) {
      setStatus(createIdleCreativeDocumentCloudSyncStatus());
      return;
    }

    const subscription = service.subscribeStatus((nextStatus) => {
      setStatus(nextStatus);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [
    adapter,
    autoInitialize,
    debounceMs,
    enabled,
    locationLike,
    providedService,
    storage,
    workspace,
  ]);

  return status;
}
