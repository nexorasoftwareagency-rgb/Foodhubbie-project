/**
 * Promotions tab — ARIA tab semantics (Pending-Work P9).
 *
 * The mode switcher and the campaign switcher both use role="tablist"/"tab",
 * so assistive tech only knows which one is active if aria-selected is kept in
 * sync with the .active class. This was marked fixed once while still missing,
 * so it gets a regression test.
 */

const { test, expect } = require('@playwright/test');
const { login } = require('./utils');

test.describe('Promotions tab — ARIA tab semantics', () => {
  test('mode + campaign tabs keep aria-selected in sync and aria-controls resolvable', async ({ page }) => {
    await login(page);

    // On mobile the sidebar is a drawer: the Promotions nav button only exists
    // inside it, so open the hamburger first (desktop header is display:none).
    const promoNav = page.locator('[data-action="switchTab"][data-tab="promotions"]');
    if (!(await promoNav.isVisible())) {
      await page.locator('#mobileHamburger:visible').click();
      await page.waitForTimeout(500);
    }
    await promoNav.click();
    await expect(page.locator('#tab-promotions')).toBeVisible();

    const nowPill = page.locator('.promo-mode-pill[data-mode="now"]');
    const schedPill = page.locator('.promo-mode-pill[data-mode="schedule"]');

    // initial state comes from the markup
    await expect(nowPill).toHaveAttribute('aria-selected', 'true');
    await expect(schedPill).toHaveAttribute('aria-selected', 'false');

    // switching modes must move aria-selected with the .active class
    await schedPill.click();
    await expect(schedPill).toHaveAttribute('aria-selected', 'true');
    await expect(nowPill).toHaveAttribute('aria-selected', 'false');
    await expect(schedPill).toHaveAttribute('aria-controls', 'promoScheduleBox');
    await expect(page.locator('#promoScheduleBox')).toBeVisible();

    await nowPill.click();
    await expect(nowPill).toHaveAttribute('aria-selected', 'true');
    await expect(schedPill).toHaveAttribute('aria-selected', 'false');

    // campaign switcher: every tab's aria-controls must resolve to a tabpanel
    const tabIds = await page
      .locator('.promo-campaign-tab')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-controls')));
    expect(tabIds).toEqual(['promoActivePane', 'promoHistoryPane', 'promoNotificationsPane']);
    for (const id of tabIds) {
      await expect(page.locator('#' + id)).toHaveCount(1);
      await expect(page.locator('#' + id)).toHaveAttribute('role', 'tabpanel');
    }

    const activeTab = page.locator('.promo-campaign-tab[data-panel="active"]');
    const historyTab = page.locator('.promo-campaign-tab[data-panel="history"]');

    await historyTab.click();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    await expect(activeTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#promoHistoryPane')).toBeVisible();
    await expect(page.locator('#promoActivePane')).toBeHidden();

    await activeTab.click();
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
    await expect(historyTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#promoActivePane')).toBeVisible();
  });
});
