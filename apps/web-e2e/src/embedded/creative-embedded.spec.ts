/**
 * @tags creative-embedded
 * Local no-secrets smoke for the OpenTU build embedded by new-api under /creative/.
 *
 * Run with:
 *   CREATIVE_EMBEDDED_BASE_URL=http://localhost:<port>/creative/ pnpm e2e:creative-embedded
 */
import { test, expect } from '@playwright/test';
import { waitForDrawnixReady } from '../support/drawnix-ready';

const embeddedBaseURL = process.env['CREATIVE_EMBEDDED_BASE_URL'];

test.describe('@creative-embedded new-api /creative/ smoke', () => {
  test.skip(
    !embeddedBaseURL,
    'Set CREATIVE_EMBEDDED_BASE_URL=http://localhost:<port>/creative/ to run the embedded smoke.'
  );

  test('serves app shell and keeps API/relay paths out of SPA fallback', async ({
    page,
    request,
    baseURL,
  }) => {
    expect(baseURL, 'creative embedded project must have a baseURL').toBeTruthy();
    const creativeRoot = new URL(baseURL!);
    if (!creativeRoot.pathname.endsWith('/')) {
      creativeRoot.pathname = `${creativeRoot.pathname}/`;
    }
    expect(creativeRoot.pathname.endsWith('/creative/')).toBeTruthy();

    await page.goto(creativeRoot.toString());
    await expect(page).toHaveTitle(/Opentu|OpenTu/);
    await waitForDrawnixReady(page);

    const jsEntryRefs = await page
      .locator('script[src*="/creative/assets/"]')
      .evaluateAll((nodes) => nodes.map((node) => (node instanceof HTMLScriptElement ? node.src : '')));
    const cssEntryRefs = await page
      .locator('link[rel="stylesheet"][href*="/creative/assets/"]')
      .evaluateAll((nodes) => nodes.map((node) => (node instanceof HTMLLinkElement ? node.href : '')));
    expect(jsEntryRefs.length, 'embedded index must reference JS entry chunks under /creative/assets/').toBeGreaterThan(0);
    expect(cssEntryRefs.length, 'embedded index must reference CSS entry chunks under /creative/assets/').toBeGreaterThan(0);

    const badEntryRefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src], link[rel="stylesheet"][href]'))
        .map((node) =>
          node instanceof HTMLScriptElement
            ? node.getAttribute('src') ?? ''
            : node instanceof HTMLLinkElement
              ? node.getAttribute('href') ?? ''
              : ''
        )
        .filter((ref) => ref.startsWith('./assets/') || ref.startsWith('/assets/'))
    );
    expect(badEntryRefs, 'embedded index must not use standalone ./assets or /assets entry refs').toEqual([]);

    const apiBoundary = await request.get(new URL('api/bootstrap', creativeRoot).toString(), {
      headers: { Accept: 'application/json' },
    });
    await expectNonSpaBoundary(apiBoundary, '/creative/api/bootstrap');

    const relayWrongMethodBoundary = await request.get(new URL('relay/v1/chat/completions', creativeRoot).toString(), {
      headers: { Accept: 'application/json' },
    });
    await expectNonSpaBoundary(relayWrongMethodBoundary, 'GET /creative/relay/v1/chat/completions');

    const relayPostBoundary = await request.post(new URL('relay/v1/chat/completions', creativeRoot).toString(), {
      data: { model: 'creative-smoke-model', messages: [] },
      headers: { Accept: 'application/json' },
    });
    await expectNonSpaBoundary(relayPostBoundary, 'POST /creative/relay/v1/chat/completions');
  });
});

async function expectNonSpaBoundary(response: import('@playwright/test').APIResponse, path: string) {
  const body = await response.text();
  const contentType = response.headers()['content-type'] ?? '';
  const cacheControl = response.headers()['cache-control'] ?? '';

  expect(response.status(), `${path} should be handled by API/relay boundary`).not.toBe(200);
  expect(contentType, `${path} must not be served as the Creative SPA HTML`).not.toContain('text/html');
  expect(body.toLowerCase(), `${path} must not contain the Creative document shell`).not.toContain('<!doctype html');
  expect(body, `${path} must not contain the Creative root element`).not.toContain('id="root"');
  expect(cacheControl, `${path} should be private/no-store or no-cache at the embedded boundary`).toMatch(
    /no-store|no-cache/i
  );
}
