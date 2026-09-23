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
 * Find a table by number and return its button
 */
async function findTableButton(page, tableNumber) {
  const selector = `button:has-text("${tableNumber} ")`;
  await page.waitForSelector(selector, { timeout: 10000 });
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
  const selector = `[data-action="${action}"]`;
  await page.waitForSelector(selector, { timeout: 5000, state: 'visible' });
  await page.click(selector);
  await page.waitForTimeout(500);
}

/**
 * Wait for modal to appear
 */
async function waitForModal(page, modalId) {
  await page.waitForSelector(`#${modalId}.active`, { timeout: 10000 });
  console.log('[Utils] Modal opened:', modalId);
}

/**
 * Fill customer info in QR menu cart
 */
async function fillCustomerInfo(page, name, phone) {
  await page.fill('input[placeholder*="Rohan" i]', name);
  await page.fill('input[placeholder*="98765" i]', phone);
}

/**
 * Place order from QR menu
 */
async function placeOrderFromQR(page) {
  await page.click('button:has-text("PLACE ORDER")');
  await page.waitForSelector('text=Order Received', { timeout: 15000 });
  console.log('[Utils] Order placed successfully');
}

/**
 * Get order ID from QR menu confirmation
 */
async function getOrderId(page) {
  const orderIdEl = await page.locator('text=/#[A-Z0-9]{5,}/').first();
  const text = await orderIdEl.textContent();
  const match = text.match(/#[A-Z0-9]{5,}/);
  return match ? match[0].slice(1) : null;
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
  const text = await btn.textContent();
  return text.includes('Free');
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
  login,
  clearSWAndCaches,
  goToTablesTab,
  findTableButton,
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
  takeScreenshot
};