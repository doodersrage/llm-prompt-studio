import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ensureAuthenticated } from './helpers/auth';
import { seedGalleryFixture } from './helpers/gallery';
import { gotoStable } from './helpers/navigation';
import { dismissBlockingOverlays } from './helpers/overlays';

/**
 * Automated a11y smoke pass over a handful of key pages, using axe-core. This is
 * deliberately narrow, not a full site audit:
 *
 * - Only `critical` and `serious` impact violations fail the test. `moderate` /
 *   `minor` findings are real but noisy enough, on a UI this size, that asserting on
 *   them from day one would likely fail immediately on pre-existing issues unrelated
 *   to whatever change triggered the run — logged instead so they're visible without
 *   being blocking.
 * - Page selection favors the most custom/least "standard form" UI (Compose and
 *   Inpaint's canvas-driven interactions, Workflow editor's node graph) alongside the
 *   two highest-traffic pages (Generate, Gallery), since custom canvas/drag-and-drop
 *   surfaces are exactly where keyboard and screen-reader support tends to silently
 *   regress without a check like this one.
 *
 * Expand ROUTES as coverage proves out, and consider tightening the impact threshold
 * once the existing `moderate` backlog (if any) has been triaged.
 */

const ROUTES: Array<{ path: string; label: string }> = [
  { path: '/', label: 'Generate' },
  { path: '/gallery', label: 'Gallery' },
  { path: '/compose', label: 'Compose' },
  { path: '/inpaint', label: 'Inpaint' },
  { path: '/workflow-editor', label: 'Workflow editor' },
];

test.beforeEach(async ({ page }) => {
  await ensureAuthenticated(page);
});

for (const route of ROUTES) {
  test(`${route.label} (${route.path}) has no critical/serious a11y violations`, async ({
    page,
  }) => {
    if (route.path === '/gallery') {
      await seedGalleryFixture(page);
    }
    await gotoStable(page, route.path);
    await dismissBlockingOverlays(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      violation => violation.impact === 'critical' || violation.impact === 'serious'
    );
    const other = results.violations.filter(
      violation => violation.impact !== 'critical' && violation.impact !== 'serious'
    );

    if (other.length > 0) {
      console.log(
        `[a11y] ${route.label}: ${other.length} non-blocking (moderate/minor) violation(s) - ` +
          other.map(v => `${v.id} (${v.impact})`).join(', ')
      );
    }

    expect(
      blocking,
      blocking
        .map(v => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} node(s)\n${v.helpUrl}`)
        .join('\n\n')
    ).toEqual([]);
  });
}
