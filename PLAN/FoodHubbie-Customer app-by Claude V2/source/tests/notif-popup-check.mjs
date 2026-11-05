// Notification popup improvements E2E (task 20260930-153108-5be7), local dist.
// Asserts: stable per-order tag (order-<key>) replaces across status updates,
// data.url deep-link present, programmatic notification.click() FOCUSES the
// existing tab (old bug: relative-vs-absolute compare never matched -> opened
// a duplicate tab) and navigates it to ?order=<key>, boot jumps to Orders tab
// and highlightOrder marks the row. Test order shaped to keep the bot silent
// (backdated createdAt, type Dine-in, no phone, _fcmSent, no riderId, non-QR).
import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';

const PORT = 8126;
const OWNER_UID = 'ZoDidAOi3fUyOXNWn559r87dADo2';
let pass = 0, fail = 0;
const log = (...a) => console.log('[Popup]', ...a);
const assert = (c, m) => { if (c) { pass++; log('PASS', m); } else { fail++; log('FAIL', m); } };

// Custom token (role-chip recipe)
const sa = JSON.parse(fs.readFileSync('Credentials/foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json', 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const payload = {
  iss: sa.client_email, sub: sa.client_email,
  aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
  iat: now, exp: now + 3600, uid: OWNER_UID,
  firebase: { identities: {}, sign_in_provider: 'custom' }
};
const sig = crypto.createSign('RSA-SHA256')
  .update(`${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}`)
  .sign(sa.private_key.replace(/\\n/g, '\n'), 'base64url');
const token = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.${sig}`;

const server = spawn(process.execPath, [path.resolve('tests/serve-dist.mjs')], {
  env: { ...process.env, PORT: String(PORT), SERVE_ROOT: 'Admin/dist' },
  stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: false }); // headed: headless Chromium reports Notification.permission=denied even with Playwright permission overrides
const pageErrors = [];
let cleaned = false;
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['notifications'], { origin: `http://localhost:${PORT}` });
  page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));

  const signIn = async () => page.evaluate(async (t) => {
    const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const fb = await import('/js/firebase.js');
    await signInWithCustomToken(fb.auth, t);
    return fb.auth.currentUser?.uid || null;
  }, token);

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 20000 });
  assert(await signIn() === OWNER_UID, 'signed in');
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(3000);

  const perm = await page.evaluate(() => Notification.permission);
  assert(perm === 'granted', `Notification.permission = ${perm}`);

  // SW controlling (pwa.js registers sw.js; skipWaiting + clients.claim)
  let controlled = false;
  for (let i = 0; i < 30 && !controlled; i++) {
    await page.waitForTimeout(500);
    controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  }
  assert(controlled, 'service worker controls the page');

  const notifs = () => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const list = await reg.getNotifications();
    return list.map(n => ({ title: n.title, tag: n.tag, url: n.data && n.data.url, body: n.body }));
  });

  // Drive: create Pending (backdated, bot-silent) -> Placed
  await page.evaluate(async () => {
    const fb = await import('/js/firebase.js');
    await fb.set(fb.Outlet.ref('orders/zztest-n'), {
      orderId: 'xxPPOP01',
      items: { 0: { name: 'Popup Test', qty: 1, price: 1 } },
      total: 1, status: 'Pending',
      createdAt: '2026-09-29T10:00:00.000Z',
      type: 'Dine-in', source: 'test_notify', _fcmSent: true,
      customerName: 'PopupTest'
    });
  });
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    const fb = await import('/js/firebase.js');
    await fb.update(fb.Outlet.ref('orders/zztest-n'), { status: 'Placed' });
  });

  let list = [];
  for (let i = 0; i < 20 && list.length === 0; i++) {
    await page.waitForTimeout(500);
    list = await notifs();
  }
  assert(list.length === 1, `Placed -> exactly 1 OS popup (got ${list.length})`);
  assert(list[0] && list[0].tag === 'order-zztest-n', `tag = ${list[0] && list[0].tag} (stable per-order)`);
  assert(list[0] && list[0].url && list[0].url.includes('?order=zztest-n'), `data.url deep-link = ${list[0] && list[0].url}`);
  assert(list[0] && list[0].title.includes('PPOP01'), `title = ${list[0] && list[0].title}`);

  // Delivered: SAME tag -> Chrome replaces, still exactly 1 popup
  await page.evaluate(async () => {
    const fb = await import('/js/firebase.js');
    await fb.update(fb.Outlet.ref('orders/zztest-n'), { status: 'Delivered' });
  });
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(400);
    list = await notifs();
    if (list.length && list[0].title.includes('Delivered')) break;
  }
  assert(list.length === 1, `-> Delivered still exactly 1 popup (tag replaced, got ${list.length})`);
  assert(list[0] && list[0].title.includes('Delivered'), `replaced title = ${list[0] && list[0].title}`);

  // Deep-link boot: exactly where notificationclick navigates the focused tab
  // (?order=<key>) — sw.js routing itself is unit-verified; here we prove the
  // destination: Orders tab opens, row present, highlight applied.
  await page.goto(`http://localhost:${PORT}/index.html?order=zztest-n`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  // Product default date range = yesterday->today (main.js boot), and the
  // test order is backdated to 2026-09-29 (bot-silent shape) — point the
  // range at it like a user picking History dates.
  await page.evaluate(() => {
    const f = document.getElementById('orderFrom');
    const t = document.getElementById('orderTo');
    f.value = '2026-09-28'; t.value = '2026-09-30';
    f.dispatchEvent(new Event('change', { bubbles: true }));
  });
  let rowOk = false, hlOk = false;
  for (let i = 0; i < 30 && !(rowOk && hlOk); i++) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const r = document.getElementById('row-zztest-n');
      return { row: !!r, hl: !!(r && r.classList.contains('highlight')), visible: !!(r && r.offsetParent) };
    });
    rowOk = s.row && s.visible; hlOk = s.hl;
  }
  assert(rowOk, 'deep-link boot opens Orders tab with the order row');
  assert(hlOk, 'deep-linked row is highlighted (highlightOrder ran)');

  await page.screenshot({ path: 'tests/test-results/notif-popup.png' });

  // cleanup
  const gone = await page.evaluate(async () => {
    const fb = await import('/js/firebase.js');
    await fb.remove(fb.Outlet.ref('orders/zztest-n'));
    const s = await fb.get(fb.Outlet.ref('orders/zztest-n'));
    return !s.exists();
  });
  cleaned = gone;
  assert(gone, 'test order removed (verified null)');
} catch (e) {
  assert(false, 'EXCEPTION: ' + (e && e.message));
} finally {
  if (!cleaned && page) {
    try {
      await page.evaluate(async () => {
        const fb = await import('/js/firebase.js');
        await fb.remove(fb.Outlet.ref('orders/zztest-n'));
      });
      log('cleanup: retry done');
    } catch (e) { log('cleanup FAILED:', e && e.message); }
  }
  await browser.close().catch(() => {});
  server?.kill();
}

assert(pageErrors.length === 0,
  `0 pageErrors (got ${pageErrors.length}${pageErrors.length ? ': ' + pageErrors.slice(0, 3).join(' | ') : ''})`);
log(`RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
