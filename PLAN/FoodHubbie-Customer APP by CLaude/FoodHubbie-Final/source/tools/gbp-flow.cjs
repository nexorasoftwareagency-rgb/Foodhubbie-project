// GBP creation driver: waits for manual Google login, then fills the flow.
// Run: node tools/gbp-flow.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const PROFILE = 'C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function text(page) {
  return (await page.evaluate(() => document.body.innerText)).slice(0, 900);
}
async function clickText(page, re, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
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
    if (pt) {
      await page.mouse.click(pt.x, pt.y);
      return true;
    }
    await sleep(1500);
  }
  return false;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  // 1. Wait for manual login (up to 10 min)
  await page.goto('https://search.google.com/search-console?resource_id=https%3A%2F%2Ffoodhubbie-web.web.app%2F');
  let authed = false;
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    const url = page.url();
    if (!/ServiceLogin|accounts\.google\.com/.test(url)) { authed = true; break; }
    if (i % 12 === 0) console.log('waiting for login... (' + (i * 5) + 's)');
  }
  if (!authed) { console.log('LOGIN-TIMEOUT'); await ctx.close(); process.exit(2); }
  console.log('AUTHENTICATED');

  // 2. GBP creation flow
  await page.goto('https://business.google.com/create/new?hl=en');
  await sleep(5000);
  console.log('STEP0: ' + (await text(page)).slice(0, 200));

  // Business name
  const nameBox = page.getByRole('textbox').first();
  await nameBox.click();
  await nameBox.fill('FoodHubbie ERP');
  await sleep(800);
  await clickText(page, '^continue$');
  await sleep(4000);

  // Website (online-store step may or may not appear)
  let t = await text(page);
  if (/online store|web address/i.test(t)) {
    const boxes = page.getByRole('textbox');
    for (let i = 0; i < (await boxes.count()); i++) {
      if (await boxes.nth(i).isVisible()) {
        await boxes.nth(i).click();
        await boxes.nth(i).fill('https://foodhubbie-web.web.app/');
        break;
      }
    }
    await sleep(800);
    await clickText(page, '^next$');
    await sleep(4000);
  }

  // Category
  t = await text(page);
  if (/business categor/i.test(t)) {
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
    await clickText(page, '^next$');
    await sleep(4000);
  }

  // Address
  t = await text(page);
  if (/street address/i.test(t)) {
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
    // State dropdown -> Bihar
    const combos = page.getByRole('combobox');
    const cn = await combos.count();
    for (let i = 0; i < cn; i++) {
      if (await combos.nth(i).isVisible()) {
        await combos.nth(i).click();
        await sleep(1200);
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
    await clickText(page, '^next$');
    await sleep(5000);
  }

  const final = await text(page);
  console.log('FINAL-STATE: ' + final);
  await page.screenshot({ path: 'website/gbp-state.png' });
  console.log('screenshot: website/gbp-state.png');
  await ctx.close();
})().catch((e) => { console.error('FLOW-FAIL:', e.message); process.exit(1); });
