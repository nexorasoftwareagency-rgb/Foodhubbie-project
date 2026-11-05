// Runtime verification of the d3cd notification dedupe (task 20260930-151341-c723).
// Signs into the LIVE Admin as the real owner via SA-minted custom token (role-chip recipe),
// drives test orders through Pending->Placed->Confirmed->Delivered and asserts:
//   0 on create(Pending), exactly 1 on INTO Placed, no dup on edits/non-transitions,
//   exactly 1 on INTO Delivered, 0 for backdated direct-Placed create,
//   0 after full page reload with existing Placed/Delivered orders (firstLoad gate).
// Test orders: backdated createdAt (bot child_added skips), type Dine-in + no phone
// (bot handleOrderStatusUpdate silent-skips), _fcmSent pre-set (FCM watcher skips),
// no riderId (rider push skips), source != QR (verifyQrOrderDiscount skips).
// Cleanup in finally: both nodes removed + verified gone.
import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';

const ADMIN_URL = 'https://foodhubbie-admins.web.app';
const OWNER_UID = 'ZoDidAOi3fUyOXNWn559r87dADo2';
let pass = 0, fail = 0;
const log = (...a) => console.log('[Dedupe]', ...a);
const assert = (c, m) => { if (c) { pass++; log('PASS', m); } else { fail++; log('FAIL', m); } };

// 0. Live bundle carries the d3cd fix (deployed orders.js, not stale).
// Dist is minified: property names (state.orderStatusSeen) survive, locals
// (prevStatus, firstLoad) get renamed - only grep minify-safe markers.
try {
  const asset = await (await fetch(ADMIN_URL + '/js/features/orders.js')).text();
  assert(asset.includes('orderStatusSeen') && !asset.includes('_lastNewOrder'),
    'live orders.js = d3cd build (orderStatusSeen property present, legacy _lastNewOrder gone)');
  const auth = await (await fetch(ADMIN_URL + '/js/auth.js')).text();
  assert(!auth.includes('initNewOrderNotifications') && !auth.includes('_lastNewOrder'),
    'live auth.js = d3cd build (duplicate initNewOrderNotifications gone)');
} catch (e) { assert(false, 'live asset fetch failed: ' + e.message); }

