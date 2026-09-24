/**
 * Test utilities and helpers for FoodHubbie ERP E2E tests
 */

const ADMIN_CREDENTIALS = {
  email: 'roshanipizza@gmail.com',
  password: 'Ns@9724649971'
};

const TEST_URLS = {
  admin: 'https://foodhubbie-admins.web.app',
  qrMenu: 'https://foodhubbie-qrmenu.web.app/?o=pizza&b=roshani-pizza&t=2135N2D5F5E3H6J4'
};

const FIREBASE_DB = 'https://foodhubbie-10-default-rtdb.firebaseio.com/businesses/roshani-pizza/outlets/pizza';

/**
 * Login to admin dashboard
 */
async function login(page) {
  await page.goto(TEST_URLS.admin);
  await page.waitForSelector('#loginEmail', { timeout: 30000 });

  await page.fill('#loginEmail', ADMIN_CREDENTIALS.email);
  await page.fill('#loginPassword', ADMIN_CREDENTIALS.password);
  await page.click('#loginBtn');

  // Wait for dashboard to load
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(2000); // Allow full initialization

  console.log('[Utils] Login successful');
}

/**
 * Clear service worker and caches
 */
async function clearSWAndCaches(page) {
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
  });
}

/**
 * Navigate to Tables tab
 */
async function goToTablesTab(page) {
  await page.click('button:has-text("Tables")');
  await page.waitForSelector('#tab-tables:not(.hidden)', { timeout: 10000 });
  await page.waitForTimeout(1000);
  console.log('[Utils] Navigated to Tables tab');
}

/**
 * Find a table card by number (title attr: "Table 02 — …")
 */
async function findTableButton(page, tableNumber) {
  const num = String(tableNumber).padStart(2, '0');
  const selector = `button[data-action="openTableDrawer"][title^="Table ${num}"]`;
  await page.waitForSelector(selector, { timeout: 15000 });
  return page.locator(selector).first();
}

/**
 * Open table drawer
 */
async function openTableDrawer(page, tableNumber) {
  const btn = await findTableButton(page, tableNumber);
  await btn.click();
  await page.waitForSelector('#tableDrawer.active', { timeout: 10000 });
  await page.waitForTimeout(500);
  console.log('[Utils] Opened table drawer for', tableNumber);
}

/**
 * Click a button in the drawer by data-action
 */
async function clickDrawerAction(page, action) {
  const selector = `#tableDrawer [data-action="${action}"]`;
  await page.waitForSelector(selector, { timeout: 5000, state: 'visible' });
  await page.click(selector);
  await page.waitForTimeout(500);
}

/**
 * Accept the showConfirm() modal (.dynamic-modal-overlay .btn-confirm)
 */
async function confirmDialog(page) {
  await page.waitForSelector('.dynamic-modal-overlay .btn-confirm', { timeout: 5000 });
  await page.click('.dynamic-modal-overlay .btn-confirm');
  await page.waitForTimeout(1000);
}

/**
 * Wait for modal to appear
 */
async function waitForModal(page, modalId) {
  await page.waitForSelector(`#${modalId}.active`, { timeout: 10000 });
  console.log('[Utils] Modal opened:', modalId);
}

/**
 * Free table N if it has an active session (cancel session → table free)
 * Safe to call when already free.
 */
