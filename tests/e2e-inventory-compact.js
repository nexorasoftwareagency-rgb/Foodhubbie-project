// e2e-inventory-compact.js — verify the Inventory tab density pass (UI-only change).
const path = require('path');
const { chromium } = require('D:/Foodhubbie Project/node_modules/playwright');
const BASE = process.env.E2E_ADMIN_BASE || 'https://foodhubbie-admins.web.app/';
const T = 'C:/Users/2nile/AppData/Local/Temp/opencode';
const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass }); console.log(`  ${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.fill('#loginEmail', 'e2e-owner@foodhubbie-test.com');
    await page.fill('#loginPassword', 'E2eOwner#2026');
    await page.click('#loginBtn');
    await page.waitForTimeout(6000);

    await page.locator('.nav-btn[data-tab="inventory"]').first().click();
    await page.waitForTimeout(2500);

    // Turn both feature toggles ON so the Menu Items grid shows with controls
    const avail = page.locator('#toggleAvailability');
    if (await avail.count()) {
        const checked = await avail.isChecked();
        if (!checked) { await avail.click(); await page.waitForTimeout(3000); }
    }
    const stock = page.locator('#toggleStockTracking');
    if (await stock.count()) {
        const checked = await stock.isChecked();
        if (!checked) { await stock.click(); await page.waitForTimeout(3000); }
    }
    await page.waitForTimeout(2500);

    const m = await page.evaluate(() => {
        const grid = document.getElementById('inventoryMenuGrid');
        const cards = [...grid.querySelectorAll('.inventory-dish-card')];
        const rect = grid.getBoundingClientRect();
        return {
            cards: cards.length,
            first: cards[0] ? cards[0].getBoundingClientRect() : null,
            gridWidth: Math.round(rect.width),
            cols: cards.length > 1 ? Math.round(rect.width / (cards[1].getBoundingClientRect().x - cards[0].getBoundingClientRect().x)) : 1,
            cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
            cardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
            toggleW: (document.querySelector('.inventory-dish-card .toggle-switch-sm') || {}).offsetWidth || 0,
            btnW: (document.querySelector('.inventory-dish-card .stock-adjust-btn') || {}).offsetWidth || 0,
            perScreen: 0,
        };
    });
    ok('menu grid renders', m.cards > 0, `${m.cards} cards`);
    ok('cards are compact', m.cardW > 0 && m.cardW < 140, `card ${m.cardW}x${m.cardH}px on a ${m.gridWidth}px grid -> ~${m.cols} columns`);
    ok('mini controls applied', m.toggleW > 0 && m.toggleW <= 30 && (m.btnW === 0 || m.btnW <= 26), `toggle ${m.toggleW}px, adjust-btn ${m.btnW || 0}px (0 = no tracked items in this outlet)`);
    ok('30 per page', m.cards <= 30, `cards on page: ${m.cards} (limit 30)`);
    const estRows = Math.ceil(m.cards / m.cols);
    ok('more on screen', m.cardH * Math.min(estRows, 6) <= 900, `~${m.cols} cols x ${estRows} rows of ${m.cardH}px cards`);
    await page.screenshot({ path: path.join(T, 'inventory-compact.png'), fullPage: false });
    // scroll to grid for a closer look
    await page.evaluate(() => document.getElementById('inventoryMenuSection').scrollIntoView());
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(T, 'inventory-compact-grid.png') });

    // ---- Menu Management tab (same density pass) ----
    await page.locator('.nav-btn[data-tab="menu"]').first().click();
    await page.waitForTimeout(3500);
    const mo = await page.evaluate(() => {
        const grid = document.getElementById('menuGrid');
        const cards = [...grid.querySelectorAll('.dish-card')];
        const rect = grid.getBoundingClientRect();
        return {
            cards: cards.length,
            gridWidth: Math.round(rect.width),
            cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
            cardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
            stepX: cards.length > 1 ? Math.round(cards[1].getBoundingClientRect().x - cards[0].getBoundingClientRect().x) : 0,
            btnW: (grid.querySelector('.btn-action-v4') || {}).offsetWidth || 0,
            chipPad: (() => { const c = grid.querySelector('.price-chip-v4'); return c ? Math.round(getComputedStyle(c).getPropertyValue('padding-top').replace('px', '')) : 0; })(),
        };
    });
    ok('menu tab cards render', mo.cards > 0, `${mo.cards} cards`);
    ok('menu tab cards compact', mo.cardW > 0 && mo.cardW < 150, `card ${mo.cardW}x${mo.cardH}px -> ~${mo.stepX ? Math.round(mo.gridWidth / mo.stepX) : 1} columns on ${mo.gridWidth}px`);
    ok('menu tab action buttons compact', mo.btnW === 0 || mo.btnW <= 28, `edit/delete btn ${mo.btnW}px`);
    ok('menu tab price chips compact', mo.chipPad > 0 && mo.chipPad <= 6, `chip vertical padding ${mo.chipPad}px`);
    await page.evaluate(() => document.getElementById('tab-menu').scrollIntoView());
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(T, 'menu-compact.png') });

    await browser.close();
    const fails = results.filter(r => !r.pass).length;
    console.log(`\nRESULT: ${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1); });
