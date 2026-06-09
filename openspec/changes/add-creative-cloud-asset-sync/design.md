## Context

Embedded Opentu runs under `new-api` at `/creative`. Existing creative document sync persists sanitized board snapshots through `new-api`, while media generated or cached inside Opentu may remain local to one browser through:

- `blob:` URLs
- `data:image|audio|video/...` values
- `/__aitu_cache__/...` virtual cache URLs
- `/asset-library/...` URLs
- `/__aitu_generated__/audio/...` URLs

Those values can render on the source device but become broken when the remote document is opened on another device. `new-api` is being planned as the server-side asset authority with S3-compatible production storage, but Opentu must keep the frontend contract limited to same-origin `new-api` asset content URLs.

## Goals / Non-Goals

- Goals:
  - Upload local creative media before outbound document sync.
  - Rewrite only the outbound snapshot payload to stable same-origin new-api asset content refs.
  - Hydrate remote asset refs back into local cache URLs before local import/save.
  - Preserve 409 conflict behavior and avoid stale document overwrite after asset upload.
  - Keep secrets, bucket details, signed URLs, and object keys out of Opentu state, logs, status, and snapshots.
  - Pass creative asset requests through the service worker without private-cache pollution.
- Non-Goals:
  - No direct browser-to-bucket upload or download.
  - No public asset sharing URL behavior.
  - No object-storage provider selection, credentials, IAM, or pricing logic inside Opentu.
  - No user-visible asset library redesign.
  - No Video/Suno/MJ relay implementation in this change.

## Decisions

- Decision: Treat `new-api` as the only asset gateway.
  - Opentu uploads and downloads through same-origin `/creative/api/assets` endpoints using browser session credentials.
  - Opentu never receives or stores bucket URLs, signed URLs, object keys, S3 endpoints, access key IDs, or secrets.
  - Reason: keeps provider storage swappable and prevents browser-side credential leakage.

- Decision: Prepare assets before document snapshot create/update.
  - The sync pipeline discovers local media values, resolves each to a `Blob`, uploads once by content hash/server dedupe, and rewrites the outbound snapshot copy.
  - Reason: the remote JSON snapshot must reference durable cloud content before `new-api` accepts the document update.

- Decision: Keep preparation pure.
  - The live board, queued local snapshot, and conflict-pending snapshot remain in local URL form.
  - Only the request payload sent to `new-api` is rewritten to cloud asset refs.
  - Reason: local rendering remains fast and 409 conflict freeze cannot accidentally persist cloud URLs into stale local state.

- Decision: Hydrate before local import/save on remote/cold-start load.
  - Same-origin cloud refs are fetched as blobs, cached through `unifiedCacheService`, and rewritten to content-addressed local virtual URLs before board import.
  - Reason: after import, existing canvas rendering and media playback paths can keep using local cache URLs.

- Decision: Block or keep pending when a local/signed asset cannot be safely uploaded.
  - Signed/credentialed remote URLs and raw credential-bearing URLs must never be saved in the remote document snapshot.
  - When anonymous fetch/upload fails, the document sync status becomes pending/recoverable and records only sanitized reason codes.
  - Reason: saving a broken or secret-bearing document is worse than delaying sync.

- Decision: Service worker passes asset content requests through.
  - `/creative/api/assets/*` is excluded early from static, app-shell, image, audio, video, and virtual-cache handlers.
  - Reason: asset responses are private/session-scoped and must not be cached as public/static assets.

## Data Flow

### Outbound sync

1. Creative document sync receives a board snapshot candidate.
2. Asset preparation deep-copies the payload.
3. Traversal finds supported URL fields such as `url`, `urls[]`, `imageUrl`, `videoUrl`, `audioUrl`, `poster`, `src`, `thumbnail`, `thumbnailUrl`, `thumbnailUrls[]`, `previewImageUrl`, `coverUrl`, and nested `clips[]` media fields.
4. Local `data:`, `blob:`, `/__aitu_cache__/`, `/asset-library/`, and `/__aitu_generated__/audio/` values are resolved to `Blob`s.
5. Each blob is uploaded to `new-api` and replaced in the outbound copy with `/creative/api/assets/:id/content`.
6. Sanitization rejects or strips unsafe URL-like metadata before the document request is sent.
7. Document create/update proceeds with the rewritten copy; 409 conflict behavior remains unchanged.

### Inbound hydration

1. Remote document snapshot is received from `new-api`.
2. Asset hydration finds same-origin `/creative/api/assets/:id/content` refs.
3. Each ref is fetched using same-origin credentials and size/MIME safeguards.
4. The blob is cached through `unifiedCacheService`.
5. The imported board is rewritten to local virtual URLs before local save/import.
6. Hydration failure records sanitized status and must not save a board with unresolved local-only or unsafe cloud refs.

## Risks / Trade-offs

- Risk: Asset upload succeeds but document update fails with 409.
  - Mitigation: keep the board/pending snapshot local and rely on `new-api` asset reference/GC policy for unreferenced uploaded assets.

- Risk: Large media values increase sync latency.
  - Mitigation: enforce upload limits, surface pending/error status, and avoid mutating local board during prepare.

- Risk: URL traversal misses nested media fields.
  - Mitigation: centralize traversal tests for image/audio/video fields and reuse embedded media traversal patterns where possible.

- Risk: Service worker accidentally caches private asset responses.
  - Mitigation: add a pass-through matrix covering image/audio/video/fetch destinations and assert no writes to static/media/app-shell caches.

## Migration / Rollback

- Existing documents without cloud asset refs continue loading through the existing document sync path.
- When `assetSyncEnabled` is false, Opentu disables prepare/hydrate and keeps documents with local-only or signed media pending/sanitized rather than uploading or saving broken refs.
- Rollback disables the feature flag and leaves existing local cache and remote document JSON untouched.
