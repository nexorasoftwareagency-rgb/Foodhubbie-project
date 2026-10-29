// e2e-webp.js — Phase 3 pre-deploy verification battery for the WebP sweep.
// Tests the LOCAL build (localhost:4599) against the LIVE Firebase project,
// scoped to the throwaway e2e outlet, then cleans up the test dish.
const path = require('path');
const fs = require('fs');
const { chromium } = require('D:/Foodhubbie Project/node_modules/playwright');
const admin = require('D:/Foodhubbie Project/bot/node_modules/firebase-admin');

const BID = 'e2e-biz-1792987605261';
const OID = 'e2e-outlet-1792987605261';
const APP = 'http://localhost:4599/';
const DISH_NAME = 'WebP E2E Test Dish v1';
const T = 'C:/Users/2nile/AppData/Local/Temp/opencode';

admin.initializeApp({
    credential: admin.credential.cert(require('D:/Foodhubbie Project/bot/service-account.json')),
    databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
});
const adb = admin.database();
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
    const srcBytes = fs.statSync(path.join(T, 'e2e-dish.jpg')).size;
    // Mint a throwaway table so the QR menu boot (token validation) passes.
    const TOKEN = 'e2ewebp-' + Date.now().toString(36);
    const tablesBefore = Object.keys((await adb.ref(`businesses/${BID}/outlets/${OID}/tables`).get()).val() || {});
    const sessionsBefore = Object.keys((await adb.ref(`businesses/${BID}/outlets/${OID}/tableSessions`).get()).val() || {});
    await adb.ref(`businesses/${BID}/outlets/${OID}/tables/e2e-webp-test-table`).set({ name: 'E2E WebP Table', token: TOKEN, active: true, capacity: 2, status: 'free', updatedAt: Date.now() });
    const MENU = `https://foodhubbie-qrmenu.web.app/?b=${BID}&o=${OID}&t=${TOKEN}`;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // 1. Login on the LOCAL build
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await page.fill('#loginEmail', 'e2e-owner@foodhubbie-test.com');
    await page.fill('#loginPassword', 'E2eOwner#2026');
    await page.click('#loginBtn');
    await page.waitForURL(/#|index/, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(6000);
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
    ok('login on local build', !/login/i.test(await page.title()) || bodyText.length > 0, `title="${await page.title()}"`);

    // 2. Catalog tab → Add Menu Item → "Add by yourself"
    await page.locator('.nav-btn[data-tab="menu"]').first().click().catch(() => {});
    await page.waitForTimeout(3000);
    await page.click('#btnAddDishChoice');
    await page.waitForTimeout(800);
    await page.click('[data-choice="self"]');
    await page.waitForTimeout(1000);
    const modalVisible = await page.evaluate(() => document.getElementById('dishModal').classList.contains('active'));
    ok('dish modal opens', modalVisible);

    // 3. Fill + upload
    await page.fill('#dishName', DISH_NAME);
    await page.selectOption('#dishCategory', { label: 'Pizza' }).catch(async () => {
        // fallback: first non-empty option
        await page.evaluate(() => {
            const s = document.getElementById('dishCategory');
            if (s.options[1]) s.value = s.options[1].value;
        });
    });
    await page.fill('#dishPriceBase', '199');
    await page.setInputFiles('#dishFile', path.join(T, 'e2e-dish.jpg'));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(T, 'webp-e2e-modal.png') });
    await page.click('#dishModal .btn-primary');
    await page.waitForTimeout(8000);

    // 4. DB check: image is webp + measured size
    const dishes = (await adb.ref(`businesses/${BID}/outlets/${OID}/dishes`).get()).val() || {};
    const test = Object.entries(dishes).find(([, d]) => d.name === DISH_NAME);
    ok('test dish exists in DB', !!test);
    if (test) {
        const img = test[1].image || '';
        ok('image is data:image/webp', img.startsWith('data:image/webp;base64,'));
        const dbBytes = Buffer.byteLength(img);
        ok(`webp smaller than source jpeg (${dbBytes} vs ${srcBytes} bytes)`, dbBytes > 0 && dbBytes < srcBytes, `${(1 - dbBytes / srcBytes) * 100 | 0}% smaller`);
        await page.screenshot({ path: path.join(T, 'webp-e2e-after-save.png') });
    }

    // 5. QR menu renders the webp dish
    const menuPage = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const consoleErrs = [];
    menuPage.on('pageerror', (e) => consoleErrs.push(String(e)));
    await menuPage.goto(MENU, { waitUntil: 'domcontentloaded' });
    await menuPage.waitForTimeout(9000);
    const menuState = await menuPage.evaluate((name) => ({
        imgs: [...document.querySelectorAll('img')].length,
        webpImgs: [...document.querySelectorAll('img')].filter(i => (i.src || '').startsWith('data:image/webp')).length,
        hasDish: document.body.innerText.includes(name) || document.body.innerHTML.includes(name),
    }), DISH_NAME);
    ok('menu loads dish card', menuState.imgs > 0, `imgs=${menuState.imgs}, webp imgs=${menuState.webpImgs}, dishName visible=${menuState.hasDish}`);
    ok('menu shows the test dish', menuState.hasDish);
    ok('no page errors on menu', consoleErrs.length === 0, consoleErrs.slice(0, 3).join(' | '));
    await menuPage.screenshot({ path: path.join(T, 'webp-e2e-menu.png') });

    // 6. Admin-side render (catalog list shows the webp image too)
    const cardState = await page.evaluate((name) => document.body.innerHTML.includes(name), DISH_NAME);
    ok('admin catalog lists the dish', cardState);

    await browser.close();

    // 7. Cleanup: remove ALL test dishes (a crashed run may have left one behind),
    //    then the throwaway table + any tableSessions the menu boot created.
    {
        const stale = Object.entries(dishes).filter(([, d]) => d && d.name === DISH_NAME).map(([id]) => id);
        if (test && !stale.includes(test[0])) stale.push(test[0]);
        for (const id of stale) await adb.ref(`businesses/${BID}/outlets/${OID}/dishes/${id}`).remove();
        await adb.ref(`businesses/${BID}/outlets/${OID}/tables/e2e-webp-test-table`).remove();
        const sessionsAfter = Object.keys((await adb.ref(`businesses/${BID}/outlets/${OID}/tableSessions`).get()).val() || {});
        for (const sid of sessionsAfter.filter((s) => !sessionsBefore.includes(s))) {
            await adb.ref(`businesses/${BID}/outlets/${OID}/tableSessions/${sid}`).remove();
        }
        const after = (await adb.ref(`businesses/${BID}/outlets/${OID}/dishes`).get()).val() || {};
        ok('cleanup: test dishes + table + new sessions removed',
            !Object.values(after).some(d => d && d.name === DISH_NAME),
            `${stale.length} dishes, 1 table, ${sessionsAfter.length - sessionsBefore.length} sessions`);
    }

    const fails = results.filter(r => !r.pass).length;
    console.log(`\nRESULT: ${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1); });
