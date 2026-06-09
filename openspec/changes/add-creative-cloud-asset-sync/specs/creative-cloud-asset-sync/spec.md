## ADDED Requirements

### Requirement: Prepare Local Media For Creative Cloud Sync

The system SHALL prepare local creative media before outbound embedded `new-api` creative document create/update requests.

#### Scenario: Rewrite local virtual media refs in outbound payload
- **GIVEN** a creative board snapshot contains image, audio, or video fields pointing at `/__aitu_cache__/`, `/asset-library/`, or `/__aitu_generated__/audio/` URLs
- **WHEN** the document is synchronized to `new-api`
- **THEN** Opentu SHALL resolve each local media value to a `Blob`
- **AND** upload it through the same-origin creative asset API
- **AND** rewrite the outbound snapshot payload to same-origin `/creative/api/assets/:id/content` refs

#### Scenario: Rewrite blob and data media refs in outbound payload
- **GIVEN** a creative board snapshot contains supported `blob:` or `data:image|audio|video/...` media values
- **WHEN** the document is synchronized to `new-api`
- **THEN** Opentu SHALL upload the resolved bytes through the creative asset API
- **AND** persist only the resulting `/creative/api/assets/:id/content` refs in the remote document payload

#### Scenario: Keep live board local during preparation
- **GIVEN** a board contains local media URLs
- **WHEN** Opentu prepares assets for outbound cloud sync
- **THEN** the live board, queued local snapshot, and conflict-pending snapshot SHALL remain in their original local URL form
- **AND** only the request payload sent to `new-api` SHALL contain cloud asset refs

### Requirement: Keep Creative Asset Storage Details Out Of Opentu State

Opentu SHALL treat `new-api` as the only creative asset gateway and SHALL NOT persist object-storage implementation details.

#### Scenario: Persist only same-origin new-api asset refs
- **GIVEN** `new-api` stores creative assets using an S3-compatible backend
- **WHEN** Opentu uploads or hydrates a creative asset
- **THEN** Opentu SHALL store only same-origin refs such as `/creative/api/assets/:id/content`
- **AND** SHALL NOT store or display bucket URLs, signed URLs, object keys, S3 endpoints, access key IDs, secret keys, or provider-specific storage identifiers

#### Scenario: Do not send provider credentials to asset API
- **GIVEN** Opentu is running in embedded creative mode
- **WHEN** Opentu calls `/creative/api/assets`
- **THEN** the request SHALL use browser same-origin session credentials
- **AND** SHALL NOT send Authorization headers, API keys, upstream base URLs, provider settings, bucket endpoints, object keys, or S3 credentials

### Requirement: Sanitize Unsafe Asset URLs Before Persistence

The system SHALL prevent unsafe or credential-bearing asset URLs from being persisted in creative document snapshots, metadata, status, logs, or localStorage.

#### Scenario: Signed remote URL cannot be uploaded anonymously
- **GIVEN** a creative board contains a signed or credential-bearing remote media URL
- **WHEN** anonymous fetch/upload cannot safely convert it to a cloud asset
- **THEN** document sync SHALL remain pending or fail with a recoverable sanitized status
- **AND** the original signed URL SHALL NOT be persisted in the remote snapshot, document metadata, asset metadata, status, logs, or localStorage

#### Scenario: Direct document payload contains unsafe URL metadata
- **GIVEN** a document create/update payload contains URL-like values with credentials, tokens, signed query parameters, or object-storage details
- **WHEN** Opentu sanitizes the payload for creative document sync
- **THEN** those values SHALL be rejected or stripped before persistence
- **AND** no sanitized status message SHALL include the secret-bearing original value

### Requirement: Hydrate Cloud Asset Refs On Remote Document Load

The system SHALL hydrate same-origin creative cloud asset refs back into local cache URLs before saving or importing a remote creative document locally.

#### Scenario: Remote document contains cloud asset refs
- **GIVEN** a remote creative document snapshot contains `/creative/api/assets/:id/content` refs
- **WHEN** Opentu opens the document on another browser or device
- **THEN** Opentu SHALL fetch each ref through same-origin credentials
- **AND** cache the returned blob through `unifiedCacheService`
- **AND** rewrite the local imported board to content-addressed local virtual media URLs

#### Scenario: Hydration fails safely
- **GIVEN** a remote creative document contains a cloud asset ref
- **WHEN** hydration fails because of 401, 404, network failure, unsupported MIME, oversized content, or local quota failure
- **THEN** Opentu SHALL NOT save a board containing unresolved local-only or unsafe cloud refs
- **AND** SHALL record only a non-sensitive recoverable status

### Requirement: Preserve Document Conflict Semantics During Asset Sync

Creative asset upload SHALL NOT weaken existing creative document conflict protection.

#### Scenario: Asset upload succeeds before document conflict
- **GIVEN** Opentu uploads one or more assets for an outbound document update
- **AND** the document update then receives a 409 conflict from `new-api`
- **WHEN** Opentu handles the conflict
- **THEN** Opentu SHALL keep the local board and conflict-pending snapshot unchanged in local URL form
- **AND** SHALL NOT overwrite the remote document with stale local content because the asset upload succeeded

### Requirement: Pass Creative Asset Requests Through The Service Worker

The service worker SHALL pass `/creative/api/assets/*` requests through without storing private asset responses in app-shell, static, media, or virtual-media caches.

#### Scenario: Image asset request passes through
- **GIVEN** the browser requests `/creative/api/assets/:id/content` as an image destination
- **WHEN** the service worker handles the fetch
- **THEN** the request SHALL be forwarded to the network/session path
- **AND** the response SHALL NOT be written to static, app-shell, image, audio, video, or virtual-media caches

#### Scenario: Audio video and fetch asset requests pass through
- **GIVEN** the browser requests `/creative/api/assets/:id/content` as an audio, video, or ordinary fetch/XHR destination
- **WHEN** the service worker handles the fetch
- **THEN** the request SHALL be forwarded to the network/session path
- **AND** the response SHALL NOT be written to static, app-shell, image, audio, video, or virtual-media caches

### Requirement: Honor Asset Sync Rollout State

Opentu SHALL honor the embedded creative asset sync rollout state provided by `new-api` bootstrap/configuration.

#### Scenario: Asset sync is disabled
- **GIVEN** `assetSyncEnabled` is false
- **AND** the board contains local-only media or unsafe signed media values
- **WHEN** document cloud sync runs
- **THEN** Opentu SHALL keep the document sync pending or sanitized instead of saving a broken remote document
- **AND** SHALL NOT attempt creative asset upload or hydration

#### Scenario: Asset sync is enabled
- **GIVEN** `assetSyncEnabled` is true
- **WHEN** the board contains supported local image, audio, or video media values
- **THEN** Opentu SHALL prepare, upload, rewrite, and hydrate those values through the creative asset sync pipeline
