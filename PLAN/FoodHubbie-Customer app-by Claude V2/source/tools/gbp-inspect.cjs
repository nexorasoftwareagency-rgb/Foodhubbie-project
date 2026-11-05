// Inspect GBP account state: list businesses on the account.
const { chromium } = require('playwright');
const PROFILE = 'C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://business.google.com/locations?hl=en');
  await sleep(6000);
  const t = await page.evaluate(() => document.body.innerText);
  console.log('URL: ' + page.url());
  console.log(t.slice(0, 1500));
  await page.screenshot({ path: 'website/gbp-state.png' });
  console.log('screenshot saved');
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
