// Regression: the Add Restaurant wizard must write the CURRENT billing defaults —
// per-order rates, ₹500 setup with status 'non_refundable', 15 welcome tokens.
// Bug this guards: root shared/billing-defaults.js shipped an abandoned ₹299
// monthly-plan model into dist/shared, so wizard-created outlets got billing with
// no rates/setup/tokens (costs.js masked it via DEFAULT_RATES fallback).
// Run: npx playwright test tests/wizard-billing.spec.js --project=chromium
// Hermetic: tunnel POSTs (update-password, bot provision) are stubbed; temp super
// user + created business are removed in finally.
const { test, expect } = require('@playwright/test');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'bot', 'node_modules', 'firebase-admin'));
const serviceAccount = require(path.join(__dirname, '..', 'bot', 'service-account.json'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
  });
}

const SUPREME = 'https://foodhubbie-supremeadmin.web.app';
const PASSWORD = 'E2eWizard!2026';

async function findBusinessByName(name) {
  const all = (await admin.database().ref('businesses').once('value')).val() || {};
  return Object.entries(all).find(([, v]) => v && v.name === name) || null;
}

test.describe('wizard billing regression', () => {
  test('Add Restaurant wizard writes correct billing defaults', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'desktop-only wizard regression');
    test.setTimeout(120000);

    const stamp = Date.now();
    const businessName = `WizardBillingE2E ${stamp}`;
    const email = `e2e-wizard-${stamp}@foodhubbie-test.dev`;
    let uid = null;
    let bid = null;

    try {
      // Temp super: claims for auth.js role gate, admins node for security rules.
      const user = await admin.auth().createUser({ email, password: PASSWORD, displayName: 'E2E Wizard Billing' });
      uid = user.uid;
      await admin.auth().setCustomUserClaims(uid, { isSuper: true });
      await admin.database().ref(`admins/${uid}`).set({ isSuper: true, email });

      // Hermetic: never create a real admin login or bot worker on EC2.
      const json = (body) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body });
      await page.route('**/api/admin/update-password*', json('{"ok":true}'));
      await page.route('**/api/bot/provision/**', json('{"ok":true}'));

      await page.goto(SUPREME);
      await page.waitForSelector('#email-input', { timeout: 30000 });
      await page.fill('#email-input', email);
      await page.fill('#password-input', PASSWORD);
      await page.click('#email-signin-form button[type="submit"]');
      await page.waitForSelector('#app-shell', { state: 'visible', timeout: 30000 });

      await page.evaluate(() => { location.hash = 'restaurants/onboard'; });
      await page.waitForSelector('#obw-business', { timeout: 30000 });

      // Step 1 — business details
      await page.fill('#obw-business', businessName);
      await page.fill('#obw-outlet', 'E2E Outlet');
      await page.fill('#obw-phone', '9876501234');
      await page.fill('#obw-email', 'e2e@example.com');
      await page.click('#onboard-submit');

      // Step 2 — plan (default Starter) + custom template (no menuBank writes)
      await page.waitForFunction(() => {
        const s = document.querySelector('#onboard-template');
        return s && [...s.options].some((o) => o.value === '');
      }, { timeout: 30000 });
      await page.selectOption('#onboard-template', '');
      await page.click('#onboard-submit');

      // Step 3 — admin login
      await page.fill('#obw-admin-email', `admin-${stamp}@foodhubbie-test.dev`);
      await page.fill('#obw-admin-pw', PASSWORD);
      await page.fill('#obw-admin-pw2', PASSWORD);
      await page.click('#onboard-submit');

      // Step 4 — WhatsApp (QR default) → Next
      await page.click('#onboard-submit');

      // Step 5 — review → Create restaurant
      await page.waitForSelector('#obw-review .obw-row', { timeout: 30000 });
      await page.click('#onboard-submit');

      // The DB write lands before any tunnel call — poll for it.
      const deadline = Date.now() + 30000;
      let biz = null;
      while (Date.now() < deadline && !biz) {
        biz = await findBusinessByName(businessName);
        if (!biz) await new Promise((r) => setTimeout(r, 1000));
      }
      expect(biz, 'wizard-created business should appear in RTDB').not.toBeNull();
      bid = biz[0];
      const outlets = biz[1].outlets || {};
      const oid = Object.keys(outlets)[0];
      expect(oid, 'outlet should exist').toBeTruthy();
      const billing = outlets[oid].billing || {};

      // The regression itself: stale monthly-plan model had none of this.
      expect(billing.monthlyRate).toBeUndefined();
      expect(billing.mode).toBe('per_order');
      expect(billing.rates).toEqual({ QR: 2, POS: 1, webview_delivery: 3, WA: 3, other: 2, promo: 1, commission1pct: 0.01 });
      expect(billing.setup).toMatchObject({ amount: 500, status: 'non_refundable' });
      expect(billing.tokens && billing.tokens.balance).toBe(15);
      expect(billing.tokenPacks && billing.tokenPacks.welcome && billing.tokenPacks.welcome.qty).toBe(15);
      expect(outlets[oid].settings && outlets[oid].settings.features && outlets[oid].settings.features.discountApproval).toBe(false);
      console.log(`[wizard-billing] ${bid}/${oid} billing OK — setup=${billing.setup.status} tokens=${billing.tokens.balance}`);
    } finally {
      if (!bid) {
        const orphan = await findBusinessByName(businessName).catch(() => null);
        if (orphan) bid = orphan[0];
      }
      if (bid) await admin.database().ref(`businesses/${bid}`).remove().catch(() => {});
      if (uid) {
        await admin.database().ref(`admins/${uid}`).remove().catch(() => {});
        await admin.auth().deleteUser(uid).catch(() => {});
      }
    }
  });
});
