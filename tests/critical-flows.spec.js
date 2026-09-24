/**
 * FoodHubbie ERP - Critical Flow E2E Tests
 * Tests: QR Order → Kitchen → Serve → Bill → Payment
 * Plus invoice-breakdown / print-customer-data fix verification.
 */

const { test, expect } = require('@playwright/test');
const {
  login,
  clearSWAndCaches,
  goToTablesTab,
  openTableDrawer,
  clickDrawerAction,
  confirmDialog,
  waitForModal,
  freeTableIfOccupied,
  fillCustomerInfo,
  placeOrderFromQR,
  getOrderId,
  resolveFullOrderId,
  acceptOrderInKDS,
  markReadyInKDS,
  serveOrderInKDS,
  generateBill,
  makePayment,
  confirmPayment,
  takeScreenshot,
  TEST_URLS
} = require('./utils');

const TABLE = '02';

test.describe('FoodHubbie ERP - Critical Flows', () => {
  let orderId = null;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await clearSWAndCaches(page);
    await login(page);
    // Reset table so QR boot shows welcome (not Split/Share or billing-blocked)
    await freeTableIfOccupied(page, TABLE);
    await page.close();
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await clearSWAndCaches(page);
  });

  test('QR Menu: Place order from customer', async ({ page }) => {
    await page.goto(TEST_URLS.qrMenu);

    // Boot may show welcome OR group-choice if another guest joined mid-reset
    const welcomeBtn = page.locator('#btnStartOrdering');
    const ownGroupBtn = page.locator('#btnStartOwnGroup');
    await Promise.race([
      welcomeBtn.waitFor({ state: 'visible', timeout: 30000 }),
      ownGroupBtn.waitFor({ state: 'visible', timeout: 30000 })
    ]);
    if (await ownGroupBtn.isVisible().catch(() => false)) {
      await ownGroupBtn.click();
    } else {
      await welcomeBtn.click();
    }

    // Menu: open first dish card
    await page.waitForSelector('.dish-card', { timeout: 15000 });
    await page.locator('.dish-card').first().click();

    // Customize → ADD TO ORDER
    await page.waitForSelector('#btnAddToOrder', { state: 'visible', timeout: 10000 });
    await page.click('#btnAddToOrder');

    // Sticky cart bar → cart screen
    await page.waitForSelector('#btnViewCartBar', { state: 'visible', timeout: 10000 });
    await page.click('#btnViewCartBar');
    await page.waitForSelector('#btnPlaceOrder', { state: 'visible', timeout: 10000 });

    await fillCustomerInfo(page, 'E2E Test Customer', '9999988888');
    await placeOrderFromQR(page);

    const shortId = await getOrderId(page);
    expect(shortId).toBeTruthy();
    orderId = await resolveFullOrderId(page, shortId);
    expect(orderId).toBeTruthy();
    console.log('[Test] Order ID:', orderId);

    await takeScreenshot(page, 'qr-order-placed');
  });

  test('Admin: Order appears in KDS and can be Accepted', async ({ page }) => {
    expect(orderId).toBeTruthy();

    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);

    await page.waitForSelector(`[data-action="advanceTableOrder"][data-id="${orderId}"]`, { timeout: 30000 });
    await acceptOrderInKDS(page, orderId);

    await page.waitForSelector(`[data-action="advanceTableOrder"][data-id="${orderId}"][data-next="Ready"]`, { timeout: 10000 });
    console.log('[Test] Order accepted, now in Preparing');

    await takeScreenshot(page, 'kds-order-accepted');
  });

  test('Admin: Order can be marked Ready', async ({ page }) => {
    expect(orderId).toBeTruthy();

    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);

    await markReadyInKDS(page, orderId);
    await page.waitForSelector(`[data-action="advanceTableOrder"][data-id="${orderId}"][data-next="Served"]`, { timeout: 10000 });
    console.log('[Test] Order marked Ready');

    await takeScreenshot(page, 'kds-order-ready');
  });

  test('Admin: Order can be Served', async ({ page }) => {
    expect(orderId).toBeTruthy();

    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);

    await serveOrderInKDS(page, orderId);
    await page.waitForSelector(`text=Served`, { timeout: 10000 });
    console.log('[Test] Order served');

    await takeScreenshot(page, 'kds-order-served');
  });

  test('Admin: Generate Bill for table', async ({ page }) => {
    expect(orderId).toBeTruthy();

    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);

    await openTableDrawer(page, TABLE);
    await generateBill(page, TABLE);

    // Table card should leave Free/occupied → billing
    const card = page.locator(`button[data-action="openTableDrawer"][title^="Table ${TABLE}"]`);
    await expect(card).toHaveAttribute('title', /Billing/i, { timeout: 15000 });
    console.log('[Test] Bill generated, table in Billing state');

    await takeScreenshot(page, 'bill-generated');
  });

  test('Admin: Bill invoice breakdown + contact (fix verification)', async ({ page }) => {
    expect(orderId).toBeTruthy();

    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);

    await openTableDrawer(page, TABLE);
    await makePayment(page);
    await waitForModal(page, 'tableBillReviewModal');

    // LEFT invoice panel
    await expect(page.locator('#billInvoiceSummary')).toBeVisible();
    const summaryHtml = await page.locator('#billInvoiceSummary').innerHTML();
    expect(summaryHtml).toMatch(/Subtotal|Food/i);
    expect(summaryHtml).toMatch(/GST|Tax/i); // order-time tax rows
    expect(summaryHtml).toMatch(/Total/i);

    // RIGHT summary rows
    await expect(page.locator('#billSummarySubtotal')).toBeVisible();
    const taxRows = page.locator('#billSummaryTaxRows .bill-summary-row');
    expect(await taxRows.count()).toBeGreaterThan(0);

    const subtotalText = await page.locator('#billSummarySubtotal').textContent();
    const totalText = await page.locator('#billTotalAmount').textContent();
    const parse = (s) => Number(String(s).replace(/[^\d.]/g, '')) || 0;
    expect(parse(totalText)).toBeGreaterThan(0);
    expect(parse(subtotalText)).toBeGreaterThan(0);
    expect(parse(totalText)).toBeGreaterThanOrEqual(parse(subtotalText));

    // Contact from tableSessionsContact (customer name on invoice header)
    const label = await page.locator('#billInvoiceTableLabel').textContent();
    expect(label).toContain('E2E Test Customer');

    console.log('[Test] Invoice breakdown OK —', subtotalText, '→', totalText);
    await takeScreenshot(page, 'invoice-breakdown');

    await page.click('[data-action="closeTableBillReview"]').catch(() => {});
    await page.waitForTimeout(500);
  });

  test('Admin: Make Payment via Bill Review Modal', async ({ page }) => {
    expect(orderId).toBeTruthy();

    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);

    await openTableDrawer(page, TABLE);
    await makePayment(page);
    await waitForModal(page, 'tableBillReviewModal');

    const total = await page.locator('#billTotalAmount').textContent();
    expect(total).toMatch(/₹[\d,.]+/);
    console.log('[Test] Bill total:', total);

    await confirmPayment(page);

    // Free table after payment (close session if button present)
    const closeBtn = page.locator('#tableDrawer [data-action="closeSessionForTable"]');
    if (await closeBtn.count()) {
      await closeBtn.click();
      await confirmDialog(page).catch(() => {});
      await page.waitForTimeout(1000);
    }

    await page.waitForFunction(
      (num) => {
        const btn = document.querySelector(`button[data-action="openTableDrawer"][title^="Table ${num}"]`);
        return btn && /Free/i.test(btn.getAttribute('title') || '');
      },
      TABLE,
      { timeout: 20000 }
    );
    console.log('[Test] Payment confirmed, table freed');

    await takeScreenshot(page, 'payment-completed');
  });
});

test.describe('Admin Dashboard - Core Features', () => {
  test('Tables tab loads without errors', async ({ page }) => {
    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);

    await expect(page.locator('#tblKpiFree')).toBeVisible();
    await expect(page.locator('#tblKpiOccupied')).toBeVisible();
    await expect(page.locator('#tblKpiBilling')).toBeVisible();
    await expect(page.locator('#tableManagementGrid')).toBeVisible();

    console.log('[Test] Tables tab loaded successfully');
  });

  test('Orders tab loads without errors', async ({ page }) => {
    await page.goto(TEST_URLS.admin);
    await login(page);

    await page.click('button:has-text("Orders")');
    await page.waitForSelector('#tab-orders:not(.hidden)', { timeout: 10000 });

    await expect(page.locator('#orderSearch')).toBeVisible();
    console.log('[Test] Orders tab loaded successfully');
  });

  test('KDS tab loads without errors', async ({ page }) => {
    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);

    await expect(page.locator('#kdsColumnNew')).toBeVisible();
    await expect(page.locator('#kdsColumnPreparing')).toBeVisible();
    await expect(page.locator('#kdsColumnReady')).toBeVisible();

    console.log('[Test] KDS columns loaded successfully');
  });
});
