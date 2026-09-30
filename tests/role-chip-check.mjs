import { chromium } from 'playwright';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const PORT = 8124;
const OWNER_UID = 'ZoDidAOi3fUyOXNWn559r87dADo2';
const ADMIN_URL = process.env.ADMIN_URL || '';

let pass = 0, fail = 0;
const log = (...a) => console.log('[Chip]', ...a);
const assert = (c, m) => { if (c) { pass++; log('PASS', m); } else { fail++; log('FAIL', m); } };

// 1. Mint a custom token for the real owner uid (admin SDK shape: RS256 JWT)
const sa = JSON.parse(fs.readFileSync('Credentials/foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json', 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT' };
const payload = {
  iss: sa.client_email,
  sub: sa.client_email,
  aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
  iat: now, exp: now + 3600,
  uid: OWNER_UID,
  firebase: { identities: {}, sign_in_provider: 'custom' }
};
const sig = crypto.createSign('RSA-SHA256')
  .update(`${b64(header)}.${b64(payload)}`)
  .sign(sa.private_key.replace(/\\n/g, '\n'), 'base64url');
const token = `${b64(header)}.${b64(payload)}.${sig}`;

// 2. Serve local dist (skipped when ADMIN_URL targets a deployed env)
const server = ADMIN_URL ? null : spawn(process.execPath, [path.resolve('tests/serve-dist.mjs')], {
  env: { ...process.env, PORT: String(PORT), SERVE_ROOT: 'Admin/dist' },
  stdio: 'ignore'
});
if (server) await new Promise(r => setTimeout(r, 700));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(ADMIN_URL || `http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 20000 });

  // Sign in as the owner uid via custom token into the app's own auth instance
  const signIn = await page.evaluate(async (t) => {
    const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const fb = await import('/js/firebase.js');
    await signInWithCustomToken(fb.auth, t);
    return fb.auth.currentUser?.uid || null;
  }, token);
  log('signed in uid:', signIn);

  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(3000);

  // 3. Desktop topbar
  const desk = (await page.locator('#userRoleDisplay').textContent())?.trim();
  assert(desk === 'Owner \u2014 pizza', `desktop chip text = "${desk}"`);
  assert(await page.locator('#userRoleDisplay').isVisible(), 'desktop chip visible in topbar');
  const bold = (await page.locator('#userRoleDisplay b').textContent())?.trim();
  assert(bold === 'Owner', `bold role = "${bold}"`);
  const email = (await page.locator('#userEmailDisplay').textContent())?.trim();
  assert(email === 'roshanipizza@gmail.com', `email kept = "${email}"`);
  await page.screenshot({ path: 'tests/test-results/role-chip-desktop.png' });

  // 4. Mobile header
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const mob = (await page.locator('#mobileRoleDisplay').textContent())?.trim();
  assert(mob === 'Owner \u2014 pizza', `mobile chip text = "${mob}"`);
  assert(await page.locator('#mobileRoleDisplay').isVisible(), 'mobile chip visible under title');
  assert(!(await page.locator('#userRoleDisplay').isVisible()), 'desktop chip hidden on mobile');
  await page.screenshot({ path: 'tests/test-results/role-chip-mobile.png' });

  assert(pageErrors.length === 0, `0 pageErrors (got ${pageErrors.length}${pageErrors.length ? ': ' + pageErrors[0] : ''})`);
} finally {
  await browser.close().catch(() => {});
  server?.kill();
}
log(`RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
