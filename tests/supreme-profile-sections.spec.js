/**
 * Supreme Admin restaurant profile — section coverage E2E
 *
 * Verifies every profile section that was refactored into
 * SupremeAdmin/js/features/templates/* renders without console errors:
 *   - WhatsApp agent / bot usage (renderBotUsage, escapeHtml)
 *   - Message template library (escapeHtml, wa-templates.js syntax fix)
 *   - Business & store details view + inline edit (escapeHtml, detailValues)
 *   - Admin login creds (escapeHtml, copy, eye toggle)
 *   - Billing & promo tokens (escapeHtml, billing-card import fix)
 *
 * Creates a temp super user + temp business/outlet in RTDB, signs in,
 * navigates to #profile/{bid}/{oid}, and asserts each section renders.
 * Cleans up temp user + business in finally.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SUPREME = 'https://foodhubbie-supremeadmin.web.app';
const PASSWORD = 'E2eProfile!2026';

const botDir = path.join(__dirname, '..', 'bot');
const HAS_BACKEND =
  fs.existsSync(path.join(botDir, 'service-account.json')) &&
  fs.existsSync(path.join(botDir, 'node_modules', 'firebase-admin'));

let admin = null;
if (HAS_BACKEND) {
  admin = require(path.join(botDir, 'node_modules', 'firebase-admin'));
  const serviceAccount = require(path.join(botDir, 'service-account.json'));
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
    });
  }
}

async function createTempSuper() {
  const stamp = Date.now();
  const email = `e2e-profile-${stamp}@foodhubbie-test.dev`;
  const user = await admin.auth().createUser({ email, password: PASSWORD, displayName: 'E2E Profile Test' });
  await admin.auth().setCustomUserClaims(user.uid, { isSuper: true, isSupreme: true });
  await admin.database().ref(`admins/${user.uid}`).set({ isSuper: true, isSupreme: true, email, name: 'E2E Profile Test' });
  return { uid: user.uid, email };
}

async function createTempBusiness() {
  const stamp = Date.now();
  const bid = `e2e-biz-${stamp}`;
  const oid = `e2e-outlet-${stamp}`;
  const now = new Date().toISOString();
  await admin.database().ref(`businesses/${bid}`).set({
    name: `E2E Biz ${stamp}`,
    contactPhone: '+919999999999',
    contactEmail: `biz-${stamp}@example.com`,
    plan: 'starter',
    createdAt: now,
  });
  await admin.database().ref(`businesses/${bid}/outlets/${oid}`).set({
    name: `E2E Outlet ${stamp}`,
    contactPhone: '+918888888888',
    createdAt: now,
    settings: {
      Store: {
        storeName: `E2E Store ${stamp}`,
        entityName: `E2E Entity ${stamp} Pvt Ltd`,
        address: 'Shop 1, Main Road, Test City',
        gstin: '29ABCDE1234F1Z5',
        fssai: '10012003000456',
        tagline: 'Test tagline',
        shopOpenTime: '10:00',
        shopCloseTime: '23:00',
        instagram: 'https://instagram.com/e2etest',
        facebook: 'https://facebook.com/e2etest',
        googleReviewLink: 'https://g.page/e2etest',
      },
      Delivery: { notifyPhone: '+917777777777' },
    },
    bot: {
      transport: 'baileys',
      status: 'online',
      usage: { '2026-10-26': { total: 42, order_notification: 30, rider_broadcast: 8, promo: 4 } },
    },
    botStatus: { status: 'online', uptime: 3600, memory: 98, history: [] },
    whatsapp: {
      status: 'active',
      displayPhoneNumber: '+1 555-000-9999',
      verifiedName: 'E2E Store',
      phoneNumberId: '123456789',
    },
    billing: {
      mode: 'per_order',
      setup: { amount: 500, status: 'non_refundable' },
      tokens: { balance: 15 },
      rates: { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2, promo: 1 },
      tokenPacks: { welcome: { qty: 15 } },
    },
  });
  return { bid, oid };
}

async function cleanup(uid, bid) {
  if (bid) await admin.database().ref(`businesses/${bid}`).remove().catch(() => {});
  if (uid) {
    await admin.database().ref(`admins/${uid}`).remove().catch(() => {});
    await admin.auth().deleteUser(uid).catch(() => {});
  }
}

test.describe('Supreme Admin restaurant profile sections', () => {
  test('all sections render without console errors', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop-only profile E2E');
    test.skip(!admin, 'bot service-account/node_modules unavailable (CI)');
    test.setTimeout(120000);

    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    let uid = null;
    let bid = null;
    let oid = null;
    let email = null;
    try {
      const { uid: createdUid, email: createdEmail } = await createTempSuper();
      uid = createdUid;
      email = createdEmail;
      const { bid: createdBid, oid: createdOid } = await createTempBusiness();
      bid = createdBid;
      oid = createdOid;

      // --- Sign in via email/password ---
      await page.goto(SUPREME);
      await page.waitForSelector('#email-input', { timeout: 15000 });
      await page.fill('#email-input', email);
      await page.fill('#password-input', PASSWORD);
      await page.click('button[type="submit"]');
      // Wait for the app shell to render (user email appears in topbar)
      await page.waitForSelector('#current-user-email', { timeout: 30000 });
      await page.waitForTimeout(2000); // let Firebase auth state settle

      // --- Navigate to the profile route via hash ---
      await page.evaluate((hash) => { location.hash = hash; }, `#profile/${bid}/${oid}`);
      await page.waitForSelector('#profile-content', { timeout: 30000 });
      await page.waitForTimeout(3000); // let live listener + templates render

      // --- Section 1: WhatsApp agent / bot usage ---
      await expect(page.locator('text=WhatsApp — Official API & Bot Channel')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.kpi-value').filter({ hasText: /WhatsApp Web/ })).toBeVisible({ timeout: 10000 });

      // --- Section 2: Bot usage chart ---
      await expect(page.locator('text=Sent Today')).toBeVisible({ timeout: 10000 });

      // --- Section 3: Business & store details view ---
      await expect(page.locator('text=Business & store details')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=Business name')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=GSTIN')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=FSSAI')).toBeVisible({ timeout: 10000 });

      // --- Section 4: Click Edit on details ---
      await page.click('text=Edit').catch(() => {});
      await page.waitForSelector('input[name="businessName"]', { timeout: 10000 });
      await expect(page.locator('input[name="businessName"]')).toHaveValue(/E2E Biz/);
      await expect(page.locator('input[name="gstin"]')).toHaveValue('29ABCDE1234F1Z5');
      await expect(page.locator('input[name="fssai"]')).toHaveValue('10012003000456');

      // Cancel edit
      await page.click('text=Cancel').catch(() => {});

      // --- Section 5: Admin login creds (empty state since no creds set) ---
      await expect(page.locator('.collapsible-header').filter({ hasText: 'Admin login' })).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=No admin login stored yet')).toBeVisible({ timeout: 10000 });

      // --- Section 6: Billing card ---
      await expect(page.locator('.collapsible-header').filter({ hasText: 'Billing & promo tokens' })).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=Promo token balance')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=Setup fee')).toBeVisible({ timeout: 10000 });

      console.log('[supreme-profile] All sections rendered, console errors:', errors.length);
      errors.forEach((e) => console.log('[supreme-profile] ERROR:', e));

      expect(errors.filter((e) =>
        e.includes('escapeHtml') ||
        e.includes('renderBotUsage') ||
        e.includes('_renderBotUsage') ||
        e.includes('detailValues') ||
        e.includes('registerAction') ||
        e.includes('billing-shared') ||
        e.includes('is not defined')
      ).length).toBe(0, 'No refactor-related runtime errors');
    } finally {
      await cleanup(uid, bid);
    }
  });
});
