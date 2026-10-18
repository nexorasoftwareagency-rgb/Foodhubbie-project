// GBP real form: name + category + next. Assumes browser left on the form page.
const { chromium } = require('playwright');
const PROFILE = 'C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await sleep(2000);
  // Business name = first enabled textbox
  const inputs = page.locator('input:not([disabled])');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    if (await inputs.nth(i).isVisible()) {
      const v = await inputs.nth(i).inputValue().catch(() => '');
      if (!v) {
        await inputs.nth(i).click();
        await inputs.nth(i).fill('FoodHubbie ERP');
        break;
      }
    }
  }
  await sleep(800);
  // Category combobox
  const combos = page.getByRole('combobox');
  const cn = await combos.count();
  for (let i = 0; i < cn; i++) {
    if (await combos.nth(i).isVisible()) {
      await combos.nth(i).click();
      await combos.nth(i).fill('Software company');
      await sleep(2500);
      await page.evaluate(() => {
        const o = [...document.querySelectorAll('[role="option"]')].find(
          (e) => e.offsetParent && e.textContent.trim() === 'Software company'
        );
        o?.click();
      });
      break;
    }
  }
  await sleep(1500);
  const clicked = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (/^(next|continue)$/i.test((walker.currentNode.textContent || '').trim())) nodes.push(walker.currentNode);
    }
    for (const t of nodes) {
      let el = t.parentElement;
      while (el && el.getBoundingClientRect().width === 0) el = el.parentElement;
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  });
  if (clicked) await page.mouse.click(clicked.x, clicked.y);
  await sleep(6000);
  console.log('AFTER: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 800));
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
