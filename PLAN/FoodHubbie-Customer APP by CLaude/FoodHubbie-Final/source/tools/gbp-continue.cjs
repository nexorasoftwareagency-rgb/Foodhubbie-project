// GBP continue: name + category + address + phone/hours/verification
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
}

(async () => {
  const { chromium } = require('playwright');
  const ctx = await chromium.launchPersistentContext('C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  const state = async (n = 1000) =>
    console.log('STATE: ' + (await page.evaluate(() => document.body.innerText)).slice(0, n));

  // Check current state
  await state();

  // Try to find and click "Create a business with this name" / "Add your business to Google"
  const clicked = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (/create a business with this name|add your business to google|start building/i.test((walker.currentNode.textContent || '').trim())) nodes.push(walker.currentNode);
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
  if (clicked) {
    await page.mouse.click(clicked.x, clicked.y);
    await new Promise(r => setTimeout(r, 5000));
  }

  // Now on the actual form page - fill name + category
  await new Promise(r => setTimeout(r, 3000));
  const inputs = page.locator('input:not([disabled])');
  for (let i = 0; i < (await inputs.count()); i++) {
    if (await inputs.nth(i).isVisible()) {
      const v = await inputs.nth(i).inputValue().catch(() => '');
      if (!v) {
        await inputs.nth(i).click();
        await inputs.nth(i).fill('FoodHubbie ERP');
        break;
      }
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  // Category
  const combos = page.getByRole('combobox');
  for (let i = 0; i < (await combos.count()); i++) {
    if (await combos.nth(i).isVisible()) {
      await combos.nth(i).click();
      await combos.nth(i).fill('Software company');
      await new Promise(r => setTimeout(r, 2500));
      await page.evaluate(() => {
        const o = [...document.querySelectorAll('[role="option"]')].find(
          (e) => e.offsetParent && e.textContent.trim() === 'Software company'
        );
        o?.click();
      });
      break;
    }
  }
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => {
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

  await new Promise(r => setTimeout(r, 5000));

  // Address
  const vals = ['Vill - Anjani, P.O - Anjani, P.S - Parsa', 'Parsa', '841219'];
  const addrInputs = page.locator('input[type="text"]');
  let vi = 0;
  for (let i = 0; i < (await page.locator('input[type="text"]').count()) && vi < vals.length; i++) {
    if (await page.locator('input[type="text"]').nth(i).isVisible()) {
      await page.locator('input[type="text"]').nth(i).click();
      await page.locator('input[type="text"]').nth(i).fill(vals[vi++]);
      await new Promise(r => setTimeout(r, 400));
    }
  }
  // State dropdown -> Bihar
  const stateCombos = page.getByRole('combobox');
  for (let i = 0; i < (await page.getByRole('combobox').count()); i++) {
    if (await page.getByRole('combobox').nth(i).isVisible()) {
      await page.getByRole('combobox').nth(i).click();
      await new Promise(r => setTimeout(r, 1500));
      await page.evaluate(() => {
        const o = [...document.querySelectorAll('[role="option"]')].find(
          (e) => e.offsetParent && /bihar/i.test(e.textContent)
        );
        o?.click();
      });
      break;
    }
  }
  await new Promise(r => setTimeout(r, 1000));
  // Next
  await page.evaluate(() => {
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
  await new Promise(r => setTimeout(r, 8000));

  // Phone / hours / verification
  await new Promise(r => setTimeout(r, 3000));
  const final = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  console.log('FINAL: ' + final.slice(0, 1200));
  await page.screenshot({ path: 'website/gbp-state.png' });
  console.log('screenshot: website/gbp-state.png');
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });