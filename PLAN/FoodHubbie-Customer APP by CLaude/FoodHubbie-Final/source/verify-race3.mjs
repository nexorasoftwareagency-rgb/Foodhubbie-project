// Race check v3: login, then click staff subtab within 5ms of settings tab
// becoming visible. Verifies settings module evaluated BEFORE unhide.
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8124/Admin/index.html';
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#loginEmail', { timeout: 30000 });
await page.fill('#loginEmail', 'roshanipizza@gmail.com');
await page.fill('#loginPassword', 'Ns@9724649971');
await page.click('#loginBtn');

let loginOk = false;
try {
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 25000 });
  loginOk = true;
} catch { /* throttle or wrong creds — reported below */ }

let result = { loginOk };
if (loginOk) {
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#menu-settings button[data-action="switchTab"]')?.click());
  Object.assign(result, await page.evaluate(() => new Promise(resolve => {
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
            subActive: !!sub && sub.classList.contains('active'),
            sectionDisplay: sec ? getComputedStyle(sec).display : 'MISSING',
          });
        }, 500);
      }
      if (performance.now() - t0 > 15000) { clearInterval(iv); resolve({ switchTimeout: true }); }
    }, 5);
  })));
}

const pass = result.loginOk && result.markerAtVisible && result.subActive && result.sectionDisplay !== 'none';
console.log(JSON.stringify({ result, errors: errors.slice(0, 8) }, null, 2));
console.log(pass ? 'RESULT: PASS' : (result.loginOk ? 'RESULT: FAIL (race)' : 'RESULT: BLOCKED (login/throttle)'));
await browser.close();
process.exit(pass ? 0 : (result.loginOk ? 1 : 2));
