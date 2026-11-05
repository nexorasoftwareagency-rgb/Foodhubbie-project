// Explore deletion paths: profile page for US draft + row-select toolbar.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});

  // 1) profile page for the US draft
  await page.goto('https://business.google.com/n/5933748942660191835/searchprofile?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(6000);
  console.log('PROFILE PAGE: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 1200).replace(/\s+/g, ' '));
  const btns = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button[aria-label], [role=button][aria-label]').forEach((b) => {
      if (b.offsetParent) out.push(b.getAttribute('aria-label'));
    });
    return out;
  });
  console.log('PROFILE BUTTONS: ' + JSON.stringify(btns));
  await page.screenshot({ path: 'website/gbp-us-page.png' });

  // 2) row select toolbar
  await page.goto('https://business.google.com/locations?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(6000);
  await page.locator('[data-ulid="5933748942660191835"] [role=checkbox]').click().catch((e) => console.log('checkbox fail'));
  await sleep(2500);
  console.log('SELECTED TOOLBAR: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 1400).replace(/\s+/g, ' '));
  await page.screenshot({ path: 'website/gbp-select.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
