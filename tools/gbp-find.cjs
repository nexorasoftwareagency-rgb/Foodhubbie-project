// GBP find-business step: type name, then click "Add your business to Google".
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
  await page.waitForSelector('input[type="text"]', { timeout: 30000 });
  await sleep(2000);
  const inputs = page.locator('input:not([disabled])');
  const n = await inputs.count();
  let done = false;
  for (let i = 0; i < n; i++) {
    if (await inputs.nth(i).isVisible()) {
      await inputs.nth(i).click();
      await inputs.nth(i).fill('FoodHubbie ERP');
      done = true;
      break;
    }
  }
  if (!done) { console.log('NO-ENABLED-INPUT'); await ctx.close(); process.exit(3); }
  await sleep(3000);
  const t = await page.evaluate(() => document.body.innerText.slice(0, 900));
  console.log('AFTER-TYPE: ' + t);
  const clicked = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      if (/add your business to google/i.test((walker.currentNode.textContent || '').trim())) nodes.push(walker.currentNode);
    }
    for (const x of nodes) {
      let el = x.parentElement;
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
    await sleep(5000);
    console.log('AFTER-ADD: ' + (await page.evaluate(() => document.body.innerText)).slice(0, 700));
  } else {
    console.log('NO-ADD-LINK');
  }
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
