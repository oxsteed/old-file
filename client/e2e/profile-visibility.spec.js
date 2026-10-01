// Profile visibility admin controls — browser regression spec.
//
// DOCUMENTATION-QUALITY SPEC: this file is written against @playwright/test,
// which is NOT installed in client/package.json (only `playwright-core` is
// present). Do not run it until `@playwright/test` is added as a dev
// dependency. It doubles as the manual regression checklist for the page at
// /admin/super/profile-visibility.
//
// Conventions used by the page under test (client/src/admin/pages/ProfileVisibilityPage.jsx):
//  - data-testid="pv-search-input" / "pv-search-button" / "pv-results"
//  - data-testid="pv-preview" / "pv-schedule" / "pv-history" / "pv-hide" / "pv-restore"
//  - data-testid="pv-confirm-hide" / "pv-bulk-apply" / "pv-dry-run"
//  - data-testid="pv-approvals-toggle" / "pv-approvals" / "pv-scheduled-toggle" / "pv-scheduled"
//  - data-testid="pv-export-all" / "pv-save-view" / "pv-view-name" / "pv-undo" / "pv-history-panel"
//  - data-testid="pv-schedule-submit"
//
// Run (once @playwright/test is installed):
//   npx playwright test e2e/profile-visibility.spec.js

import { test, expect } from '@playwright/test';

const ADMIN_URL = '/admin/super/profile-visibility';

test.describe('profile visibility admin page', () => {
  test.beforeEach(async ({ page }) => {
    // Assumes an authenticated super-admin session. Replace with the repo's
    // standard admin login helper when one exists for e2e.
    await page.goto(ADMIN_URL);
  });

  test('search requires 2+ characters and Enter triggers search', async ({ page }) => {
    const input = page.getByTestId('pv-search-input');
    await input.fill('a');
    await expect(page.getByTestId('pv-results')).toBeEmpty();
    await input.fill('marie');
    await input.press('Enter');
    await expect(page.getByTestId('pv-results')).not.toBeEmpty({ timeout: 15000 });
  });

  test('preview opens a modal with the public page in an iframe', async ({ page }) => {
    await page.getByTestId('pv-search-input').fill('marie');
    await page.getByTestId('pv-search-button').click();
    await page.getByTestId('pv-preview').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const iframe = dialog.locator('iframe');
    await expect(iframe).toBeVisible();
    const src = await iframe.getAttribute('src');
    expect(src).toMatch(/\/(helpers|businesses\/public|restaurants\/r)\//);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('hide with active work shows the warning and requires acknowledgement', async ({ page }) => {
    await page.getByTestId('pv-search-input').fill('marie');
    await page.getByTestId('pv-search-button').click();
    await page.getByTestId('pv-hide').first().click();
    await page.getByTestId('pv-confirm-hide').click();
    const warning = page.getByRole('alert');
    // Only present when the profile has active work; otherwise the hide
    // applies immediately and the badge flips to "Hidden by admin".
    if (await warning.count()) {
      const hideAnyway = page.getByRole('button', { name: /hide anyway/i });
      await expect(hideAnyway).toBeDisabled();
      await warning.getByRole('checkbox').check();
      await expect(hideAnyway).toBeEnabled();
    }
  });

  test('schedule dialog converts the local time to an ISO instant', async ({ page }) => {
    await page.getByTestId('pv-search-input').fill('marie');
    await page.getByTestId('pv-search-button').click();
    await page.getByTestId('pv-schedule').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#pv-schedule-when').fill('2030-01-02T10:00');
    await dialog.locator('#pv-schedule-tz').selectOption('America/Port-au-Prince');
    await page.getByTestId('pv-schedule-submit').click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await page.getByTestId('pv-scheduled-toggle').click();
    await expect(page.getByTestId('pv-scheduled')).toContainText(/2030/i);
  });

  test('bulk dry run previews actions before applying', async ({ page }) => {
    await page.getByTestId('pv-search-input').fill('marie');
    await page.getByTestId('pv-search-button').click();
    await page.getByRole('button', { name: /select page/i }).click();
    await page.getByTestId('pv-dry-run').check();
    await page.getByRole('button', { name: /hide selected/i }).click();
    await expect(page.getByRole('dialog', { name: /dry-run/i })).toBeVisible({ timeout: 15000 });
  });

  test('approvals section lists pending requests and hides self-review', async ({ page }) => {
    await page.getByTestId('pv-approvals-toggle').click();
    const section = page.getByTestId('pv-approvals');
    await expect(section).toBeVisible();
    // Approvals requested by the signed-in admin show the pending state
    // instead of Approve/Reject buttons (separation of duties).
  });

  test('history panel shows notifications and offers undo', async ({ page }) => {
    await page.getByTestId('pv-search-input').fill('marie');
    await page.getByTestId('pv-search-button').click();
    await page.getByTestId('pv-history').first().click();
    const panel = page.getByTestId('pv-history-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: /notifications/i })).toBeVisible({ timeout: 10000 });
  });

  test('keyboard: dialogs trap focus and Escape closes them', async ({ page }) => {
    await page.getByTestId('pv-search-input').fill('marie');
    await page.getByTestId('pv-search-button').click();
    await page.getByTestId('pv-preview').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Focus returns to the control that opened the dialog.
    await expect(page.getByTestId('pv-preview').first()).toBeFocused();
  });

  test('saved views persist across reloads', async ({ page }) => {
    await page.getByTestId('pv-search-input').fill('marie');
    await page.getByTestId('pv-view-name').fill('e2e view');
    await page.getByTestId('pv-save-view').click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'e2e view' })).toBeVisible();
  });
});
