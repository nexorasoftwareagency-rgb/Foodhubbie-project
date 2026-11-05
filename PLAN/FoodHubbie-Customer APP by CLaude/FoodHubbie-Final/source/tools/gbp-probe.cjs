// Probe: where does the account land right now?
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});

  for (const url of ['https://business.google.com/home?hl=en', 'https://business.google.com/locations?hl=en', 'https://business.google.com/create/new?hl=en']) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(5000);
    const t = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '(err)');
    console.log('=== ' + url + ' => ' + page.url());
    console.log(t.replace(/\s+/g, ' '));
  }
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
