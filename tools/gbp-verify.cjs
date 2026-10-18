// Dump verification-method page incl. More options content.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  await page.goto('https://business.google.com/verify/l/12410275400618606304?hl=en&service=ome&original_intent=GMB&lid=13777697594555211483&skipfm=1&skipdr=1&sof=1', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('goto fail'));
  await sleep(6000);
  console.log('CURRENT: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 1100));
  // expand More options
  const more = page.getByText('More options', { exact: true }).locator('visible=true').last();
  try { await more.click({ timeout: 6000, force: true }); await sleep(3000); } catch (e) { console.log('more fail'); }
  console.log('MORE: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 1600));
  const inv = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[type=radio], [role=radio]').forEach((e) => {
      if (e.offsetParent) out.push({ val: e.value || '', label: e.getAttribute('aria-label') || '', txt: (e.closest('label,li,div[row],tr,h3') || {}).textContent || '' });
    });
    return out;
  });
  console.log('RADIOS: ' + JSON.stringify(inv));
  await page.screenshot({ path: 'website/gbp-verify-options.png', fullPage: true });
  console.log('screenshot: website/gbp-verify-options.png');
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
