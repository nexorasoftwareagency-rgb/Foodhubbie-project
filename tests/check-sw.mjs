/**
 * Check: active service worker must not throw CSP/Response errors when the
 * Settings > WhatsApp Bot previews load cross-origin (*.web.app) images.
 * Regression: sw.js used to intercept them → fetch() blocked by connect-src
 * → respondWith(undefined) → "Failed to convert value to 'Response'".
 * Usage: node tests/check-sw.mjs
 */
import { chromium } from 'playwright';

const ADMIN_URL = process.env.ADMIN_URL || 'https://foodhubbie-admins.web.app';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

const bad = [];
page.on('console', m => {
  if (m.type() === 'error' && /Content Security|Failed to convert|greetingImage|menuImage/.test(m.text())) bad.push(m.text());
});
page.on('pageerror', e => bad.push(String(e)));

await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForSelector('#loginEmail', { timeout: 30000 });
} catch (e) {
  console.log('login form did not appear; title=', await page.title());
  console.log('body head:', (await page.evaluate(() => document.body.innerText)).slice(0, 400));
  console.log('errors so far:', bad.slice(0, 10));
  await page.screenshot({ path: 'tests/test-results/review/fatal-sw-login.png' });
  await browser.close();
  process.exit(1);
}
await page.fill('#loginEmail', 'roshanipizza@gmail.com');
await page.fill('#loginPassword', 'REDACTED-PASSWORD-ROTATE-ME');
await page.click('#loginBtn');
await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });

// Keep the SW alive (unlike review-tabs.mjs); wait until the NEW sw (v5.4.5
// cache name) is activated and controlling, not just any registration.
const gotController = await page.waitForFunction(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  if (!r || !navigator.serviceWorker.controller || r.active?.state !== 'activated') return false;
  return (await caches.keys()).includes('foodhubbie-erp-shell-v5.4.5');
}, { timeout: 60000, polling: 1000 }).then(() => true).catch(() => false);
console.log('SW regs:', JSON.stringify(await page.evaluate(async () => {
  const rs = await navigator.serviceWorker.getRegistrations();
  return rs.map(r => ({ scope: r.scope, active: r.active?.state || null, installing: !!r.installing, waiting: !!r.waiting }));
})));

// Settings → WhatsApp Bot: loads foodhubbie-assets.web.app preview images
await page.click('[data-action="switchTab"][data-tab="settings"]');
await page.waitForSelector('#tab-settings:not(.hidden)', { timeout: 15000 });
await page.waitForTimeout(800);
await page.locator('[data-subtab="whatsapp-bot"]').click().catch(() => {});
await page.waitForTimeout(6000);

// Positive probe: cross-origin image must load through the controlling SW
// (old sw.js intercepted it → CSP-blocked fetch → image error)
const imgOk = await page.evaluate(() => new Promise(resolve => {
  const img = new Image();
  img.onload = () => resolve(img.naturalWidth > 0);
  img.onerror = () => resolve(false);
  img.src = 'https://foodhubbie-assets.web.app/bot/greetingImage.jpg?' + Date.now();
  setTimeout(() => resolve(false), 10000);
}));

await browser.close();

console.log('SW controlling page (new v5.4.5):', gotController);
console.log('cross-origin image loads via SW:', imgOk);
console.log('CSP/SW errors:', bad.length);
bad.forEach(b => console.log('  -', b));
process.exit(gotController && imgOk && !bad.length ? 0 : 1);
