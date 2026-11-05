// Live verify: POS combo tiles + delivery.html webview + manager tab gating.
// Auth via in-page signInWithCustomToken (bypasses password throttle).
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'));

const OWNER = JSON.parse(fs.readFileSync('C:/Users/2nile/AppData/Local/Temp/opencode/mint-owner.json', 'utf8'));
const MGR = JSON.parse(fs.readFileSync('C:/Users/2nile/AppData/Local/Temp/opencode/mint-manager.json', 'utf8'));
const BASE = 'https://foodhubbie-admins.web.app';
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

async function injectAuth(page, mint) {
  await page.goto(BASE + '/index.html');
  await page.evaluate(async (customToken) => {
    const appMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    const cfg = {
      apiKey: 'AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4',
      authDomain: 'foodhubbie-10.firebaseapp.com',
      projectId: 'foodhubbie-10',
      databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
    };
    const app = appMod.getApps().length
      ? appMod.getApp()
      : appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    await authMod.signInWithCustomToken(auth, customToken);
  }, mint.customToken);
  // Reload so main.js onAuthStateChanged sees the signed-in user
  await page.goto(BASE + '/index.html');
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();

  // --- Seed active combo (20% off: 109+119=228 -> 182) ---
  const combo = {
    name: 'E2E Combo Deal',
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
  console.log('combo seeded', comboId, 'status', seed.status);

  try {
    // ===== 1. OWNER: Admin shell + Combos tab + POS tiles =====
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await injectAuth(page, OWNER);
    await page.waitForSelector('.layout:not(.hidden)', { timeout: 45000 });
    console.log('owner shell loaded');

    // Combos tab
    const combosNav = page.locator('#menu-combos .nav-btn');
    console.log('combos nav visible:', await combosNav.isVisible().catch(() => false));
    await combosNav.click();
    await page.waitForSelector('#comboList', { timeout: 10000 });
    await page.screenshot({ path: path.join(SHOTS, 'live-admin-combos.png'), fullPage: true });
    console.log('shot: live-admin-combos.png');

    // POS walkin tab + combo tiles
    await page.locator('#menu-walkin .nav-btn').click();
    await page.waitForSelector('.pos-combo-tile, #walkinCatalog', { timeout: 15000 });
    await page.waitForTimeout(1500); // combo tiles async
    const tileCount = await page.locator('.pos-combo-tile').count();
    console.log('POS combo tiles:', tileCount);
    await page.screenshot({ path: path.join(SHOTS, 'live-pos-combos.png'), fullPage: true });
    console.log('shot: live-pos-combos.png');

    if (tileCount > 0) {
      await page.locator('.pos-combo-tile').first().click();
      await page.waitForTimeout(800);
      const cartText = await page.locator('#walkinCartItems').innerText().catch(() => '');
      const has87 = cartText.includes('87');
      const has95 = cartText.includes('95');
      console.log('POS cart has 87:', has87, '95:', has95);
      await page.screenshot({ path: path.join(SHOTS, 'live-pos-combo-cart.png'), fullPage: true });
      console.log('shot: live-pos-combo-cart.png');
    }

    // ===== 2. Manager: Settings tab hidden + switchTab blocked =====
    const mctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const mpage = await mctx.newPage();
    await injectAuth(mpage, MGR);
    await mpage.waitForSelector('.layout:not(.hidden)', { timeout: 45000 });
    console.log('manager shell loaded');

    const settingsNav = mpage.locator('#menu-settings');
    const settingsHidden = await settingsNav.isHidden();
    console.log('manager settings nav hidden:', settingsHidden);

    const walkinNav = mpage.locator('#menu-walkin');
    console.log('manager walkin nav visible:', await walkinNav.isVisible().catch(() => false));
    const combosNavM = mpage.locator('#menu-combos');
    console.log('manager combos nav visible:', await combosNavM.isVisible().catch(() => false));

    // Attempt blocked switchTab via hash/eval
    const blocked = await mpage.evaluate(() => {
      // switchTab is module-scoped; try hash nav instead
      location.hash = '#settings';
      return location.hash;
    });
    await mpage.waitForTimeout(1500);
    const activeTab = await mpage.evaluate(() => {
      const el = document.querySelector('.nav-btn.active');
      return el ? el.getAttribute('data-tab') : null;
    });
    console.log('manager after #settings hash, active tab:', activeTab, '(should NOT be settings)');
    await mpage.screenshot({ path: path.join(SHOTS, 'live-manager-tabs.png'), fullPage: true });
    console.log('shot: live-manager-tabs.png');

    // ===== 3. delivery.html webview (no token needed) =====
    const wctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const wpage = await wctx.newPage();
    await wpage.goto(MENU + '/delivery.html?o=pizza&b=roshani-pizza');
    await wpage.waitForSelector('#comboOffersSection', { timeout: 20000 }).catch(() => null);
    const comboSection = await wpage.locator('#comboOffersSection').isVisible().catch(() => false);
    console.log('webview combo section visible:', comboSection);
    if (comboSection) {
      const cardCount = await wpage.locator('.combo-card, .combo-card-btn').count();
      console.log('webview combo cards:', cardCount);
      if (cardCount > 0) {
        await wpage.locator('.combo-card-btn').first().click().catch(() => {});
        await wpage.waitForTimeout(600);
      }
    }
    await wpage.screenshot({ path: path.join(SHOTS, 'live-webview-combos.png'), fullPage: true });
    console.log('shot: live-webview-combos.png');

    await browser.close();
  } finally {
    // Cleanup combo
    if (comboId) {
      const del = await rest('DELETE', 'combos/' + comboId, OWNER.idToken);
      console.log('combo cleaned up', del.status);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