// 1. Mint custom token for owner (same shape as tests/role-chip-check.mjs)
const sa = JSON.parse(fs.readFileSync('Credentials/foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json', 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT' };
const payload = {
  iss: sa.client_email, sub: sa.client_email,
  aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
  iat: now, exp: now + 3600, uid: OWNER_UID,
  firebase: { identities: {}, sign_in_provider: 'custom' }
};
const sig = crypto.createSign('RSA-SHA256')
  .update(`${b64(header)}.${b64(payload)}`)
  .sign(sa.private_key.replace(/\\n/g, '\n'), 'base64url');
const token = `${b64(header)}.${b64(payload)}.${sig}`;

const signIn = async (page, t) => page.evaluate(async (tok) => {
  const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
  const fb = await import('/js/firebase.js');
  await signInWithCustomToken(fb.auth, tok);
  return fb.auth.currentUser?.uid || null;
}, t);

const browser = await chromium.launch();
const pageErrors = [];
const consoles = [];
let cleaned = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => consoles.push(m.text()));

  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 20000 });
  const uid = await signIn(page, token);
  assert(uid === OWNER_UID, `signed in as ${uid}`);
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(4000); // boot: auth.js calls initRealtimeListeners

  assert(consoles.some(c => c.includes('[Orders] Initializing listeners')), 'orders listeners attached at boot');
  const ordersPath = await page.evaluate(async () => (await import('/js/firebase.js')).Outlet.ref('orders').toString());
  log('orders path:', ordersPath);
  assert(ordersPath.includes('/businesses/roshani-pizza/outlets/pizza/orders'), 'listener path = roshani-pizza/pizza');

  // Notification counter: title marker in the sheet list (marker immune to real notifs)
  const count = () => page.evaluate(() => {
    const el = document.getElementById('notificationList');
    if (!el) return -1;
    return (el.textContent.match(/STA00\d/g) || []).length;
  });

  const mk = (key, orderId, status) => page.evaluate(async ({ key, orderId, status }) => {
    const fb = await import('/js/firebase.js');
    await fb.set(fb.Outlet.ref('orders/' + key), {
      orderId,
      items: { 0: { name: 'Notify Test', qty: 1, price: 1 } },
      total: 1, status,
      createdAt: '2026-09-29T10:00:00.000Z', // backdated: bot child_added isNewOrder=false
      type: 'Dine-in',                        // bot: silent skip (no phone, dine-in)
      source: 'test_notify',                  // not QR: verifyQrOrderDiscount skipped
      _fcmSent: true,                         // FCM watcher skips
      customerName: 'NotifyTest'
      // no phone / whatsappNumber / riderId on purpose
    });
    return true;
  }, { key, orderId, status });

  const upd = (key, patch) => page.evaluate(async ({ key, patch }) => {
    const fb = await import('/js/firebase.js');
    await fb.update(fb.Outlet.ref('orders/' + key), patch);
    return true;
  }, { key, patch });

  const del = (key) => page.evaluate(async (key) => {
    const fb = await import('/js/firebase.js');
    await fb.remove(fb.Outlet.ref('orders/' + key));
    const s = await fb.get(fb.Outlet.ref('orders/' + key));
    return !s.exists();
  }, key);

  // --- A: the real QR-like flow ---
  await mk('zztest-a', 'xxSTA001', 'Pending');
  await page.waitForTimeout(900);
  assert((await count()) === 0, 'create as Pending -> 0 notifications (child_added gate)');

  await upd('zztest-a', { status: 'Placed' });
  await page.waitForTimeout(1000);
  assert((await count()) === 1, 'Pending -> Placed = EXACTLY 1 notification');

  await upd('zztest-a', { total: 2 });
  await page.waitForTimeout(800);
  assert((await count()) === 1, 'edit while Placed (total 1->2) -> still 1 (no dup on non-status change)');

  await upd('zztest-a', { status: 'Confirmed' });
  await page.waitForTimeout(800);
  assert((await count()) === 1, 'Placed -> Confirmed -> still 1');

  await upd('zztest-a', { status: 'Delivered' });
  await page.waitForTimeout(1000);
  assert((await count()) === 2, '-> Delivered = EXACTLY 1 more (total 2)');

  // --- B: direct-Placed create while listening (isRecent gate) ---
  await mk('zztest-b', 'xxSTA002', 'Placed');
  await page.waitForTimeout(900);
  assert((await count()) === 2, 'backdated Placed created while live -> still 2 (isRecent gate)');

  // --- RELOAD: THE regression test (firstLoad must swallow existing orders) ---
  const snapsBefore = consoles.filter(c => c.includes('[Orders] Received snapshot')).length;
  await page.reload({ waitUntil: 'domcontentloaded' });
  try { await page.waitForSelector('.layout:not(.hidden)', { timeout: 15000 }); }
  catch {
    await page.waitForSelector('#loginEmail', { timeout: 15000 });
    await signIn(page, token);
    await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  }
  let snaps = snapsBefore;
  for (let i = 0; i < 40 && snaps < snapsBefore + 1; i++) {
    await page.waitForTimeout(500);
    snaps = consoles.filter(c => c.includes('[Orders] Received snapshot')).length;
  }
  assert(snaps >= snapsBefore + 1, 'orders snapshot received after reload (listeners live)');
  await page.waitForTimeout(1500);
  assert((await count()) === 0, 'RELOAD with existing Placed/Delivered test orders -> 0 notifications (firstLoad gate)');

  await page.screenshot({ path: 'tests/test-results/notify-dedupe.png' });

  // --- cleanup ---
  const okA = await del('zztest-a');
  const okB = await del('zztest-b');
  cleaned = okA && okB;
  assert(cleaned, 'test orders removed from DB (verified null)');
} catch (e) {
  assert(false, 'EXCEPTION: ' + (e && e.message));
} finally {
  if (!cleaned) {
    try {
      await page.evaluate(async () => {
        const fb = await import('/js/firebase.js');
        await fb.remove(fb.Outlet.ref('orders/zztest-a'));
        await fb.remove(fb.Outlet.ref('orders/zztest-b'));
      });
      log('cleanup: retry removal done');
    } catch (e) { log('cleanup FAILED:', e && e.message); }
  }
  await browser.close().catch(() => {});
}

assert(pageErrors.length === 0,
  `0 pageErrors (got ${pageErrors.length}${pageErrors.length ? ': ' + pageErrors.slice(0, 3).join(' | ') : ''})`);
log(`RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
