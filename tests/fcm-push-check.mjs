// Live FCM push check (task 20260930-153108-5be7): proves the REAL push
// path — admin-SDK send -> Chromium receives -> sw.js onBackgroundMessage
// shows the STYLED popup (tag order-<orderId>, deep-link data.url, icon).
// A generic auto-displayed popup (null tag/no data) = handler never fires;
// two popups = double display. Owner's stored fcmToken is captured first
// and restored afterwards (the test browser's token temporarily replaces
// it via the app's own setupAdminFCM -> storeToken).
import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';

const PORT = 8127;
const OWNER_UID = 'ZoDidAOi3fUyOXNWn559r87dADo2';
const TEST_KEY = 'zztest-push';
let pass = 0, fail = 0;
const log = (...a) => console.log('[Push]', ...a);
const assert = (c, m) => { if (c) { pass++; log('PASS', m); } else { fail++; log('FAIL', m); } };

// admin SDK (resolved from bot/, whose package.json owns firebase-admin)
const admin = createRequire(path.resolve('bot/package.json'))('firebase-admin');
if (!admin.apps.length) admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync('Credentials/foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json', 'utf8'))),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});
const tokenRef = admin.database().ref(`admins/${OWNER_UID}/fcmToken`);
const originalToken = (await tokenRef.once('value')).val();

// custom token (role-chip recipe)
const sa = JSON.parse(fs.readFileSync('Credentials/foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json', 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const hdr = { alg: 'RS256', typ: 'JWT' };
const payload = {
  iss: sa.client_email, sub: sa.client_email,
  aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
  iat: now, exp: now + 3600, uid: OWNER_UID,
  firebase: { identities: {}, sign_in_provider: 'custom' }
};
const sig = crypto.createSign('RSA-SHA256').update(`${b64(hdr)}.${b64(payload)}`)
  .sign(sa.private_key.replace(/\\n/g, '\n'), 'base64url');
const token = `${b64(hdr)}.${b64(payload)}.${sig}`;

// Temp served dist = copy of Admin/dist with a 'push' probe listener appended
// to sw.js (repo untouched) — distinguishes "push never arrives" from
// "push arrives but the handler doesn't display".
const PROBE_DIST = path.join(process.env.TEMP, 'fh-push-dist');
await new Promise((res, rej) => {
  const p = spawn(process.execPath, [path.resolve('tests/mk-probe-src.mjs'), process.cwd()], { stdio: 'inherit' });
  p.on('exit', c => (c === 0 ? res() : rej(new Error('probe build failed'))));
});
const server = spawn(process.execPath, [path.resolve('tests/serve-dist.mjs')], {
  env: { ...process.env, PORT: String(PORT), SERVE_ROOT: PROBE_DIST },
  stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 700));

// Persistent (non-incognito) profile: Chrome disables the Push API in
// incognito (crbug.com/41124656), which is Playwright's default context.
const PROFILE = path.join(process.env.TEMP || process.env.TMP || '.', 'fh-push-profile');
fs.rmSync(PROFILE, { recursive: true, force: true }); // fresh profile => fresh FCM installation => token differs from owner's
const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1200, height: 800 },
  ignoreDefaultArgs: ['--disable-background-networking'] // suspected of killing FCM push delivery (subscribe works, pushes never land)
});
const pageErrors = [];
let page = null;
try {
  await context.grantPermissions(['notifications'], { origin: `http://localhost:${PORT}` });
  page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { const t = m.text(); if (t.includes('FCM') || t.toLowerCase().includes('messaging') || t.toLowerCase().includes('push')) log('console:', t); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 20000 });
  await page.evaluate(async (t) => {
    const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const fb = await import('/js/firebase.js');
    await signInWithCustomToken(fb.auth, t);
  }, token);
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  log('signed in; waiting for setupAdminFCM -> storeToken...');
  // setupAdminFCM registers a one-shot document click fallback if the first
  // getToken attempt failed — click to give it a second chance.
  await page.click('body', { position: { x: 5, y: 5 } }).catch(() => {});

  // login triggers setupAdminFCM -> getToken -> storeToken(admins/uid/fcmToken)
  let testToken = null;
  for (let i = 0; i < 40 && !testToken; i++) {
    await page.waitForTimeout(1000);
    const t = (await tokenRef.once('value')).val();
    if (t && t !== originalToken) testToken = t;
  }
  assert(!!testToken,
    `test browser FCM token registered (changed from original: ${!!testToken ? 'yes' : 'no — push service likely unavailable'})`);
  if (!testToken) throw new Error('no fresh FCM token — refusing to send to the owner\'s real device');

  let controlled = false;
  for (let i = 0; i < 20 && !controlled; i++) {
    await page.waitForTimeout(500);
    controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  }
  assert(controlled, 'service worker controlling');

  // Background the app tab: with a page focused, FCM may route to the
  // foreground onMessage handler (toast) instead of the SW push path —
  // production admin tabs are often in the background, which is exactly
  // the sw.js onBackgroundMessage popup under test.
  const bgTab = await context.newPage();
  await bgTab.goto('about:blank');
  await bgTab.bringToFront();

  // same shape the bot sends: notification + data with orderId = RTDB key
  const res = await admin.messaging().send({
    token: testToken,
    notification: { title: 'PushCheck Title', body: 'PushCheck body' },
    data: { orderId: TEST_KEY, title: 'PushCheck Title', body: 'PushCheck body', type: 'new_order' }
  });
  log('sent:', res);

  const notifs = () => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const list = await reg.getNotifications();
    return list.map(n => ({ title: n.title, tag: n.tag, url: n.data && n.data.url, icon: n.icon }));
  });

  let list = [], toastSeen = false;
  const styledTag = `order-${TEST_KEY}`;
  for (let i = 0; i < 60 && !list.some(n => n.tag === styledTag); i++) {
    await page.waitForTimeout(1000);
    list = await notifs();
    if (!toastSeen) {
      toastSeen = await page.locator('body').innerText()
        .then(t => t.includes('PushCheck')).catch(() => false);
    }
  }
  log('notifications:', JSON.stringify(list), '| foreground toast seen:', toastSeen);
  const dbg = list.find(n => n.tag === 'dbg-push');
  const styled = list.find(n => n.tag === `order-${TEST_KEY}`);
  if (dbg && !styled) log('DIAGNOSIS: push event REACHED the SW (probe fired) but onBackgroundMessage did not display');
  if (!dbg && !styled) log('DIAGNOSIS: push event NEVER reached Chrome (delivery dead — not a sw.js issue)');
  assert(!!styled, `styled popup shown by onBackgroundMessage (${list.length} popup(s): ${list.map(n => n.tag).join(',') || 'none'})`);
  assert(list.length <= 1, `no double display (auto + handler): ${list.length} popup(s)`);
  if (styled) {
    assert(!!(styled.url && styled.url.includes(`?order=${TEST_KEY}`)), `deep-link data.url = ${styled.url}`);
    assert(styled.title.includes('PushCheck'), `title = ${styled.title}`);
  }
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    (await reg.getNotifications()).forEach(n => n.close());
  });
} catch (e) {
  assert(false, 'EXCEPTION: ' + (e && e.message));
} finally {
  try { await tokenRef.set(originalToken); log('owner fcmToken restored'); } catch (e) { log('TOKEN RESTORE FAILED:', e && e.message); }
  await context.close().catch(() => {});
  server?.kill();
}

assert(pageErrors.length === 0, `0 pageErrors (${pageErrors.length}${pageErrors.length ? ': ' + pageErrors[0] : ''})`);
log(`RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
