import { chromium } from 'playwright';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const PORT = 8124;
const OWNER_UID = 'ZoDidAOi3fUyOXNWn559r87dADo2';
const STALE = 'STALE_FOREIGN_UID_X';
const ADMIN_URL = process.env.ADMIN_URL || '';

let pass = 0, fail = 0;
const log = (...a) => console.log('[Fix]', ...a);
const assert = (c, m) => { if (c) { pass++; log('PASS', m); } else { fail++; log('FAIL', m); } };

const sa = JSON.parse(fs.readFileSync('Credentials/foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json', 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT' };
const payload = { iss: sa.client_email, sub: sa.client_email, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', iat: now, exp: now + 3600, uid: OWNER_UID, firebase: { identities: {}, sign_in_provider: 'custom' } };
const sig = crypto.createSign('RSA-SHA256').update(`${b64(header)}.${b64(payload)}`).sign(sa.private_key.replace(/\\n/g, '\n'), 'base64url');
const token = `${b64(header)}.${b64(payload)}.${sig}`;

const server = ADMIN_URL ? null : spawn(process.execPath, [path.resolve('tests/serve-dist.mjs')], {
  env: { ...process.env, PORT: String(PORT), SERVE_ROOT: 'Admin/dist' }, stdio: 'ignore'
});
if (server) await new Promise(r => setTimeout(r, 700));

const signIn = (page) => page.evaluate(async (t) => {
  const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
  const fb = await import('/js/firebase.js');
  await signInWithCustomToken(fb.auth, t);
}, token);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(ADMIN_URL || `http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 20000 });
  await signIn(page);
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(2500);

  // F3: resolver is record-driven — never the printer's identity
  const claims = await page.evaluate(async () => {
    const m = await import('/js/features/printing.js');
    return {
      none: await m.resolveOperatorClaim(null),
      undef: await m.resolveOperatorClaim(undefined),
      owner: await m.resolveOperatorClaim('ZoDidAOi3fUyOXNWn559r87dADo2'),
      bogus: await m.resolveOperatorClaim('no-such-uid-xyz')
    };
  });
  assert(claims.none === '', `F3 legacy/no uid -> '' (got "${claims.none}")`);
  assert(claims.undef === '', `F3 undefined uid -> '' (got "${claims.undef}")`);
  assert(claims.owner === 'Owner \u2014 pizza', `F3 owner uid -> admin record (got "${claims.owner}")`);
  assert(claims.bogus === '', `F3 unresolvable uid -> '' (got "${claims.bogus}")`);

  // F1a: stale foreign uid in sessionStorage is overwritten on POS entry
  await page.evaluate((s) => sessionStorage.setItem('counterStaffUid', s), STALE);
  await page.click('button[data-action="switchTab"][data-tab="walkin"]');
  await page.waitForSelector('#tab-walkin:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(2500);
  let key = await page.evaluate(() => sessionStorage.getItem('counterStaffUid'));
  assert(key === 'ZoDidAOi3fUyOXNWn559r87dADo2', `F1a POS entry re-signs current user (got ${key})`);

  // endShift: clears attribution, no stale PIN copy path, no throw (dead check removed)
  await page.click('#btnEndShift');
  await page.waitForTimeout(800);
  key = await page.evaluate(() => sessionStorage.getItem('counterStaffUid'));
  assert(key === null, `endShift clears shift uid (got ${key})`);
  const toast = await page.locator('.toast, .toast-message, [class*=toast]').first().textContent().catch(() => '');
  assert(/Re-open the POS tab/.test(toast || ''), `endShift toast without PIN wording ("${(toast || '').trim().slice(0, 60)}")`);

  // F1b: auth boundary — stale uid cleared on logout, and on next login
  await page.evaluate((s) => sessionStorage.setItem('counterStaffUid', s), STALE);
  await page.evaluate(async () => { const a = await import('/js/auth.js'); a.userLogout(); });
  await page.waitForSelector('#loginEmail', { timeout: 20000 });
  await page.waitForTimeout(1000);
  key = await page.evaluate(() => sessionStorage.getItem('counterStaffUid'));
  assert(key === null, `F1b logout clears stale shift uid (got ${key})`);

  await page.evaluate((s) => sessionStorage.setItem('counterStaffUid', s), STALE);
  await signIn(page);
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(1500);
  key = await page.evaluate(() => sessionStorage.getItem('counterStaffUid'));
  assert(key === 'ZoDidAOi3fUyOXNWn559r87dADo2', `F1b login (re)signs current user immediately (got ${key})`);

  // still correct when POS tab is re-entered
  await page.click('button[data-action="switchTab"][data-tab="orders"]');
  await page.waitForTimeout(500);
  await page.click('button[data-action="switchTab"][data-tab="walkin"]');
  await page.waitForSelector('#tab-walkin:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(2000);
  key = await page.evaluate(() => sessionStorage.getItem('counterStaffUid'));
  assert(key === 'ZoDidAOi3fUyOXNWn559r87dADo2', `POS auto-sign after re-login (got ${key})`);

  assert(pageErrors.length === 0, `0 pageErrors (got ${pageErrors.length}${pageErrors.length ? ': ' + pageErrors[0] : ''})`);
} finally {
  await browser.close().catch(() => {});
  server?.kill();
}
log(`RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
