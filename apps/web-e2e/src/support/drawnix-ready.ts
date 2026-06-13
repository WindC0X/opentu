import { expect, type Page } from '@playwright/test';

export const DEFAULT_DRAWNIX_READY_TIMEOUT_MS = 45_000;

export function drawnixReadyTimeoutMs(): number {
  const raw = process.env['DRAWNIX_READY_TIMEOUT_MS'];
  if (!raw) {
    return DEFAULT_DRAWNIX_READY_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DRAWNIX_READY_TIMEOUT_MS;
  }

  return parsed;
}

export async function waitForDrawnixReady(
  page: Page,
  timeout = drawnixReadyTimeoutMs()
) {
  const drawnix = page.locator('.drawnix');
  await expect(drawnix).toBeVisible({ timeout });
  return drawnix;
}
