// Live verify: redesigned combo cards (veggie mark, scrim badge, floating ADD, full-card sheet,
// category-aware visibility, badge bump). Seeds a fresh far-future combo each run.
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
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  // Seed fresh 2-item combo active for 30 days
  const comboIdBase = 'verify-combo-' + now;
  const seed = {
    name: 'Verify Combo', items: [
      { dishId: '-OrsBLj9_DY1vee3_G9z', qty: 1, price: 109 },
      { dishId: '-Ors9dhe8IYFxYkBXzOn', qty: 1, price: 119 },
    ], discountType: 'percentage', discountValue: 20,
    startAt: now - 3600e3, endAt: now + 30 * 86400e3,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const s = await rest('PUT', 'combos/' + comboIdBase, OWNER.idToken, seed);
  const comboId = comboIdBase;
  console.log('using combo:', comboId, 'status:', s.status);

  const browser = await chromium.launch();
  let pass = true;
  const ck = (label, cond, actual) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}:`, actual); if (!cond) pass = false; };

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    await page.goto(MENU + '/?o=pizza&b=roshani-pizza&t=2B5YC71M1M5L654D');
    await page.waitForFunction(() => !!document.querySelector('.screen.active'), { timeout: 15000 });
    await page.evaluate(() => { if (!document.getElementById('screenMenu')?.classList.contains('active')) document.getElementById('btnStartOrdering')?.click(); });
    await page.waitForSelector('#screenMenu.active', { state: 'attached', timeout: 15000 });
    await page.waitForSelector('#categoryPillsRow .category-pill', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(600);

    const pills = await page.locator('#categoryPillsRow .category-pill').allTextContents();
    ck('QR pills include Combos', pills.some(p => p.trim() === 'Combos'), pills.join(' | '));
    await page.waitForSelector('#comboOffersSection:not(.hidden)', { timeout: 10000 });
    const cards = await page.locator('#comboOffersGrid .combo-card').count();
    const hasMark = await page.locator('.combo-veg, .combo-nonveg').count() > 0;
    const hasFab = await page.locator('.combo-fab').count() > 0;
    const hasOff = await page.locator('.combo-img-off').count() > 0;
    ck('QR combo cards present', cards > 0, `${cards} cards`);
    ck('QR veg/non-veg mark present', hasMark);
    ck('QR floating ADD present', hasFab);
    ck('QR 20% OFF scrim badge present', hasOff);
    await page.screenshot({ path: path.join(SHOTS, 'ux-qr-all.png') });

    await page.locator('#categoryPillsRow .category-pill', { hasText: 'Pizza' }).click();
    await page.waitForTimeout(500);
    ck('QR combo section hidden under Pizza', (await page.locator('#comboOffersSection.hidden').count()) === 1);

    await page.locator('#categoryPillsRow .category-pill', { hasText: 'All' }).first().click();
    await page.waitForTimeout(500);
    ck('QR combo section visible again on All', (await page.locator('#comboOffersSection:not(.hidden)').count()) === 1);

    // Sheet test
    await page.locator(`[data-combo-id="${comboId}"]`).click();
    await page.waitForSelector('#comboSheet.show', { timeout: 10000 });
    const sheetItems = await page.locator('#comboSheet .combo-sheet-row').count();
    ck('QR sheet opens with item rows', sheetItems >= 1, sheetItems);
    await page.screenshot({ path: path.join(SHOTS, 'ux-qr-sheet.png') });
    await page.locator('#comboSheet #comboSheetAdd').click();
    await page.waitForTimeout(800);
    await page.waitForFunction(() => !document.getElementById('comboSheet'), { timeout: 5000 });
    const badge1 = await page.locator('#menuCartCount').textContent();
    ck('QR badge 0->2 after sheet ADD', badge1.trim() === '2', badge1);

    // FAB click: 2->4
    await page.locator(`[data-combo-id="${comboId}"] .combo-fab`).click();
    await page.waitForTimeout(800);
    const badge2 = await page.locator('#menuCartCount').textContent();
    ck('QR badge 2->4 after FAB re-add', badge2.trim() === '4', badge2);
    await page.screenshot({ path: path.join(SHOTS, 'ux-qr-after-add.png') });

    // Delivery webview parity
    await page.goto(MENU + '/delivery.html?o=pizza&b=roshani-pizza');
    await page.waitForSelector('#categoryPillsRow .category-pill', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(600);
    const dPills = await page.locator('#categoryPillsRow .category-pill').allTextContents();
    ck('Delivery pills include Combos', dPills.some(p => p.trim() === 'Combos'), dPills.join(' | '));
    await page.waitForSelector('#comboOffersSection:not(.hidden)', { timeout: 10000 });
    const dCards = await page.locator('#comboOffersGrid .combo-card').count();
    ck('Delivery combo section visible', dCards > 0, `${dCards} cards`);
    await page.locator('#categoryPillsRow .category-pill', { hasText: 'Pizza' }).click();
    await page.waitForTimeout(500);
    ck('Delivery combo section hidden under Pizza', (await page.locator('#comboOffersSection.hidden').count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, 'ux-delivery.png') });

    console.log(pass ? 'PASS: combo UX redesign verified on QR + delivery' : 'FAIL');
    if (!pass) process.exitCode = 1;
  } finally {
    await browser.close();
    const d = await rest('DELETE', `combos/${comboIdBase}`, OWNER.idToken);
    console.log('combo cleaned', d.status);
  }
})().catch((e) => { console.error(e); process.exit(1); });
