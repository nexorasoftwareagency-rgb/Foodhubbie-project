// Hover a row, dump kebab menu + its items (deletion path discovery).
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

  // Row 3 = US draft (0295.. idx0? order: idx0=14737259577222471979, 1=0295, 2=0368 US)
  const rows = page.locator('a[href*="/verify/l/"]');
  const n = await rows.count();
  console.log('rows:', n);
  const target = page.locator('a[href*="/verify/l/03685211144814995386"]');

  // dump full row structure (parent containers and buttons)
  const rowDump = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/verify/l/03685211144814995386"]');
    if (!a) return null;
    let row = a.closest('tr') || a.closest('[role=row]') || a.closest('li') || a.parentElement;
    const html = [];
    for (let i = 0; row && i < 3; i++) {
      html.push(row.outerHTML.slice(0, 1500));
      row = row.parentElement;
    }
    return html;
  });
  console.log('ROW DUMP:', JSON.stringify(rowDump, null, 1));

  // hover the row to reveal kebab
  await target.hover().catch(() => {});
  await sleep(1500);
  const btns = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button, [role=button], [aria-label]').forEach((b) => {
      const al = b.getAttribute('aria-label') || '';
      if (/more|settings|menu|remove|delete|action/i.test(al) && b.offsetParent) out.push(al);
    });
    return out;
  });
  console.log('hover buttons:', JSON.stringify(btns));
  // try clicking a kebab in the row area: find '⋮'-ish or aria menu button AFTER hover, within row container
  const kebab = page.locator('button[aria-label*="ore"], [aria-label*="ettings"]').last();
  try {
    await kebab.click({ timeout: 5000, force: true });
    await sleep(2000);
    console.log('MENU: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 800).replace(/\s+/g, ' '));
    await page.keyboard.press('Escape');
  } catch (e) { console.log('kebab fail: ' + e.message.split('\n')[0]); }
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
