# Tasks: Creative cloud binary asset sync

## 1. OpenSpec and preflight

- [x] 1.1 Validate this change with `openspec validate add-creative-cloud-asset-sync --strict`.
- [x] 1.2 Confirm implementation is running under the Trellis target `approvedDeploymentTarget=vps-a-production-s3`.
- [x] 1.3 Confirm `new-api` asset API contract before wiring Opentu upload/hydrate calls.

## 2. Outbound asset preparation

- [x] 2.1 Add a pure asset preparation step before creative document create/update.
- [x] 2.2 Traverse board snapshots and nested metadata for image/audio/video URL fields.
- [x] 2.3 Resolve `data:`, `blob:`, `/__aitu_cache__/`, `/asset-library/`, and `/__aitu_generated__/audio/` values to `Blob`s.
- [x] 2.4 Upload blobs to `/creative/api/assets` using same-origin credentials and no Authorization/API-key headers.
- [x] 2.5 Rewrite only the outbound snapshot copy to `/creative/api/assets/:id/content` refs.
- [x] 2.6 Preserve 409 conflict freeze and prove asset upload does not overwrite stale remote documents.

## 3. Sanitization and secret safety

- [x] 3.1 Reject or sanitize signed/credentialed remote URLs before persistence.
- [x] 3.2 Ensure snapshots, metadata, status, localStorage, and console logs never include provider credentials, bucket URLs, signed URLs, object keys, raw source URLs, auth headers, or API keys.
- [x] 3.3 Honor `assetSyncEnabled=false` by keeping unsafe/local-only media pending instead of saving broken cloud docs.

## 4. Inbound hydration

- [x] 4.1 Detect same-origin `/creative/api/assets/:id/content` refs on remote/cold-start document load.
- [x] 4.2 Fetch cloud refs as blobs with same-origin credentials and MIME/size safeguards.
- [x] 4.3 Cache hydrated blobs through `unifiedCacheService` and rewrite imported boards to local virtual URLs.
- [x] 4.4 Handle 401/404/network/MIME/size/quota failures without saving unresolved or unsafe refs.

## 5. Service worker integration

- [x] 5.1 Add early pass-through for `/creative/api/assets/*` requests.
- [x] 5.2 Cover image/audio/video/fetch destinations and assert no app-shell/static/media cache writes.

## 6. Verification

- [x] 6.1 Add Vitest coverage for outbound rewrite purity, traversal, upload errors, sanitizer behavior, and conflict handling.
- [x] 6.2 Add Vitest coverage for remote hydration, cold-start import, local revision handling, and failure statuses.
- [x] 6.3 Add service worker tests or equivalent assertions for asset pass-through.
- [x] 6.4 Run the targeted Opentu tests listed by the Trellis task, plus typecheck/build gates or record pre-existing debt.
