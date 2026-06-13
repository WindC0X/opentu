# Creative Embed Deployment Notes

Opentu can run as the embedded Creative frontend for `new-api` browser-session routes.
The boundary is same-origin and session-based: `/creative/api/*` and `/creative/relay/v1/*` are served by `new-api`, while Opentu static assets may be self-hosted or loaded from a CDN.

## Backend contract

- `new-api` must register Creative API/relay routes locally even when `FRONTEND_BASE_URL` points to an external Opentu bundle.
- `CREATIVE_VIDEO_RELAY_ENABLED=false` by default; enable only after channel routing, billing, polling, and idempotency are configured.
- `CREATIVE_ASSET_SYNC_ENABLED=false` by default; production asset sync must use `CREATIVE_ASSET_STORAGE=s3-compatible` with complete private S3-compatible config.
- Creative asset refs stored in documents must remain same-origin relative URLs such as `/creative/api/assets/:assetId/content`; do not persist signed URLs, bucket URLs, or provider/private result URLs.

## Frontend contract

- Use the session-broker profile from `/creative/api/bootstrap` as the source of truth for `brokerBaseUrl`, capabilities, and asset sync availability.
- If `capabilities.videoRelayEnabled` is false, hide/filter video models and avoid setting video defaults.
- Video and Midjourney submits must provide stable idempotency keys; fail fast before `fetch` if a stable key is unavailable.
- Hydrate/import paths must sanitize persisted asset URLs before rendering or saving snapshots.

## Service Worker / CDN rules

| File | CDN | Same-origin server | Reason |
| --- | --- | --- | --- |
| `*.html` | no | yes | May contain runtime/session bootstrap wiring. |
| `sw.js` | no | yes | Service Worker scope must be same-origin. |
| `init.json` / runtime config | no | yes | Deployment-specific and not a public CDN artifact. |
| `manifest.json` / `version.json` / precache manifests | optional static copy only | yes, origin-first | Release metadata must not be runtime CDN rewrite targets. |
| `/creative/api/*` and `/creative/relay/v1/*` | no | yes (`new-api`) | Browser-session auth, CSRF/nonce, no-store responses. |
| Hashed `assets/*.js` / `assets/*.css` | yes | yes fallback | Static public bundles only. |
| Fonts / icons / logo / favicon | yes | yes fallback | Public static assets only. |

When using the hybrid CDN deployment, keep `sw.js`, HTML, runtime config, release metadata, and all Creative API/relay calls origin-first on the `new-api` origin. The npm/CDN package may include metadata copies for fallback/install use, but runtime rewrite should target only hashed static chunks and public static assets.

## Smoke checklist

1. `GET /creative/api/bootstrap` returns local JSON and `Cache-Control: private, no-store`; it must not redirect to `FRONTEND_BASE_URL`.
2. Missing browser session returns a controlled 401/403/404-style response without static CDN cache headers.
3. Asset upload returns only same-origin relative asset URLs.
4. A saved document snapshot contains no `http(s)://...X-Amz-Signature`, bucket URL, provider URL, or `data:` video payload.
5. Service Worker debug/log views do not print Creative relay credentials, nonce/CSRF headers, or upstream private URLs.
