// GBP staged flow: Stage A (find) + Stage B (name/category) + dump Stage C inventory.
const { chromium } = require('playwright');
const PROFILE = 'C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickText = async (page, re) => {
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

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // Stage A: search screen -> type name -> add business
  await page.goto('https://business.google.com/create/new?hl=en');
  await page.waitForSelector('input[type="text"]', { timeout: 30000 });
  await sleep(1500);
  let done = false;
  const ins = page.locator('input:not([disabled])');
  for (let i = 0; i < (await ins.count()); i++) {
    if (await ins.nth(i).isVisible()) {
      await ins.nth(i).click();
      await ins.nth(i).fill('FoodHubbie ERP');
      done = true;
      break;
    }
  }
  if (!done) throw new Error('no enabled name input');
  await sleep(2500);
  // Click the visible "Add your business to Google" link via Playwright locator
  const link = page.getByText('Add your business to Google', { exact: true }).locator('visible=true').last();
  try {
    await link.click({ timeout: 10000 });
    console.log('clicked visible add link: true');
  } catch {
    console.log('clicked visible add link: FALSE');
  }
  await sleep(5000);
  const sb = (await page.evaluate(() => document.body.innerText)).slice(0, 500);
  console.log('STAGE-B: ' + sb);
  if (!sb.includes('Start building')) {
    console.log('ABORT: did not reach form; dumping state');
    await page.screenshot({ path: 'website/gbp-state.png' });
    await ctx.close();
    process.exit(2);
  }

  // Stage B: name + category via placeholder locators, then Next
  const nameBox = page.locator('input[placeholder="Business name"]');
  await nameBox.fill('FoodHubbie ERP');
  await sleep(1200);
  await page.keyboard.press('Escape');
  await sleep(500);
  const catBox = page.locator('input[placeholder="Business category"]');
  await catBox.fill('Software company', { force: true });
  await sleep(2500);
  const picked = await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')].find(
      (e) => e.offsetParent && e.textContent.trim() === 'Software company'
    );
    if (o) { o.click(); return true; }
    return false;
  });
  if (!picked) {
    const opts = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"]')]
        .filter((e) => e.offsetParent)
        .map((e) => e.textContent.trim()).slice(0, 10)
    );
    console.log('CATEGORY OPTIONS:', JSON.stringify(opts));
  }
  console.log('picked:', picked);
  await sleep(1500);
  await page.keyboard.press('Escape');
  await sleep(500);
  // commit category, then click Next via button locator
  await catBox.press('Enter').catch(() => {});
  await sleep(1000);
  await page.keyboard.press('Escape');
  await sleep(500);
  let b = false;
  const nextBtn = page.getByRole('button', { name: 'Next', exact: true }).locator('visible=true').last();
  try {
    await nextBtn.click({ timeout: 10000 });
    b = true;
  } catch {
    const nb = await clickText(page, '^next$');
    b = nb;
  }
  console.log('clicked next:', b);

  // Stage C: location question -> No (SaaS, no storefront)
  await sleep(3000);
  const body2 = await page.evaluate(() => document.body.innerText);
  if (body2.includes('location customers can visit')) {
    let sel = false;
    const noTxt = page.getByText('No', { exact: true }).locator('visible=true').last();
    try { await noTxt.click({ timeout: 8000, force: true }); sel = true; } catch {}
    if (!sel) {
      try {
        const rr = await page.locator('input[type="radio"][value="no"]').boundingBox();
        if (rr) { await page.mouse.click(rr.x + rr.width / 2, rr.y + rr.height / 2); sel = true; }
      } catch {}
    }
    console.log('radio no selected:', sel);
    await sleep(1500);
    const nextBtn2 = page.getByRole('button', { name: 'Next', exact: true }).locator('visible=true').last();
    await nextBtn2.click({ timeout: 10000 }).catch(async () => {
      await clickText(page, '^next$');
    });
    await sleep(6000);
    console.log('STAGE-D: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 900));
  }
  await sleep(6000);
  console.log('STAGE-C: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 900));

  // Dump field inventory of current page for next-step mapping
  const inv = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input, [role="combobox"], select').forEach((e) => {
      if (e.offsetParent) {
        out.push({
          tag: e.tagName, type: e.type || '', ph: e.placeholder || '',
          label: e.getAttribute('aria-label') || '', val: e.value || '',
          en: !e.disabled,
        });
      }
    });
    return out;
  });
  console.log('INVENTORY: ' + JSON.stringify(inv, null, 1));
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
