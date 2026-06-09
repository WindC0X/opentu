# Change: Add creative cloud binary asset sync

## Why

`new-api` embedded Opentu already synchronizes creative document JSON snapshots, but media values can still point to local-only `blob:`, `data:`, Cache Storage, or IndexedDB-backed virtual URLs. Those references break when the same creative document is opened on another browser or device.

The current production target is `approvedDeploymentTarget=vps-a-production-s3`: `new-api` remains the only authenticated asset authority and stores binary bytes through a server-side S3-compatible backend. Opentu must prepare, upload, rewrite, and hydrate media through `new-api` without exposing provider credentials, bucket URLs, signed URLs, or object keys.

## What Changes

- Add an Opentu capability for creative cloud binary asset sync behind the embedded `new-api` creative document flow.
- Before outbound document create/update, resolve local media references to `Blob`s, upload them to `/creative/api/assets`, and rewrite only the outgoing snapshot payload to `/creative/api/assets/:id/content` references.
- On remote/cold-start document load, hydrate cloud asset content URLs back into local `unifiedCacheService` URLs before saving/importing the board locally.
- Keep asset preparation pure: live boards, pending snapshots, and conflict-pending snapshots must not be mutated to cloud URLs.
- Extend sanitization so signed/credentialed URLs, provider credentials, bucket URLs, object keys, API keys, auth headers, and raw source URLs are never persisted in snapshots, status, logs, or localStorage.
- Ensure the service worker passes `/creative/api/assets/*` through for image/audio/video/fetch requests and never writes private creative asset responses to static/media/app-shell caches.
- Honor an `assetSyncEnabled` bootstrap/feature flag so deployments can disable asset prepare/hydrate without saving broken cloud documents.

## Impact

- Affected specs:
  - `creative-cloud-asset-sync` (new)
- Affected code:
  - `packages/drawnix/src/services/creative-document-sync.ts`
  - `packages/drawnix/src/services/creative-cloud-sanitizer.ts`
  - `packages/drawnix/src/services/unified-cache-service.ts`
  - `packages/drawnix/src/data/embedded-media.ts`
  - `packages/drawnix/src/hooks/use-creative-document-sync-status.ts`
  - `packages/drawnix/src/components/creative-document-sync-status/*`
  - `apps/web/src/sw/index.ts`
  - related tests under `packages/drawnix/src/**` and `apps/web/src/sw/**`
- External contract:
  - `new-api` provides session-authenticated `/creative/api/assets` upload/content endpoints.
  - Opentu stores only new-api relative content refs such as `/creative/api/assets/:id/content`, never direct object-storage URLs.

## Analysis

Current code already contains creative document sync, a creative sanitizer, embedded media import/export helpers, local virtual media URL forms, and `unifiedCacheService`. The missing behavior is the cross-device binary bridge between those local media stores and the `new-api` creative document snapshot.

The Opentu scope is frontend-only and provider-agnostic. Opentu must not know whether `new-api` uses Cloudflare R2, Backblaze B2, Tigris, AWS S3, or the database canary adapter. Any object key, bucket, signed URL, provider endpoint, or credential remains internal to `new-api` and outside the Opentu snapshot/API contract.

## Approval

- 2026-06-09: User approved `add-creative-cloud-asset-sync` as the Opentu implementation basis for the Trellis task `06-09-creative-cloud-assets-sync` with `approvedDeploymentTarget=vps-a-production-s3`.
