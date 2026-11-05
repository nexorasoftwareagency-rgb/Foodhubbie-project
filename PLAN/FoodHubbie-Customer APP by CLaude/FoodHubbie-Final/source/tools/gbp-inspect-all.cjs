// Inspect each India draft profile card: category, service areas, phone, website, hours.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ulids = [
  '2510051953782582326',
  '-5687478537411287674',
  '-3274598888429745076',
  '-5694036001135410399',
  '7687065310651924031',
  '-4669046479154340133',
];
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  for (const u of ulids) {
    await page.goto('https://business.google.com/n/' + u + '/searchprofile?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(5000);
    const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const seg = t.slice(0, 700);
    console.log('=== ' + u + ': ' + seg);
    console.log('');
  }
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
