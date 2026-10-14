// Verify: combo-only POS cart must NOT auto-apply category discount (Navratri 18%).
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'));

const OWNER = JSON.parse(fs.readFileSync('C:/Users/2nile/AppData/Local/Temp/opencode/mint-owner.json', 'utf8'));
const BASE = 'https://foodhubbie-admins.web.app';
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
    name: 'E2E Stack Test',
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
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
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
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
      await authMod.signInWithCustomToken(authMod.getAuth(app), customToken);
    }, OWNER.customToken);
    await page.goto(BASE + '/index.html');
    await page.waitForSelector('.layout:not(.hidden)', { timeout: 45000 });

    await page.locator('#menu-walkin .nav-btn').click();
    await page.waitForSelector('.pos-combo-tile', { timeout: 15000 });
    await page.locator('.pos-combo-tile').first().click();
    await page.waitForTimeout(1200);

    const summary = await page.locator('#walkinOrderSummary, .walkin-summary, [class*="summary"]').first().innerText().catch(() => '');
    const cartPanel = await page.locator('#walkinCartItems').innerText().catch(() => '');
    const fullPanel = await page.locator('#walkinCart, aside, .cart-panel').first().innerText().catch(() => '');

    const hasDiscountRow = /Discount Allotted|-₹/.test(fullPanel) && /Discount Allotted/.test(fullPanel);
    const has87 = cartPanel.includes('87');
    const has95 = cartPanel.includes('95');
    console.log('cart 87:', has87, '95:', has95);
    console.log('discount row present:', hasDiscountRow);

    // Extract subtotal + total from summary
    const subtotalMatch = fullPanel.match(/Subtotal\s*₹([\d,.]+)/i);
    const totalMatch = fullPanel.match(/Total\s*₹([\d,.]+)/i);
    console.log('subtotal:', subtotalMatch && subtotalMatch[1], 'total:', totalMatch && totalMatch[1]);

    await page.screenshot({ path: path.join(SHOTS, 'live-pos-no-stack.png'), fullPage: true });
    console.log('shot: live-pos-no-stack.png');

    // PASS = no Discount Allotted row on combo-only cart
    if (hasDiscountRow) {
      console.log('FAIL: discount still stacking on combo-only cart');
      process.exitCode = 1;
    } else {
      console.log('PASS: no auto-discount on combo-only cart');
    }

    await browser.close();
  } finally {
    if (comboId) {
      const del = await rest('DELETE', 'combos/' + comboId, OWNER.idToken);
      console.log('combo cleaned', del.status);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
