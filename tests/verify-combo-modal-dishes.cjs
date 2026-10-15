// Live verify: Create Combo modal dish multi-select lists ALL dishes (not just one).
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'));

const OWNER = JSON.parse(fs.readFileSync('C:/Users/2nile/AppData/Local/Temp/opencode/mint-owner.json', 'utf8'));
const BASE = 'https://foodhubbie-admins.web.app';
const DB = 'https://foodhubbie-10-default-rtdb.firebaseio.com/businesses/roshani-pizza/outlets/pizza';
const SHOTS = '.playwright-mcp';

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
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
    await authMod.signInWithCustomToken(authMod.getAuth(app), customToken);
  }, mint.customToken);
  await page.goto(BASE + '/index.html');
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await injectAuth(page, OWNER);
    await page.waitForSelector('#menu-combos', { timeout: 15000 });

    // Go to Combos tab
    await page.evaluate(() => { location.hash = '#combos'; });
    await page.waitForTimeout(1500);

    // Open Create Combo modal
    const addBtn = page.locator('button', { hasText: /Add Combo/i }).first();
    await addBtn.click({ timeout: 10000 });
    await page.waitForSelector('#comboDishList .cmb-row', { timeout: 15000 });
    await page.waitForTimeout(800); // let any late rows settle

    const rows = await page.locator('#comboDishList .cmb-row').count();
    const names = await page.locator('#comboDishList .cmb-name').allTextContents();
    const dishesRes = await fetch(`${DB}/dishes.json?auth=${OWNER.idToken}`);
    const dishes = await dishesRes.json();
    const dbCount = Object.keys(dishes || {}).length;

    console.log('modal dish rows:', rows, '| RTDB dishes:', dbCount);
    console.log('first 5:', names.slice(0, 5).join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'combo-modal-dishes.png') });

    // Search filter check
    await page.fill('#comboDishSearch', 'pizza');
    await page.waitForTimeout(300);
    const filtered = await page.locator('#comboDishList .cmb-row').count();
    console.log('after search "pizza":', filtered, 'rows');
    await page.fill('#comboDishSearch', 'zzzz');
    await page.waitForTimeout(300);
    const empty = await page.locator('#comboDishList .cmb-empty').count();
    console.log('search "zzzz" empty-state shown:', empty === 1);

    const pass = rows === dbCount && rows > 10 && empty === 1;
    console.log(pass ? 'PASS: multi-select lists all dishes, search works' : 'FAIL');
    if (!pass) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
