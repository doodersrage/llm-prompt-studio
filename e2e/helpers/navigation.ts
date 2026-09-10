import { expect, type Page } from '@playwright/test';
import { dismissBlockingOverlays } from './overlays';

/** Navigate with retries for transient next-dev / Fast Refresh aborts. */
export async function gotoStable(
  page: Page,
  path: string,
  options?: { waitUntil?: 'load' | 'domcontentloaded' | 'commit' | 'networkidle' }
): Promise<void> {
  const waitUntil = options?.waitUntil ?? 'domcontentloaded';
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil });
      // Sync/welcome modals often mount after first paint and block clicks.
      await dismissBlockingOverlays(page);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/ERR_ABORTED|interrupted/i.test(message) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(250 * (attempt + 1));
    }
  }
  throw lastError;
}

/** Expand Settings essentials so advanced ComfyUI sections are in the DOM. */
export async function revealFullSettings(page: Page): Promise<void> {
  // Prefer the settings shell nav — the page title can remount during tab switches.
  const nav = page.getByRole('navigation', { name: /Settings sections/i });
  const heading = page.getByRole('heading', { name: /Settings & Health/i });
  if (await nav.isVisible({ timeout: 5_000 }).catch(() => false)) {
    // already on settings
  } else {
    await expect(heading).toBeVisible({ timeout: 30_000 });
  }
  // Sidebar control is in the parent Settings shell (available before the ComfyUI tab hydrates).
  const sidebar = page.getByRole('button', { name: /All settings/i });
  if (await sidebar.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await sidebar.click({ force: true }).catch(async () => {
      await sidebar.click();
    });
    return;
  }
  const comfy = page.getByRole('button', { name: /Show all ComfyUI settings/i });
  if (await comfy.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await comfy.click({ force: true }).catch(async () => {
      await comfy.click();
    });
  }
}

/** Open the ComfyUI settings tab after essentials may have hidden it. */
export async function openComfyUiSettingsTab(page: Page): Promise<void> {
  await revealFullSettings(page);
  const tab = page
    .getByRole('navigation', { name: /Settings sections/i })
    .locator('button.ui-settings-tab')
    .filter({ hasText: /^ComfyUI/ });
  if (!(await tab.isVisible({ timeout: 5_000 }).catch(() => false))) {
    // Still wait for the connection hub when deep-linked — tab chrome can lag.
    await expect(page.locator('#settings-comfyui-connection').first())
      .toBeVisible({
        timeout: 30_000,
      })
      .catch(() => undefined);
    return;
  }
  // Clicking an already-active tab rewrites the URL without `section` and can
  // collapse essentials, hiding Checkpoint map again.
  if ((await tab.getAttribute('aria-current')) !== 'page') {
    await tab.click({ force: true }).catch(async () => {
      await tab.click();
    });
    // Tab remount can detach the button mid-click — wait for shell to settle.
    await expect(page.getByRole('navigation', { name: /Settings sections/i })).toBeVisible({
      timeout: 15_000,
    });
  }
  // Dynamic ComfyUI panel mounts after the shell; connection is always essentials.
  // Strict mode: React Strict/dev remounts can briefly leave two hubs in the DOM.
  await expect(page.locator('#settings-comfyui-connection').first()).toBeVisible({
    timeout: 30_000,
  });
}
