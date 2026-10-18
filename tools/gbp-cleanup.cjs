// Sequentially remove junk drafts (keep ulid 2510051953782582326).
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const junk = ['04587145395459463730', '05335689186579140433', '12410275400618606304'];
const KEEP = '2510051953782582326';
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  for (const u of junk) {
    await page.goto('https://business.google.com/locations?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(5000);
    const row = page.locator('tr', { hasText: u }).first().locator('role=checkbox');
    if (!(await row.count())) { console.log(u + ': row missing, skip'); continue; }
    let sel = false;
    for (let a = 0; a < 3 && !sel; a++) {
      await row.click({ force: true }).catch(() => {});
      await sleep(1500);
      sel = (await page.getByText('business selected').count()) > 0;
    }
    if (!sel) { console.log(u + ': selection failed, skip'); continue; }
    await page.getByText('Actions', { exact: true }).locator('visible=true').last().click({ force: true }).catch(() => {});
    await sleep(2000);
    const t = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[role=menuitem], li, a, button')];
      const x = items.find((e) => e.offsetParent && /^remove business$/i.test((e.textContent || '').trim()));
      if (x) {
        const r = x.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    });
    if (t) {
      await page.mouse.click(t.x, t.y);
      await sleep(2500);
      const rm = await page.evaluate(() => {
        const items = [...document.querySelectorAll('button, [role=button]')];
        const x = items.find((e) => e.offsetParent && /^remove$/i.test((e.textContent || '').trim()));
        if (x) {
          const r = x.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
        return null;
      });
      if (rm) { await page.mouse.click(rm.x, rm.y); await sleep(5000); console.log(u + ': removed'); }
      else console.log(u + ': confirm button missing');
    } else {
      await page.keyboard.press('Escape');
      console.log(u + ': remove item missing');
    }
  }
  await page.goto('https://business.google.com/locations?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(6000);
  console.log('FINAL LIST: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 700).replace(/\s+/g, ' '));
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
