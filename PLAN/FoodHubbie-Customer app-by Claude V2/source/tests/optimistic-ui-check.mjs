// Optimistic UI check: an admin status tap (Placed -> Confirmed) must flip
// the row BEFORE the listener echo (write round-trip), then settle to server
// truth. Dine-in + no phone keeps the bot silent; createdAt = now sits inside
// the default date range, so no date inputs needed. Headless: no OS
// notification involved here.
import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';

const PORT = 8129;
const OWNER_UID = 'ZoDidAOi3fUyOXNWn559r87dADo2';
const KEY = 'zztest-opt';
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

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`[Optimistic] PASS ${msg}`); }
  else { fail++; console.log(`[Optimistic] FAIL ${msg}`); }
};

const server = spawn(process.execPath, [path.resolve('tests/serve-dist.mjs')], {
  env: { ...process.env, PORT: String(PORT), SERVE_ROOT: 'Admin/dist' }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));

let cleaned = false;
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 20000 });
  const uid = await page.evaluate(async (t) => {
    const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const fb = await import('/js/firebase.js');
    await signInWithCustomToken(fb.auth, t);
    return fb.auth.currentUser?.uid || null;
  }, token);
  assert(uid === OWNER_UID, 'signed in');
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(3000);

  await page.evaluate(async (key) => {
    const fb = await import('/js/firebase.js');
    await fb.set(fb.Outlet.ref(`orders/${key}`), {
      orderId: 'xxOPT01',
      items: { 0: { name: 'Opt Test', qty: 1, price: 1 } },
      total: 1, status: 'Placed', createdAt: new Date().toISOString(),
      type: 'Dine-in', source: 'test_opt', _fcmSent: true, customerName: 'OptTest'
    });
  }, KEY);

  await page.evaluate(async () => {
    const ui = await import('/js/ui.js');
    ui.switchTab('orders', true);
  });
  await page.waitForSelector(`#ordersTableFull .status-dropdown-trigger[data-id="${KEY}"]`, { timeout: 20000 });

  await page.click(`#ordersTableFull .status-dropdown-trigger[data-id="${KEY}"]`);
  await page.waitForSelector(`#ordersTableFull .status-opt[data-val="Confirmed"][data-id="${KEY}"]`, { timeout: 5000 });

  // Instrument + click in one synchronous block: t0, console hook for the
  // listener echo, then pick Confirmed. useMod('orders') is cached (orders tab
  // already loaded), so the optimistic apply runs in the microtask drain
  // before any network snapshot callback can interleave.
  const t0 = await page.evaluate((key) => {
    window.__snapTimes = [];
    window.__optRenders = [];
    window.__events = [];
    window.__chipAt = null;
    const sel = `#ordersTableFull .status-dropdown-trigger[data-id="${key}"]`;
    const mark = (what) => {
      const el = document.querySelector(sel);
      window.__events.push({ t: performance.now(), what, text: el ? (el.textContent || '').trim() : 'NO-ELEMENT' });
    };
    const orig = console.log;
    console.log = (...args) => {
      const s = String(args[0]);
      if (s.includes('[Orders]')) {
        if (s.includes('Received snapshot')) { window.__snapTimes.push(performance.now()); mark('snapshot'); }
        else if (s.includes('Rendering started') && s.includes('Snap: No')) window.__optRenders.push(performance.now());
        else window.__events.push({ t: performance.now(), what: 'log: ' + s.slice(0, 60), text: '' });
      }
      return orig.apply(console, args);
    };
    window.__chipPoll = setInterval(() => {
      const el = document.querySelector(sel);
      if (el && (el.textContent || '').includes('Confirmed') && window.__chipAt === null) window.__chipAt = performance.now();
    }, 5);
    window.__t0 = performance.now();
    document.querySelector(`#ordersTableFull .status-opt[data-val="Confirmed"][data-id="${key}"]`).click();
    mark('click-done');
    return window.__t0;
  }, KEY);

  let snapAt = null;
  for (let i = 0; i < 120 && snapAt === null; i++) {
    snapAt = await page.evaluate((t) => {
      const times = (window.__snapTimes || []).filter(x => x > t);
      return times.length ? times[0] : null;
    }, t0);
    if (snapAt === null) await page.waitForTimeout(50);
  }

  let optRenderAt = null;
  for (let i = 0; i < 60 && optRenderAt === null; i++) {
    optRenderAt = await page.evaluate((t) => {
      const times = (window.__optRenders || []).filter(x => x > t);
      return times.length ? times[0] : null;
    }, t0);
    if (optRenderAt === null) await page.waitForTimeout(25);
  }

  assert(optRenderAt !== null, 'optimistic render ran (renderOrders without snapshot)');
  assert(snapAt !== null, 'listener echo observed after click');
  if (optRenderAt !== null && snapAt !== null) {
    assert(optRenderAt < snapAt, `optimistic render BEFORE echo (render +${Math.round(optRenderAt - t0)}ms vs echo +${Math.round(snapAt - t0)}ms)`);
  }
  const chipPageAt = await page.evaluate(() => window.__chipAt);
  if (chipPageAt !== null && snapAt !== null) {
    console.log(`[Optimistic] info: page-side chip detect +${Math.round(chipPageAt - t0)}ms vs echo +${Math.round(snapAt - t0)}ms`);
  }
  const timeline = await page.evaluate((t) => (window.__events || []).map(e => ({ ms: Math.round(e.t - t), what: e.what, text: e.text })).slice(0, 40), t0);
  console.log('[Optimistic] timeline:', JSON.stringify(timeline));

  await page.waitForTimeout(600);
  const settled = await page.evaluate((key) => {
    const el = document.querySelector(`#ordersTableFull .status-dropdown-trigger[data-id="${key}"]`);
    return el ? el.textContent : null;
  }, KEY);
  assert(settled !== null && settled.includes('Confirmed'), `settled after echo still Confirmed (got "${settled}")`);

  const dbStatus = await page.evaluate(async (key) => {
    const fb = await import('/js/firebase.js');
    const s = await fb.get(fb.Outlet.ref(`orders/${key}`));
    return s.exists() ? s.val().status : null;
  }, KEY);
  assert(dbStatus === 'Confirmed', `server truth = ${dbStatus}`);

  await page.screenshot({ path: 'tests/test-results/optimistic-ui.png' });

  const gone = await page.evaluate(async (key) => {
    const fb = await import('/js/firebase.js');
    await fb.remove(fb.Outlet.ref(`orders/${key}`));
    const s = await fb.get(fb.Outlet.ref(`orders/${key}`));
    return !s.exists();
  }, KEY);
  cleaned = gone;
  assert(gone, 'test order removed (verified null)');
  assert(pageErrors.length === 0, `0 pageErrors (got ${pageErrors.length}${pageErrors[0] ? ': ' + pageErrors[0] : ''})`);
} catch (e) {
  assert(false, 'EXCEPTION: ' + (e && e.message));
  console.log(pageErrors.join('\n'));
} finally {
  if (!cleaned && page) {
    await page.evaluate(async (key) => {
      const fb = await import('/js/firebase.js');
      await fb.remove(fb.Outlet.ref(`orders/${key}`));
    }, KEY).catch(() => {});
  }
  await browser.close().catch(() => {});
  server?.kill();
}

console.log(`[Optimistic] RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
