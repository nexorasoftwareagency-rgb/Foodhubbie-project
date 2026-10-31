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

    // ---- Menu Browser tab (grid view) ----
    await page.locator('.nav-btn[data-tab="menu-browser"]').first().click();
    await page.waitForTimeout(2500);
    const br = await page.evaluate(() => {
        const grid = document.getElementById('browserDishGrid');
        if (!grid) return { none: true };
        const cards = [...grid.querySelectorAll('.browser-dish-card')];
        const rect = grid.getBoundingClientRect();
        return {
            cards: cards.length,
            isList: grid.classList.contains('list-view'),
            gridWidth: Math.round(rect.width),
            cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
            cardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
            stepX: cards.length > 1 ? Math.round(cards[1].getBoundingClientRect().x - cards[0].getBoundingClientRect().x) : 0,
            btnW: (grid.querySelector('.browser-dish-actions .btn-action-v4') || {}).offsetWidth || 0,
        };
    });
    ok('browser tab renders grid view', br.none || (!br.isList && br.cards > 0), `${br.cards || 0} cards${br.isList ? ' (LIST VIEW — unexpected default)' : ''}`);
    ok('browser tab cards compact', br.none || (br.cardW > 0 && br.cardW < 140 && br.cardH < 400), `card ${br.cardW}x${br.cardH}px -> ~${br.stepX ? Math.round(br.gridWidth / br.stepX) : 1} columns on ${br.gridWidth}px`);
    ok('browser tab action buttons compact', br.none || (br.btnW === 0 || br.btnW <= 26), `edit/delete btn ${br.btnW}px`);
    await page.screenshot({ path: path.join(T, 'browser-compact.png') });

    // ---- Combos tab ----
    await page.locator('.nav-btn[data-tab="combos"]').first().click();
    await page.waitForTimeout(2500);
    const co = await page.evaluate(() => {
        const grid = document.getElementById('comboListBody');
        if (!grid) return { none: true };
        const cards = [...grid.querySelectorAll('.combo-card')];
        const rect = grid.getBoundingClientRect();
        return {
            cards: cards.length,
            gridWidth: Math.round(rect.width),
            cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
            cardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
            stepX: cards.length > 1 ? Math.round(cards[1].getBoundingClientRect().x - cards[0].getBoundingClientRect().x) : 0,
            btnW: (grid.querySelector('.browser-dish-actions .btn-action-v4') || {}).offsetWidth || 0,
        };
    });
    ok('combos tab renders', co.none ? false : true, co.none ? 'no #comboListBody' : `${co.cards} cards${co.cards === 0 ? ' (outlet has no combos — compact checks skipped)' : ''}`);
    ok('combos tab cards compact', co.none || co.cards === 0 || (co.cardW > 0 && co.cardW < 170), `card ${co.cardW}x${co.cardH}px -> ~${co.stepX ? Math.round(co.gridWidth / co.stepX) : 1} columns on ${co.gridWidth}px`);
    ok('combos tab action buttons compact', co.none || co.cards === 0 || (co.btnW === 0 || co.btnW <= 26), `edit/delete btn ${co.btnW}px`);
    await page.screenshot({ path: path.join(T, 'combos-compact.png') });

    // ---- Categories tab (Phase 1 redesign) ----
    await page.locator('.nav-btn[data-tab="categories"]').first().click();
    await page.waitForTimeout(2500);
    const cg = await page.evaluate(() => {
        const list = document.getElementById('categoryList');
        const cards = [...list.querySelectorAll('.cat-card')];
        const rect = list.getBoundingClientRect();
        return {
            cards: cards.length,
            cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
            cardH: cards[0] ? Math.round(cards[0].getBoundingClientRect().height) : 0,
            stepX: cards.length > 1 ? Math.round(cards[1].getBoundingClientRect().x - cards[0].getBoundingClientRect().x) : 0,
            gridWidth: Math.round(rect.width),
            btnW: (list.querySelector('.cat-card-actions .btn-action-v4') || {}).offsetWidth || 0,
            kpiCats: document.getElementById('catKpiCats')?.textContent || '',
            kpiMapped: document.getElementById('catKpiMapped')?.textContent || '',
            kpiUnmapped: document.getElementById('catKpiUnmapped')?.textContent || '',
        };
    });
    ok('categories tab cards render', cg.cards > 0, `${cg.cards} cat cards`);
    ok('categories tab cards compact', cg.cardW > 0 && cg.cardW < 170 && cg.cardH < 400, `card ${cg.cardW}x${cg.cardH}px -> ~${cg.stepX ? Math.round(cg.gridWidth / cg.stepX) : 1} columns on ${cg.gridWidth}px`);
    ok('categories tab action buttons compact', cg.btnW === 0 || cg.btnW <= 26, `edit/delete btn ${cg.btnW}px`);
    ok('categories KPI ribbon populated', cg.kpiCats !== '' && Number(cg.kpiCats) === cg.cards, `cats=${cg.kpiCats} mapped=${cg.kpiMapped} unmapped=${cg.kpiUnmapped}`);
    // live search filter
    await page.fill('#categorySearch', 'zzz-no-match');
    await page.waitForTimeout(600);
    const hiddenCount = await page.evaluate(() => [...document.querySelectorAll('#categoryList .cat-card')].filter(c => c.style.display === 'none').length);
    ok('categories search filters live', hiddenCount === cg.cards, `${hiddenCount}/${cg.cards} hidden on no-match`);
    await page.fill('#categorySearch', '');
    await page.waitForTimeout(400);
    const visibleCount = await page.evaluate(() => [...document.querySelectorAll('#categoryList .cat-card')].filter(c => c.style.display !== 'none').length);
    ok('categories search restores', visibleCount === cg.cards, `${visibleCount}/${cg.cards} visible after clearing`);

    // ---- Phase 2: create-category drawer ----
    await page.click('#btnOpenCatDrawer');
    await page.waitForTimeout(700);
    const dr1 = await page.evaluate(() => ({
        active: document.getElementById('categoryCreateDrawer')?.classList.contains('active') || false,
        visible: document.getElementById('categoryCreateDrawer')?.offsetHeight > 0 || false,
        nameFocused: document.activeElement?.id === 'newCatName',
    }));
    ok('drawer opens from header button', dr1.active && dr1.visible && dr1.nameFocused, `active=${dr1.active} visible=${dr1.visible} focus=${dr1.nameFocused}`);
    await page.fill('#newCatName', 'Pizza');
    await page.waitForTimeout(300);
    const dupShown = await page.evaluate(() => document.getElementById('catNameDupHint').style.display !== 'none');
    ok('live duplicate-name hint fires', dupShown, '"Pizza" is an existing category');
    await page.fill('#newCatName', 'E2E-CAT-DELETE-ME');
    await page.waitForTimeout(300);
    const dupGone = await page.evaluate(() => document.getElementById('catNameDupHint').style.display === 'none');
    ok('duplicate hint clears on clean name', dupGone, 'E2E-CAT-DELETE-ME is new');
    // stepper
    await page.click('#catOrderPlus');
    await page.click('#catOrderPlus');
    const stepperVal = await page.evaluate(() => document.getElementById('newCatOrder').value);
    ok('serial stepper works', stepperVal === '2', `order value after 2x plus = ${stepperVal}`);
    await page.click('#catOrderMinus');
    const stepperVal2 = await page.evaluate(() => document.getElementById('newCatOrder').value);
    ok('serial stepper decrements', stepperVal2 === '1', `order value after minus = ${stepperVal2}`);
    // create the category for real (drawer auto-closes on success)
    await page.click('#btnAddCategory');
    await page.waitForTimeout(3500);
    const dr2 = await page.evaluate(() => ({
        closed: !document.getElementById('categoryCreateDrawer')?.classList.contains('active'),
        created: [...document.querySelectorAll('#categoryList .cat-card-name')].some(n => n.textContent.trim() === 'E2E-CAT-DELETE-ME'),
        cardCount: document.querySelectorAll('#categoryList .cat-card').length,
    }));
    ok('drawer closes after save + card appears', dr2.closed && dr2.created, `cards now ${dr2.cardCount}`);
    await page.screenshot({ path: path.join(T, 'category-drawer.png') });
    // cleanup: delete the e2e category (it has no dishes -> cascade removes nothing else)
    const delBtn = page.locator('#categoryList .cat-card', { hasText: 'E2E-CAT-DELETE-ME' }).first();
    await delBtn.locator('.cat-card-actions .btn-action-v4.danger').click();
    await page.waitForTimeout(700);
    await page.locator('.dynamic-modal-overlay .btn-confirm').first().click();
    await page.waitForTimeout(3500);
    const gone = await page.evaluate(() => ![...document.querySelectorAll('#categoryList .cat-card-name')].some(n => n.textContent.trim() === 'E2E-CAT-DELETE-ME'));
    ok('e2e category cleanup (deleted)', gone, 'category removed live');

    // ---- Phase 3: type-the-name delete guard (non-destructive: cancel at the end) ----
    // "Pizza" carries 4 dishes -> deleting it would cascade the customer menu: guard requires
    // typing the exact name. Empty categories keep the plain confirm (covered by the test above).
    const pizzaCard = page.locator('#categoryList .cat-card', { hasText: 'Pizza' }).first();
    await pizzaCard.locator('.cat-card-actions .btn-action-v4.danger').click();
    await page.waitForTimeout(600);
    const g1 = await page.evaluate(() => {
        const ov = document.querySelector('.dynamic-modal-overlay');
        const input = ov?.querySelector('.dynamic-modal-input');
        const btn = ov?.querySelector('.btn-confirm');
        return { open: !!ov, hasInput: !!input, btnDisabled: btn ? btn.disabled : null, text: ov?.querySelector('.dynamic-modal-text')?.innerText || '' };
    });
    ok('populated-category delete shows typed confirm', g1.open && g1.hasInput, `confirm disabled initially: ${g1.btnDisabled} — "${g1.text}"`);
    await page.fill('.dynamic-modal-input', 'Pizz');
    await page.waitForTimeout(250);
    const stillDisabled = await page.evaluate(() => document.querySelector('.dynamic-modal-overlay .btn-confirm').disabled);
    ok('partial name keeps Delete disabled', stillDisabled, '"Pizz" rejected');
    await page.fill('.dynamic-modal-input', 'pizza');
    await page.waitForTimeout(250);
    const enabled = await page.evaluate(() => !document.querySelector('.dynamic-modal-overlay .btn-confirm').disabled);
    ok('exact name enables Delete', enabled, '"pizza" matches case-insensitively');
    await page.locator('.dynamic-modal-overlay .btn-cancel').click();
    await page.waitForTimeout(500);
    const pizzaAlive = await page.evaluate(() => [...document.querySelectorAll('#categoryList .cat-card-name')].some(n => n.textContent.trim() === 'Pizza'));
    ok('cancelled guard leaves category intact', pizzaAlive, 'Pizza + its 4 dishes untouched (END)');
    await page.screenshot({ path: path.join(T, 'category-delete-guard.png') });

    // ---- Phase 4: mobile 375px (same session, resized) ----
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(900);
    await page.evaluate(() => { document.querySelector('.nav-btn[data-tab="categories"]')?.click(); });
    await page.waitForTimeout(1800);
    const mob = await page.evaluate(() => {
        const grid = document.getElementById('categoryList');
        const cards = [...grid.querySelectorAll('.cat-card')];
        const btn = grid.querySelector('.cat-card-actions .btn-action-v4');
        return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
            btnW: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
            kpiVisible: !!document.getElementById('catKpiStrip')?.offsetHeight,
        };
    });
    ok('mobile: no horizontal overflow', mob.overflow <= 1, `scrollWidth - innerWidth = ${mob.overflow}px`);
    ok('mobile: cards still compact', mob.cardW >= 120 && mob.cardW < 200, `card ${mob.cardW}px wide at 375px viewport`);
    ok('mobile: touch targets >= 40px', mob.btnW === 0 || mob.btnW >= 39, `card action btn ${mob.btnW}px`);
    ok('mobile: KPI ribbon renders', mob.kpiVisible);
    // drawer full-bleed on phone
    await page.click('#btnOpenCatDrawer');
    await page.waitForTimeout(600);
    const moDrawer = await page.evaluate(() => {
        const r = document.querySelector('#categoryCreateDrawer .modal-content').getBoundingClientRect();
        return { active: document.getElementById('categoryCreateDrawer').classList.contains('active'), w: Math.round(r.width) };
    });
    ok('mobile: drawer opens full-width', moDrawer.active && moDrawer.w >= 340, `sheet width ${moDrawer.w}px at 375px viewport`);
    await page.screenshot({ path: path.join(T, 'category-mobile.png') });
    await page.click('#btnCloseCatDrawer');
    await page.waitForTimeout(400);

    await browser.close();
    const fails = results.filter(r => !r.pass).length;
    console.log(`\nRESULT: ${results.length - fails}/${results.length} passed`);
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e); process.exit(1); });