async function freeTableIfOccupied(page, tableNumber) {
  await goToTablesTab(page);
  const freeBtn = page.locator(`button[data-action="openTableDrawer"][title^="Table ${tableNumber}"]`);
  await freeBtn.waitFor({ timeout: 15000 });
  const title = await freeBtn.getAttribute('title');
  if (/Free/i.test(title || '')) {
    console.log('[Utils] Table', tableNumber, 'already free');
    return;
  }
  await openTableDrawer(page, tableNumber);
  const cancelBtn = page.locator('#tableDrawer [data-action="cancelSessionForTable"]');
  if (await cancelBtn.count()) {
    await cancelBtn.click();
    await confirmDialog(page);
    await page.waitForTimeout(1500);
    console.log('[Utils] Freed table', tableNumber);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Fill customer info in QR menu cart (#checkoutName / #checkoutPhone)
 */
async function fillCustomerInfo(page, name, phone) {
  await page.fill('#checkoutName', name);
  await page.fill('#checkoutPhone', phone);
}

/**
 * Place order from QR menu
 */
async function placeOrderFromQR(page) {
  await page.click('#btnPlaceOrder');
  await page.waitForSelector('#trackingOrderId', { timeout: 20000 });
  await page.waitForFunction(() => {
    const el = document.getElementById('trackingOrderId');
    return el && /^#\d{6}-\d+/.test((el.textContent || '').trim());
  }, { timeout: 15000 });
  console.log('[Utils] Order placed successfully');
}

/**
 * Get unified display order id (DDMMYY-N, e.g. 240926-1) from tracking screen
 */
async function getOrderId(page) {
  const text = await page.locator('#trackingOrderId').textContent();
  const match = (text || '').match(/#(\d{6}-\d+)/);
  return match ? match[1] : null;
}

/**
 * Resolve full Firebase order key. For unified IDs the display IS the key.
 * Legacy push-keys fall back to a suffix match against orders.json (auth-gated).
 */
async function resolveFullOrderId(page, shortId) {
  if (!shortId) return null;
  if (/^\d{6}-\d+$/.test(shortId)) return shortId;
  const res = await page.request.get(`${FIREBASE_DB}/orders.json`);
  const orders = await res.json().catch(() => ({}));
  if (!orders) return null;
  const suffix = shortId.toUpperCase();
  const hit = Object.keys(orders).find(k => k.slice(-3).toUpperCase() === suffix);
  return hit || null;
}

/**
 * Wait for order to appear in admin
 */
async function waitForOrderInAdmin(page, orderId) {
  await page.goto(TEST_URLS.admin + '#/orders');
  await page.waitForSelector(`text=${orderId}`, { timeout: 30000 });
  console.log('[Utils] Order found in admin:', orderId);
}

/**
 * Accept order in KDS
 */
async function acceptOrderInKDS(page, orderId) {
  const selector = `[data-action="advanceTableOrder"][data-id="${orderId}"][data-next="Confirmed"]`;
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
  await page.waitForTimeout(1000);
  console.log('[Utils] Order accepted in KDS:', orderId);
}

/**
 * Mark order Ready in KDS
 */
async function markReadyInKDS(page, orderId) {
  const selector = `[data-action="advanceTableOrder"][data-id="${orderId}"][data-next="Ready"]`;
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
  await page.waitForTimeout(1000);
  console.log('[Utils] Order marked Ready:', orderId);
}

/**
 * Serve order in KDS
 */
async function serveOrderInKDS(page, orderId) {
  const selector = `[data-action="advanceTableOrder"][data-id="${orderId}"][data-next="Served"]`;
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
  await page.waitForTimeout(1000);
  console.log('[Utils] Order served:', orderId);
}

/**
 * Generate bill for table
 */
async function generateBill(page, tableNumber) {
  await clickDrawerAction(page, 'requestBillForTable');
  await page.waitForTimeout(1000);
  console.log('[Utils] Bill generated for table', tableNumber);
}

/**
 * Make payment for table
 */
async function makePayment(page) {
  await clickDrawerAction(page, 'makePaymentForTable');
  await page.waitForSelector('#tableBillReviewModal.active', { timeout: 10000 });
  await page.waitForTimeout(500);
  console.log('[Utils] Payment modal opened');
}

/**
 * Confirm payment in modal
 */
async function confirmPayment(page) {
  await page.click('#billConfirmBtn');
  await page.waitForTimeout(2000);
  console.log('[Utils] Payment confirmed');
}

/**
 * Check if table is free
 */
async function isTableFree(page, tableNumber) {
  const btn = await findTableButton(page, tableNumber);
  const title = await btn.getAttribute('title');
  return /Free/i.test(title || '');
}

/**
 * Take screenshot with timestamp
 */
async function takeScreenshot(page, name) {
  const fs = require('fs');
  const path = require('path');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test-results/screenshots/${name}-${timestamp}.png`;

  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await page.screenshot({ path: filename, fullPage: true });
  console.log('[Utils] Screenshot saved:', filename);
}

module.exports = {
  ADMIN_CREDENTIALS,
  TEST_URLS,
  FIREBASE_DB,
  login,
  clearSWAndCaches,
  goToTablesTab,
  findTableButton,
  openTableDrawer,
  clickDrawerAction,
  confirmDialog,
  waitForModal,
  freeTableIfOccupied,
  fillCustomerInfo,
  placeOrderFromQR,
  getOrderId,
  resolveFullOrderId,
  waitForOrderInAdmin,
  acceptOrderInKDS,
  markReadyInKDS,
  serveOrderInKDS,
  generateBill,
  makePayment,
  confirmPayment,
  isTableFree,
  takeScreenshot
};
