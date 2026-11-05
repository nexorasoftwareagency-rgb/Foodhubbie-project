// Debug: why does ?order deep-link boot fail against current Admin/dist?
import { chromium } from 'playwright';
import crypto from 'crypto';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';

const PORT = 8128;
const OWNER_UID = 'ZoDidAOi3fUyOXNWn559r87dADo2';
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
  env: { ...process.env, PORT: String(PORT), SERVE_ROOT: 'Admin/dist' }, stdio: 'ignore'
});
await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.text().includes('Orders') || m.text().includes('UI') || m.text().includes('settings') || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => logs.push('PAGEERROR: ' + e));

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 20000 });
  await page.evaluate(async (t) => {
    const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const fb = await import('/js/firebase.js');
    await signInWithCustomToken(fb.auth, t);
  }, token);
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(3000);

  // create the test order (same shape as the E2E)
  await page.evaluate(async () => {
    const fb = await import('/js/firebase.js');
    await fb.set(fb.Outlet.ref('orders/zztest-n'), {
      orderId: 'xxPPOP01', items: { 0: { name: 'Popup Test', qty: 1, price: 1 } },
      total: 1, status: 'Delivered', createdAt: '2026-09-29T10:00:00.000Z',
      type: 'Dine-in', source: 'test_notify', _fcmSent: true, customerName: 'PopupTest'
    });
  });

  await page.goto(`http://localhost:${PORT}/index.html?order=zztest-n`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.evaluate(() => {
    const f = document.getElementById('orderFrom');
    const t = document.getElementById('orderTo');
    f.value = '2026-09-28'; t.value = '2026-09-30';
    f.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(8000);

  const state = await page.evaluate(async () => {
    const fb = await import('/js/firebase.js');
    const { state: appState } = await import('/js/state.js');
    const visibleTabs = [...document.querySelectorAll('.tab-content')].filter(d => !d.classList.contains('hidden')).map(d => d.id);
    const row = document.getElementById('row-zztest-n');
    const ordersTab = document.getElementById('tab-orders');
    const rows = ordersTab ? [...ordersTab.querySelectorAll('.premium-row-v4')].map(r => r.id) : [];
    return {
      href: location.href,
      currentOutlet: appState.currentOutlet,
      currentActiveTab: appState.currentActiveTab,
      visibleTabs,
      rowExists: !!row,
      ordersTabHidden: ordersTab ? ordersTab.classList.contains('hidden') : 'no-tab-orders',
      pageDataLen: (appState.ordersPageData || []).length,
      pageDataHasTest: (appState.ordersPageData || []).some(o => o.id === 'zztest-n'),
      pageDataIds: (appState.ordersPageData || []).map(o => o.id).slice(-6),
      loadedKeysSize: appState.ordersLoadedKeys ? appState.ordersLoadedKeys.size : null,
      domRowCount: rows.length,
      domRowIds: rows.slice(-6)
    };
  });
  console.log('STATE:', JSON.stringify(state, null, 2));
  console.log('LOGS:', logs.slice(0, 20).join('\n'));

  // cleanup
  await page.evaluate(async () => {
    const fb = await import('/js/firebase.js');
    await fb.remove(fb.Outlet.ref('orders/zztest-n'));
  });
} catch (e) {
  console.log('EXC:', e.message);
  console.log('LOGS:', logs.slice(0, 20).join('\n'));
} finally {
  await browser.close().catch(() => {});
  server?.kill();
}
