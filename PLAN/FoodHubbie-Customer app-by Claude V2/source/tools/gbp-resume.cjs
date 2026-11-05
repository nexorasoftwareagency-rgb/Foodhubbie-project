// GBP one-step executor: acts on whatever page is current, dumps next state.
const { chromium } = require('playwright');
const PROFILE = 'C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://business.google.com/create/new?hl=en');
  await sleep(6000);
  const body = await page.evaluate(() => document.body.innerText);
  console.log('CURRENT: ' + body.slice(0, 700));

  const next = async () => {
    const btn = page.getByRole('button', { name: 'Next', exact: true }).locator('visible=true').last();
    try { await btn.click({ timeout: 8000 }); return true; } catch { return false; }
  };
  const choose = async (text) => {
    const t = page.getByText(text, { exact: true }).locator('visible=true').last();
    try { await t.click({ timeout: 8000, force: true }); return true; } catch { return false; }
  };

  if (body.includes('Get updates about your business')) {
    console.log('choose No:', await choose('No'));
    await sleep(1000);
    console.log('next:', await next());
    await sleep(6000);
  } else if (body.includes('location customers can visit')) {
    console.log('choose No:', await choose('No'));
    await sleep(1000);
    console.log('next:', await next());
    await sleep(6000);
  }
  const after = await page.evaluate(() => document.body.innerText);
  console.log('AFTER: ' + after.slice(0, 1000));
  const inv = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input, [role="combobox"], select').forEach((e) => {
      if (e.offsetParent) out.push({ tag: e.tagName, type: e.type || '', ph: e.placeholder || '', val: (e.value || '').slice(0, 40), en: !e.disabled });
    });
    return out;
  });
  console.log('INVENTORY: ' + JSON.stringify(inv));
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
