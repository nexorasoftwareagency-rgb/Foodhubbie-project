// Verify: "Combos" pill appears in category filters; selecting it hides dish list, shows only combo grid.
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
  const combo = {
    name: 'Pill Test Combo',
    items: [
      { dishId: '-OrsBLj9_DY1vee3_G9z', qty: 1, price: 109 },
      { dishId: '-Ors9dhe8IYFxYkBXzOn', qty: 1, price: 119 },
    ],
    discountType: 'percentage',
    discountValue: 15,
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

    // --- QR menu ---
    await page.goto(MENU + '/?o=pizza&b=roshani-pizza&t=2B5YC71M1M5L654D');
    // Welcome screen is a race (session may auto-advance); dismiss via DOM if still up
    await page.waitForFunction(() => !!document.querySelector('.screen.active'), { timeout: 15000 });
    await page.evaluate(() => {
      if (!document.getElementById('screenMenu')?.classList.contains('active'))
        document.getElementById('btnStartOrdering')?.click();
    });
    await page.waitForSelector('#screenMenu.active', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#categoryPillsRow .category-pill', { state: 'attached', timeout: 15000 });
    const pills = await page.locator('#categoryPillsRow .category-pill').allTextContents();
    console.log('QR pills:', pills.join(' | '));
    const hasCombosPill = pills.some(p => p.trim() === 'Combos');
    console.log('QR has Combos pill:', hasCombosPill);
    await page.screenshot({ path: path.join(SHOTS, 'pill-qr-all.png'), fullPage: false });

    // Click Combos pill
    await page.locator('#categoryPillsRow .category-pill', { hasText: 'Combos' }).click();
    await page.waitForTimeout(500);
    const dishHidden = await page.locator('#dishListContainer').isHidden();
    const titleHidden = await page.locator('#menuSectionTitle').isHidden();
    const comboVisible = await page.locator('#comboOffersSection').isVisible();
    const comboCards = await page.locator('#comboOffersGrid .combo-card').count();
    console.log('QR after Combos pill — dishList hidden:', dishHidden, 'title hidden:', titleHidden, 'combo section visible:', comboVisible, 'combo cards:', comboCards);
    await page.screenshot({ path: path.join(SHOTS, 'pill-qr-combos.png'), fullPage: false });

    // Click back to All
    await page.locator('#categoryPillsRow .category-pill', { hasText: 'All' }).first().click();
    await page.waitForTimeout(500);
    const dishVisibleAgain = await page.locator('#dishListContainer').isVisible();
    console.log('QR back to All — dishList visible again:', dishVisibleAgain);

    // --- Delivery webview ---
    await page.goto(MENU + '/delivery.html?o=pizza&b=roshani-pizza');
    const dStart = page.locator('button', { hasText: /START ORDERING/i });
    if (await dStart.isVisible().catch(() => false)) {
      await dStart.click();
      await page.waitForTimeout(1500);
    }
    await page.waitForSelector('#categoryPillsRow .category-pill', { state: 'attached', timeout: 20000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#categoryPillsRow .category-pill');
      return el && el.getBoundingClientRect().height > 0;
    }, { timeout: 15000 });
    const dPills = await page.locator('#categoryPillsRow .category-pill').allTextContents();
    console.log('Delivery pills:', dPills.join(' | '));
    const dHasCombos = dPills.some(p => p.trim() === 'Combos');
    console.log('Delivery has Combos pill:', dHasCombos);
    await page.locator('#categoryPillsRow .category-pill', { hasText: 'Combos' }).click();
    await page.waitForTimeout(500);
    const dDishHidden = await page.locator('#dishListContainer').isHidden();
    const dComboVisible = await page.locator('#comboOffersSection').isVisible();
    console.log('Delivery after Combos pill — dishList hidden:', dDishHidden, 'combo section visible:', dComboVisible);
    await page.screenshot({ path: path.join(SHOTS, 'pill-delivery-combos.png'), fullPage: false });

    await browser.close();

    const pass = hasCombosPill && dishHidden && titleHidden && comboVisible && comboCards > 0 && dishVisibleAgain && dHasCombos && dDishHidden && dComboVisible;
    console.log(pass ? 'PASS: Combos pill works on both QR menu and delivery' : 'FAIL');
    if (!pass) process.exitCode = 1;
  } finally {
    if (comboId) {
      const del = await rest('DELETE', 'combos/' + comboId, OWNER.idToken);
      console.log('combo cleaned', del.status);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
