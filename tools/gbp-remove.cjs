// Remove US draft + map all rows (store code <-> ulid).
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
  const map = await page.evaluate(() =>
    [...document.querySelectorAll('tr[data-ulid]')].map((r) => ({
      ulid: r.getAttribute('data-ulid'),
      code: (r.querySelector('.m5ssue') || {}).textContent || '',
      txt: (r.textContent || '').trim().slice(0, 60),
    }))
  );
  console.log('MAP: ' + JSON.stringify(map, null, 1));

  // select US draft row + Actions + Remove business
  await page.locator('[data-ulid="5933748942660191835"] [role=checkbox]').click().catch((e) => console.log('checkbox fail'));
  await sleep(1800);
  await page.getByText('Actions', { exact: true }).locator('visible=true').last().click({ force: true }).catch((e) => console.log('actions fail'));
  await sleep(2000);
  const clicked = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role=menuitem], li, a, button')];
    const t = items.find((e) => e.offsetParent && /^remove business$/i.test((e.textContent || '').trim()));
    if (t) {
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return null;
  });
  if (clicked) {
    await page.mouse.click(clicked.x, clicked.y);
    await sleep(3000);
    const dlg = (await page.evaluate(() => document.body.innerText)).slice(0, 1000).replace(/\s+/g, ' ');
    console.log('DIALOG: ' + dlg);
    await page.screenshot({ path: 'website/gbp-remove-dlg.png' });
  } else {
    console.log('remove item not found');
  }
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
