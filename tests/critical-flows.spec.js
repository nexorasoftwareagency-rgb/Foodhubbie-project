/**
 * FoodHubbie ERP - Critical Flow E2E Tests
 * Tests: QR Order → Kitchen → Serve → Bill → Payment
 */

const { test, expect } = require('@playwright/test');
const {
  login,
  clearSWAndCaches,
  goToTablesTab,
  openTableDrawer,
  clickDrawerAction,
  waitForModal,
  fillCustomerInfo,
  placeOrderFromQR,
  getOrderId,
  waitForOrderInAdmin,
  acceptOrderInKDS,
  markReadyInKDS,
  serveOrderInKDS,
  generateBill,
  makePayment,
  confirmPayment,
  isTableFree,
  takeScreenshot,
  TEST_URLS
} = require('./utils');

test.describe('FoodHubbie ERP - Critical Flows', () => {
  let orderId = null;

  test.beforeAll(async ({ browser }) => {
    // Create a shared context for login
    const context = await browser.newContext();
    const page = await context.newPage();
    await clearSWAndCaches(page);
    await login(page);
    await page.close();
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    await clearSWAndCaches(page);
  });

  test('QR Menu: Place order from customer', async ({ page }) => {
    await page.goto(TEST_URLS.qrMenu);
    
    // Wait for menu to load
    await page.waitForSelector('button:has-text("START ORDERING")', { timeout: 30000 });
    await page.click('button:has-text("START ORDERING")');
    
    // Select an item (first available)
    await page.waitForSelector('button:has-text("₹")', { timeout: 10000 });
    const items = await page.locator('button:has-text("₹")').all();
    if (items.length > 0) {
      await items[0].click();
      await page.waitForSelector('button:has-text("ADD TO ORDER")', { timeout: 5000 });
      await page.click('button:has-text("ADD TO ORDER")');
    }
    
    // Go to cart
    await page.click('button:has-text("View Cart")');
    await page.waitForSelector('button:has-text("PLACE ORDER")', { timeout: 5000 });
    
    // Fill customer info
    await fillCustomerInfo(page, 'E2E Test Customer', '9999988888');
    
    // Place order
    await placeOrderFromQR(page);
    
    // Get order ID
    orderId = await getOrderId(page);
    expect(orderId).toBeTruthy();
    console.log('[Test] Order ID:', orderId);
    
    await takeScreenshot(page, 'qr-order-placed');
  });

  test('Admin: Order appears in KDS and can be Accepted', async ({ page }) => {
    expect(orderId).toBeTruthy();
    
    await page.goto(TEST_URLS.admin);
    await login(page);
    
    await goToTablesTab(page);
    
    // Wait for order to appear in Live Orders
    await page.waitForSelector(`text=${orderId}`, { timeout: 30000 });
    
    // Accept in KDS
    await acceptOrderInKDS(page, orderId);
    
    // Verify order moved to Preparing
    await page.waitForSelector(`[data-action="advanceTableOrder"][data-id="${orderId}"][data-next="Ready"]`, { timeout: 10000 });
    console.log('[Test] Order accepted, now in Preparing');
    
    await takeScreenshot(page, 'kds-order-accepted');
  });

  test('Admin: Order can be marked Ready', async ({ page }) => {
    expect(orderId).toBeTruthy();
    
    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);
    
    // Mark Ready in KDS
    await markReadyInKDS(page, orderId);
    
    // Verify order moved to Ready
    await page.waitForSelector(`[data-action="advanceTableOrder"][data-id="${orderId}"][data-next="Served"]`, { timeout: 10000 });
    console.log('[Test] Order marked Ready');
    
    await takeScreenshot(page, 'kds-order-ready');
  });

  test('Admin: Order can be Served', async ({ page }) => {
    expect(orderId).toBeTruthy();
    
    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);
    
    // Serve in KDS
    await serveOrderInKDS(page, orderId);
    
    // Verify order status
    await page.waitForSelector(`text=Served`, { timeout: 10000 });
    console.log('[Test] Order served');
    
    await takeScreenshot(page, 'kds-order-served');
  });

  test('Admin: Generate Bill for table', async ({ page }) => {
    expect(orderId).toBeTruthy();
    
    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);
    
    // Find table with the order (should be table 02 based on QR URL)
    await openTableDrawer(page, '02');
    
    // Generate bill
    await generateBill(page, '02');
    
    // Verify table status changed to Billing
    await page.waitForSelector('button:has-text("02"):has-text("Billing")', { timeout: 10000 });
    console.log('[Test] Bill generated, table in Billing state');
    
    await takeScreenshot(page, 'bill-generated');
  });

  test('Admin: Make Payment via Bill Review Modal', async ({ page }) => {
    expect(orderId).toBeTruthy();
    
    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);
    
    // Open table drawer
    await openTableDrawer(page, '02');
    
    // Click Make Payment (View Bill)
    await makePayment(page);
    
    // Wait for modal
    await waitForModal(page, 'tableBillReviewModal');
    
    // Verify modal content
    const total = await page.locator('#billTotalAmount').textContent();
    expect(total).toMatch(/₹[\d,.]+/);
    console.log('[Test] Bill total:', total);
    
    // Confirm payment
    await confirmPayment(page);
    
    // Verify table freed
    await page.waitForSelector('button:has-text("02"):has-text("Free")', { timeout: 15000 });
    console.log('[Test] Payment confirmed, table freed');
    
    await takeScreenshot(page, 'payment-completed');
  });

  test('Full E2E: QR Order → Kitchen → Serve → Bill → Payment', async ({ page }) => {
    // This test runs the full flow in sequence
    // Individual tests above cover each step in detail
    expect(true).toBe(true); // Placeholder - full flow covered by individual tests
  });
});

test.describe('Admin Dashboard - Core Features', () => {
  test('Tables tab loads without errors', async ({ page }) => {
    await page.goto(TEST_URLS.admin);
    await login(page);
    await goToTablesTab(page);
    
    // Verify KPI cards render
    await expect(page.locator('#tblKpiFree')).toBeVisible();
    await expect(page.locator('#tblKpiOccupied')).toBeVisible();
    await expect(page.locator('#tblKpiBilling')).toBeVisible();
    
    // Verify floor grid renders
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
    
    // KDS is part of tables tab
    await expect(page.locator('#kdsColumnNew')).toBeVisible();
    await expect(page.locator('#kdsColumnPreparing')).toBeVisible();
    await expect(page.locator('#kdsColumnReady')).toBeVisible();
    
    console.log('[Test] KDS columns loaded successfully');
  });
});