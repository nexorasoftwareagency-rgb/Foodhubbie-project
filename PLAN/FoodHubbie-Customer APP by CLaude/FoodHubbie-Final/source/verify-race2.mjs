// Race check v2 (no login): verifies switchTab('settings') unhides the tab only
// AFTER the settings module evaluated (handler registered), by clicking the
// staff subtab within 5ms of the tab becoming visible.
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8124/Admin/index.html';
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

await page.evaluate(() => document.querySelector('#menu-settings button[data-action="switchTab"]')?.click());

const result = await page.evaluate(() => new Promise(resolve => {
  const t = document.getElementById('tab-settings');
  const t0 = performance.now();
  const iv = setInterval(() => {
    if (t && !t.classList.contains('hidden')) {
      clearInterval(iv);
      const markerAtVisible = typeof window.updateOutletStatusIndicator === 'function';
      const sub = document.querySelector('.settings-subtab[data-subtab="staff-management"]');
      if (sub) sub.click();
      setTimeout(() => {
        const sec = document.querySelector('[data-settings-section="staff-management"]');
        resolve({
          msAfterVisible: +(performance.now() - t0).toFixed(1),
          markerAtVisible,
          subClicked: !!sub,
          subActive: !!sub && sub.classList.contains('active'),
          sectionDisplay: sec ? getComputedStyle(sec).display : 'MISSING',
        });
      }, 500);
    }
    if (performance.now() - t0 > 15000) { clearInterval(iv); resolve({ timeout: true }); }
  }, 5);
}));

const pass = !result.timeout && result.markerAtVisible && result.subActive && result.sectionDisplay !== 'none';
console.log(JSON.stringify({ result, errors: errors.slice(0, 8) }, null, 2));
console.log(pass ? 'RESULT: PASS' : 'RESULT: FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
