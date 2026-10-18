// Confirm Remove for currently-open dialog (+ generic: select US row first if no dialog open).
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
  // select + open dialog fresh (in case previous dialog vanished)
  await page.locator('[data-ulid="5933748942660191835"] [role=checkbox]').click().catch((e) => console.log('checkbox fail'));
  await sleep(1800);
  await page.getByText('Actions', { exact: true }).locator('visible=true').last().click({ force: true }).catch(() => {});
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
  if (clicked) { await page.mouse.click(clicked.x, clicked.y); await sleep(2500); }
  // dump full dialog then click its Remove button
  console.log('DIALOG: ' + (await page.evaluate(() => document.body.innerText)).slice(-500).replace(/\s+/g, ' '));
  const rm = await page.evaluate(() => {
    const items = [...document.querySelectorAll('button, [role=button]')];
    const t = items.find((e) => e.offsetParent && /^(remove|remove business)$/i.test((e.textContent || '').trim()));
    if (t) {
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    return null;
  });
  if (rm) {
    await page.mouse.click(rm.x, rm.y);
    await sleep(5000);
    console.log('removed');
  } else {
    console.log('remove button not found');
  }
  await sleep(3000);
  const cnt = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\s+/g, ' '));
  console.log('AFTER: ' + cnt);
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
