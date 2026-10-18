// Live check: do combos appear in QR table menu as a separate "Combo Offers" category?
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'));

const OWNER = JSON.parse(fs.readFileSync('C:/Users/2nile/AppData/Local/Temp/opencode/mint-owner.json', 'utf8'));
const MENU = 'https://foodhubbie-qrmenu.web.app';
const DB = 'https://foodhubbie-10-default-rtdb.firebaseio.com/businesses/roshani-pizza/outlets/pizza';
const SHOTS = '.playwright-mcp';
const now = Date.now();

async function rest(method, path_, token, body) {
  const url = `${DB}/${path_}.json?auth=${token}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  // Seed: 20% combo 109+119=228 -> 182
  const combo = {
    name: 'Live Combo Offers Check',
    items: [
      { dishId: '-OrsBLj9_DY1vee3_G9z', qty: 1, price: 109 },
      { dishId: '-Ors9dhe8IYFxYkBXzOn', qty: 1, price: 119 },
    ],
    discountType: 'percentage',
    discountValue: 20,
    startAt: now - 3600e3,
    endAt: now + 86400e3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const seed = await rest('POST', 'combos', OWNER.idToken, combo);
  const comboId = seed.json && seed.json.name;
  console.log('combo seeded', comboId, seed.status);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(MENU + '/?o=pizza&b=roshani-pizza&t=2B5YC71M1M5L654D');
    await page.waitForFunction(() => !!document.querySelector('.screen.active'), { timeout: 15000 });
    await page.evaluate(() => {
      if (!document.getElementById('screenMenu')?.classList.contains('active'))
        document.getElementById('btnStartOrdering')?.click();
    });
    await page.waitForSelector('#screenMenu.active', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#categoryPillsRow .category-pill', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1200);

    const state = await page.evaluate(() => {
      const pills = [...document.querySelectorAll('#categoryPillsRow .category-pill')].map(b => ({
        text: b.textContent.trim(), active: b.classList.contains('active'), w: Math.round(b.getBoundingClientRect().width),
      }));
      const sec = document.getElementById('comboOffersSection');
      const sr = sec.getBoundingClientRect();
      return {
        pills,
        comboSection: { hidden: sec.classList.contains('hidden'), top: Math.round(sr.top), h: Math.round(sr.height) },
        comboCards: document.querySelectorAll('#comboOffersGrid .combo-card').length,
        cardText: document.querySelector('#comboOffersGrid .combo-card')?.innerText.replace(/\n/g, ' / ').slice(0, 140) || null,
        menuScrollTop: document.getElementById('screenMenu')?.scrollTop,
      };
    });
    console.log(JSON.stringify(state, null, 1));

    // Screenshot 1: top of menu (pills + Combo Offers section)
    await page.screenshot({ path: path.join(SHOTS, 'qr-combo-category-top.png') });

    // Screenshot 2: after clicking Combos pill
    await page.locator('#categoryPillsRow .category-pill', { hasText: 'Combos' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, 'qr-combo-category-filtered.png') });
    const filtered = await page.evaluate(() => ({
      dishHidden: document.getElementById('dishListContainer').classList.contains('hidden'),
      titleHidden: document.getElementById('menuSectionTitle').classList.contains('hidden'),
      cards: document.querySelectorAll('#comboOffersGrid .combo-card').length,
      sectionTop: Math.round(document.getElementById('comboOffersSection').getBoundingClientRect().top),
    }));
    console.log('after Combos pill:', JSON.stringify(filtered));

    const pass = state.pills.some(p => p.text === 'Combos') && !state.comboSection.hidden && state.comboCards > 0 && filtered.dishHidden;
    console.log(pass ? 'PASS' : 'FAIL');
    if (!pass) process.exitCode = 1;
  } finally {
    await browser.close();
    if (comboId) {
      const del = await rest('DELETE', 'combos/' + comboId, OWNER.idToken);
      console.log('combo cleaned', del.status);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
