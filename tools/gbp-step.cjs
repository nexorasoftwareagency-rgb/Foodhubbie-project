// GBP stepper: argv[2] = step to perform. Prints page state after.
const { chromium } = require('playwright');
const PROFILE = 'C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STEP = process.argv[2] || 'state';
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const state = async (n = 700) =>
    console.log('STATE: ' + (await page.evaluate(() => document.body.innerText)).slice(0, n));
  const clickText = async (re) => {
    const pt = await page.evaluate((rs) => {
      const re = new RegExp(rs, 'i');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        if (re.test((walker.currentNode.textContent || '').trim())) nodes.push(walker.currentNode);
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
    }, re.source);
    if (pt) { await page.mouse.click(pt.x, pt.y); return true; }
    return false;
  };

  if (STEP === 'create') {
    await page.goto('https://business.google.com/create/new?hl=en');
    await sleep(6000);
    await state();
  } else if (STEP === 'name') {
    const box = page.getByRole('textbox').first();
    await box.click();
    await box.fill('FoodHubbie ERP');
    await sleep(800);
    await clickText('^continue$');
    await sleep(5000);
    await state();
  } else if (STEP === 'website') {
    const boxes = page.getByRole('textbox');
    for (let i = 0; i < (await boxes.count()); i++) {
      if (await boxes.nth(i).isVisible()) {
        await boxes.nth(i).click();
        await boxes.nth(i).fill('https://foodhubbie-web.web.app/');
        break;
      }
    }
    await sleep(800);
    await clickText('^next$');
    await sleep(5000);
    await state();
  } else if (STEP === 'category') {
    const combo = page.getByRole('combobox').first();
    await combo.click();
    await combo.fill('Software company');
    await sleep(2500);
    await page.evaluate(() => {
      const o = [...document.querySelectorAll('[role="option"]')].find(
        (e) => e.offsetParent && e.textContent.trim() === 'Software company'
      );
      o?.click();
    });
    await sleep(1500);
    await clickText('^next$');
    await sleep(5000);
    await state();
  } else if (STEP === 'address') {
    const vals = ['Vill - Anjani, P.O - Anjani, P.S - Parsa', 'Parsa', '841219'];
    const inputs = page.locator('input[type="text"]');
    const n = await inputs.count();
    let vi = 0;
    for (let i = 0; i < n && vi < vals.length; i++) {
      if (await inputs.nth(i).isVisible()) {
        await inputs.nth(i).click();
        await inputs.nth(i).fill(vals[vi++]);
        await sleep(400);
      }
    }
    const combos = page.getByRole('combobox');
    const cn = await combos.count();
    for (let i = 0; i < cn; i++) {
      if (await combos.nth(i).isVisible()) {
        await combos.nth(i).click();
        await sleep(1500);
        await page.evaluate(() => {
          const o = [...document.querySelectorAll('[role="option"]')].find(
            (e) => e.offsetParent && /bihar/i.test(e.textContent)
          );
          o?.click();
        });
        break;
      }
    }
    await sleep(1000);
    await clickText('^next$');
    await sleep(6000);
    await state(1000);
  } else {
    await state(1000);
  }
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
