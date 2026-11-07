/**
 * POS (Walk-in) — Accessibility regression test
 * Tests the POS tab for WCAG 2.1 AA compliance
 */

const { test, expect } = require('@playwright/test');
const { login } = require('./utils');
const AxeBuilder = require('@axe-core/playwright').default;

test.describe('POS (Walk-in) — Accessibility', () => {
  test('POS tab passes axe-core accessibility scan', async ({ page }) => {
    await login(page);

    // Navigate to POS tab
    const posNav = page.locator('[data-action="switchTab"][data-tab="walkin"]');
    if (!(await posNav.isVisible())) {
      await page.locator('#mobileHamburger:visible').click();
      await page.waitForTimeout(500);
    }
    await posNav.click();
    await expect(page.locator('#tab-walkin')).toBeVisible();
    await page.waitForTimeout(2000); // Allow POS to fully load

    // Run axe-core scan
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Log violations for debugging
    if (accessibilityScanResults.violations.length > 0) {
      console.log('Accessibility violations found:');
      accessibilityScanResults.violations.forEach(violation => {
        console.log(`- ${violation.id}: ${violation.description}`);
        console.log(`  Impact: ${violation.impact}`);
        console.log(`  Nodes: ${violation.nodes.length}`);
        violation.nodes.forEach(node => {
          console.log(`  - Target: ${node.target.join(', ')}`);
        });
      });
    }

    // Expect no violations
    expect(accessibilityScanResults.violations).toHaveLength(0);
  });

  test('Category tabs have correct ARIA attributes', async ({ page }) => {
    await login(page);

    const posNav = page.locator('[data-action="switchTab"][data-tab="walkin"]');
    if (!(await posNav.isVisible())) {
      await page.locator('#mobileHamburger:visible').click();
      await page.waitForTimeout(500);
    }
    await posNav.click();
    await expect(page.locator('#tab-walkin')).toBeVisible();
    await page.waitForTimeout(2000);

    const tabsContainer = page.locator('#walkinCategoryTabs');
    await expect(tabsContainer).toBeVisible();

    // Check tablist role
    await expect(tabsContainer).toHaveAttribute('role', 'tablist');
    await expect(tabsContainer).toHaveAttribute('aria-label', 'POS Menu Categories');

    // Check each tab
    const tabs = page.locator('.category-tab[role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      await expect(tab).toHaveAttribute('role', 'tab');
      await expect(tab).toHaveAttribute('aria-controls', 'walkinDishGrid');
      // One tab should have aria-selected="true"
      const selected = await tab.getAttribute('aria-selected');
      expect(['true', 'false']).toContain(selected);
    }

    // Exactly one tab should be selected
    const selectedTabs = page.locator('.category-tab[aria-selected="true"]');
    await expect(selectedTabs).toHaveCount(1);

    // First tab should have tabindex="0", others "-1"
    const firstTab = tabs.first();
    await expect(firstTab).toHaveAttribute('tabindex', '0');
  });

  test('Dish grid has correct ARIA attributes', async ({ page }) => {
    await login(page);

    const posNav = page.locator('[data-action="switchTab"][data-tab="walkin"]');
    if (!(await posNav.isVisible())) {
      await page.locator('#mobileHamburger:visible').click();
      await page.waitForTimeout(500);
    }
    await posNav.click();
    await expect(page.locator('#tab-walkin')).toBeVisible();
    await page.waitForTimeout(2000);

    const dishGrid = page.locator('#walkinDishGrid');
    await expect(dishGrid).toBeVisible();

    // Check tabpanel role
    await expect(dishGrid).toHaveAttribute('role', 'tabpanel');
    await expect(dishGrid).toHaveAttribute('aria-labelledby');

    // Check dish buttons
    const dishButtons = page.locator('.pos-dish-btn-v4[role="button"][tabindex="0"]');
    const count = await dishButtons.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        const btn = dishButtons.nth(i);
        await expect(btn).toHaveAttribute('role', 'button');
        await expect(btn).toHaveAttribute('tabindex', '0');
        await expect(btn).toHaveAttribute('aria-label');
      }
    }

    // Out-of-stock items should have aria-disabled="true" and tabindex="-1"
    const oosButtons = page.locator('.pos-dish-btn-v4.is-out-of-stock[role="button"]');
    const oosCount = await oosButtons.count();
    for (let i = 0; i < oosCount; i++) {
      const btn = oosButtons.nth(i);
      await expect(btn).toHaveAttribute('aria-disabled', 'true');
      await expect(btn).toHaveAttribute('tabindex', '-1');
    }
  });

  test('Cart quantity controls have correct ARIA attributes', async ({ page }) => {
    await login(page);

    const posNav = page.locator('[data-action="switchTab"][data-tab="walkin"]');
    if (!(await posNav.isVisible())) {
      await page.locator('#mobileHamburger:visible').click();
      await page.waitForTimeout(500);
    }
    await posNav.click();
    await expect(page.locator('#tab-walkin')).toBeVisible();
    await page.waitForTimeout(2000);

    // Add an item to cart first
    const firstDish = page.locator('.pos-dish-btn-v4[role="button"][tabindex="0"]').first();
    if (await firstDish.count() > 0) {
      await firstDish.click();
      await page.waitForTimeout(500);

      // Click "Add to Cart" in modal
      const addBtn = page.locator('#posAddBtn');
      if (await addBtn.isVisible()) {
        await addBtn.click();
        await page.waitForTimeout(500);
      }
    }

    // Check cart quantity controls
    const qtyControls = page.locator('.qty-control-v4[role="group"]');
    const count = await qtyControls.count();
    if (count > 0) {
      const control = qtyControls.first();
      await expect(control).toHaveAttribute('role', 'group');
      await expect(control).toHaveAttribute('aria-label');

      const decreaseBtn = control.locator('button[data-val="-1"]');
      await expect(decreaseBtn).toHaveAttribute('aria-label', 'Decrease quantity');
      await expect(decreaseBtn).toHaveAttribute('aria-controls');

      const increaseBtn = control.locator('button[data-val="1"]');
      await expect(increaseBtn).toHaveAttribute('aria-label', 'Increase quantity');
      await expect(increaseBtn).toHaveAttribute('aria-controls');

      const qtyValue = control.locator('.qty-val[aria-live="polite"]');
      await expect(qtyValue).toHaveAttribute('aria-live', 'polite');
    }
  });

  test('Keyboard navigation works on dish grid', async ({ page }) => {
    await login(page);

    const posNav = page.locator('[data-action="switchTab"][data-tab="walkin"]');
    if (!(await posNav.isVisible())) {
      await page.locator('#mobileHamburger:visible').click();
      await page.waitForTimeout(500);
    }
    await posNav.click();
    await expect(page.locator('#tab-walkin')).toBeVisible();
    await page.waitForTimeout(2000);

    // Focus first dish button
    const firstDish = page.locator('.pos-dish-btn-v4[role="button"][tabindex="0"]').first();
    if (await firstDish.count() > 0) {
      await firstDish.focus();
      await expect(firstDish).toBeFocused();

      // ArrowRight should move to next dish
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      const secondDish = page.locator('.pos-dish-btn-v4[role="button"][tabindex="0"]').nth(1);
      await expect(secondDish).toBeFocused();

      // ArrowLeft should move back
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(100);
      await expect(firstDish).toBeFocused();
    }
  });

  test('Keyboard navigation works on category tabs', async ({ page }) => {
    await login(page);

    const posNav = page.locator('[data-action="switchTab"][data-tab="walkin"]');
    if (!(await posNav.isVisible())) {
      await page.locator('#mobileHamburger:visible').click();
      await page.waitForTimeout(500);
    }
    await posNav.click();
    await expect(page.locator('#tab-walkin')).toBeVisible();
    await page.waitForTimeout(2000);

    // Focus first category tab
    const firstTab = page.locator('.category-tab[role="tab"][tabindex="0"]').first();
    if (await firstTab.count() > 0) {
      await firstTab.focus();
      await expect(firstTab).toBeFocused();

      // ArrowRight should move to next tab and activate it
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(200);
      const secondTab = page.locator('.category-tab[role="tab"]').nth(1);
      await expect(secondTab).toBeFocused();
      await expect(secondTab).toHaveAttribute('aria-selected', 'true');
      await expect(firstTab).toHaveAttribute('aria-selected', 'false');
    }
  });
});