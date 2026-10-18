// Select US draft row, open Actions menu, dump items.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  await page.goto('https://business.google.com/locations?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(6000);
  await page.locator('[data-ulid="5933748942660191835"] [role=checkbox]').click().catch((e) => console.log('checkbox fail'));
  await sleep(2000);
  const actions = page.getByText('Actions', { exact: true }).locator('visible=true').last();
  try {
    await actions.click({ timeout: 8000, force: true });
    await sleep(2500);
  } catch (e) { console.log('actions fail: ' + e.message.split('\n')[0]); }
  console.log('MENU: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 1200).replace(/\s+/g, ' '));
  const items = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[role=menuitem], [role=option], li[jsaction*="menu"], a[class*="menu"]').forEach((e) => {
      if (e.offsetParent) out.push((e.textContent || '').trim());
    });
    return out;
  });
  console.log('ITEMS: ' + JSON.stringify(items));
  await page.screenshot({ path: 'website/gbp-actions.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
