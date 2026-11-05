// Debug: just check current page state
const { chromium } = require('playwright');
const PROFILE = 'C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile';
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await new Promise(r => setTimeout(r, 5000));
  console.log('URL:', page.url());
  const t = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  console.log(t);
  await page.screenshot({ path: 'website/gbp-state.png' });
  console.log('screenshot saved');
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });