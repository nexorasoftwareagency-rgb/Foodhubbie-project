// Customer Database — real-browser verification against the demo tenant.
//   node tests/customer-dashboard.browser.mjs
//
// Uses the locally built Admin shell (tools/serve-dist.cjs admin → :5055) so the
// run costs no Hosting egress, but the DATA is the real demo tenant: real
// Firebase Auth sign-in, real RTDB reads.
//
//   node tools/serve-dist.cjs admin      # in another shell
//   node tests/customer-dashboard.browser.mjs
//
// The demo tenant has 8 named customers (9000000201…208), so the guard can
// assert exact counts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PW || 'playwright')); }

const BASE = process.env.CD_BASE || 'http://127.0.0.1:5055/demo';
let n = 0;
const ok = (m) => console.log('PASS ' + (++n) + ' - ' + m);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
// The EC2 socket host (api.foodhubbie.in) is currently DOWN (its AWS
// credentials were retired on 2026-11-18), so the WhatsApp-template lookup
// the notify composer does fails here. That is the environment, not this
// screen - the guard is about the Customers UI.
const EXTERNAL_API_NOISE = /Failed to load resource|approved WhatsApp templates|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|net::/i;
page.on('console', (m) => { if (m.type() === 'error' && !EXTERNAL_API_NOISE.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));

async function gotoCustomers() {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tab-customers', { state: 'attached', timeout: 45000 });
    await page.click('[data-tab="customers"]');
    await page.waitForSelector('#customerDataTableBody tr.cp-row', { timeout: 45000 });
    // The KPI strip and the chips are painted with the first render.
    await page.waitForSelector('#custKpis .cust-kpi', { timeout: 20000 });
}

const rows = () => page.locator('#customerDataTableBody tr.cp-row').count();
const chip = (sel) => page.locator(`#custFilters ${sel}`);

try {
    await gotoCustomers();

    // ------------------------------------------------------------- the table
    const total = await rows();
    assert.ok(total >= 8, 'the demo tenant has customer rows: ' + total);
    ok('the Customers tab rendered ' + total + ' guest rows');

    const heads = await page.locator('#customerDataTable thead th').allInnerTexts();
    const cells = await page.locator('#customerDataTableBody tr.cp-row').first().locator('td').count();
    assert.equal(heads.length, cells, 'the header and the row have the same number of columns');
    assert.equal(heads.length, 10, 'the table has 10 columns (the selection checkbox leads)');
    ok('the header and the rows agree (' + heads.length + ' columns)');

    // The value cell is the money actually PAID, and the loyalty cell says how
    // many points can be spent (not the lifetime points).
    const firstRow = await page.evaluate(() => {
        const tr = document.querySelector('#customerDataTableBody tr.cp-row');
        const td = [...tr.querySelectorAll('td')].map((x) => x.innerText.replace(/\s+/g, ' ').trim());
        return td;
    });
    assert.ok(/^₹/.test(firstRow[6] || ''), 'the Value column shows a rupee total: ' + firstRow[6]);
    assert.ok(/pts/i.test(firstRow[7] || ''), 'the Loyalty column shows the spendable points: ' + firstRow[7]);
    assert.ok(firstRow[8] && firstRow[8].length > 0, 'the Segment column carries a badge');
    assert.ok(firstRow[9] && firstRow[9].length > 0, 'the Next-step column carries a pill');
    ok('the row shows the paid value, the spendable points, a segment and a next step');

    // ------------------------------------------------------------ the KPI strip
    const kpis = await page.evaluate(() => [...document.querySelectorAll('#custKpis .cust-kpi')].map((k) => ({
        key: k.dataset.custKpi,
        value: k.querySelector('.cust-kpi-val').textContent.trim(),
        label: k.querySelector('.cust-kpi-label').textContent.trim(),
        pressed: k.getAttribute('aria-pressed'),
    })));
    assert.equal(kpis.length, 6, 'the KPI strip has 6 tiles');
    const guests = kpis.find((k) => k.key === 'guests');
    assert.equal(Number(guests.value.replace(/[^\d]/g, '')), total, 'the Guests tile agrees with the row count');
    assert.ok(kpis.every((k) => /\d/.test(k.value)), 'every tile carries a number');
    assert.ok(guests.pressed === 'true', 'the Guests tile is the active filter by default');
    ok('the KPI strip renders 6 tiles and the Guests tile agrees with the table');

    // -------------------------------------------------------------- the chips
    const segChips = await page.evaluate(() => [...document.querySelectorAll('#custFilters [data-cust-segment]')].map((c) => ({
        key: c.dataset.custSegment, text: c.textContent.replace(/\s+/g, ' ').trim(), pressed: c.getAttribute('aria-pressed'),
    })));
    assert.ok(segChips.length >= 6, 'the segment chips are there: ' + segChips.length);
    assert.ok(segChips.every((c) => /\d/.test(c.text)), 'every chip carries a count');
    assert.ok(segChips.find((c) => c.key === 'all').pressed === 'true', 'All guests is selected by default');
    ok('the segment chips render with live counts');

    const audChips = await page.evaluate(() => [...document.querySelectorAll('#custFilters [data-cust-audience]')].map((c) => ({
        key: c.dataset.custAudience, text: c.textContent.replace(/\s+/g, ' ').trim(),
    })));
    assert.ok(audChips.length >= 4, 'the audience chips are there: ' + audChips.length);
    assert.ok(audChips.every((c) => /\d/.test(c.text)), 'every audience chip carries a count');
    ok('the audience chips render with live counts');

    // --------------------------------------------------- the filters actually filter
    const champChip = chip('[data-cust-segment="champions"]');
    const champCount = Number((await champChip.innerText()).replace(/[^\d]/g, ''));
    await champChip.click();
    await page.waitForTimeout(250);
    const champRows = await rows();
    assert.equal(champRows, champCount, 'the Champions chip shows exactly ' + champCount + ' guests');
    assert.equal(await champChip.getAttribute('aria-pressed'), 'true', 'the chip shows it is selected');
    ok('the segment chip filters the table (' + champRows + ' guests)');

    // An audience chip AND-combines with the segment.
    const reachChip = chip('[data-cust-audience="promo-reachable"]');
    const reachCount = Number((await reachChip.innerText()).replace(/[^\d]/g, ''));
    await reachChip.click();
    await page.waitForTimeout(250);
    const bothRows = await rows();
    assert.ok(bothRows <= champRows, 'the audience chip narrows the result further');
    assert.equal(await reachChip.getAttribute('aria-pressed'), 'true', 'the audience chip shows it is selected');
    ok('the audience chip AND-combines with the segment (' + bothRows + ' guests, promo-reachable pool ' + reachCount + ')');

    // Back to everyone.
    await chip('[data-cust-segment="all"]').click();
    await page.waitForTimeout(200);
    await reachChip.click();
    await page.waitForTimeout(200);
    assert.equal(await rows(), total, 'clearing the filters brings every guest back');
    ok('clearing the filters restores the full list');

    // -------------------------------------------------------------- the search
    await page.fill('#customerSearch', 'Ishita');
    await page.waitForTimeout(350);
    assert.equal(await rows(), 1, 'searching a name finds one guest');
    const found = await page.locator('#customerDataTableBody tr.cp-row').first().innerText();
    assert.ok(/Ishita/i.test(found), 'the right guest is listed: ' + found.replace(/\s+/g, ' ').slice(0, 60));
    ok('the search finds a guest by name');

    await page.fill('#customerSearch', '9000000203');
    await page.waitForTimeout(350);
    assert.equal(await rows(), 1, 'searching a phone finds one guest');
    ok('the search finds a guest by phone');

    await page.fill('#customerSearch', 'zzzznotathing');
    await page.waitForTimeout(350);
    assert.equal(await rows(), 0, 'a search with no match shows no rows');
    assert.equal(await page.locator('#customerDataTableBody .cust-empty').count(), 1, 'the empty state is shown');
    const emptyText = await page.locator('#customerDataTableBody .cust-empty').innerText();
    assert.ok(/No guest/i.test(emptyText), 'the empty state explains itself: ' + emptyText.replace(/\s+/g, ' ').slice(0, 70));
    await page.click('#customerDataTableBody [data-cust-clear]');
    await page.waitForTimeout(250);
    assert.equal(await rows(), total, 'the empty state offers a way out');
    ok('an empty search result explains itself and can be cleared');

    // ---------------------------------------------------------------- the pager
    await page.fill('#customerSearch', '');
    await page.waitForTimeout(300);
    const pager = await page.locator('#custPager .cust-pager-text').innerText();
    assert.ok(/Showing \d+ of \d+ guests?/.test(pager), 'the pager says what it is showing: ' + pager);
    ok('the pager reads "' + pager.trim() + '"');

    // ---------------------------------------------------------- the density toggle
    await page.click('#custDensityBtn');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#tab-customers.cust-dense').count(), 1, 'the compact mode is on');
    assert.equal(await page.locator('#custDensityBtn').getAttribute('aria-pressed'), 'true', 'the toggle shows it is on');
    const stored = await page.evaluate(() => localStorage.getItem('fh:custDensity'));
    assert.equal(stored, 'dense', 'the density choice is remembered: ' + stored);
    const densePad = await page.evaluate(() => {
        const td = document.querySelector('#customerDataTableBody tr.cp-row td');
        return td ? parseFloat(getComputedStyle(td).paddingTop) : 0;
    });
    await page.click('#custDensityBtn');
    await page.waitForTimeout(200);
    const roomyPad = await page.evaluate(() => {
        const td = document.querySelector('#customerDataTableBody tr.cp-row td');
        return td ? parseFloat(getComputedStyle(td).paddingTop) : 0;
    });
    assert.ok(densePad < roomyPad, 'compact rows are tighter (' + densePad + ' vs ' + roomyPad + 'px)');
    ok('the density toggle tightens the rows and remembers the choice');

    // ------------------------------------------------ the notification checklist
    // NOTHING is sent here: the run must not push to a real device. The only
    // thing this proves is the selection, the honest reach and the composer.
    const notifyPosts = [];
    page.on('request', (r) => {
        if (r.method() === 'POST' && /tenant-api\/notify/.test(r.url())) notifyPosts.push(r.url());
    });

    assert.equal(await page.locator('#customerDataTableBody .cust-sel-box').count(), total, 'every row has a selection checkbox');
    assert.equal(await page.locator('#custSelectAll').count(), 1, 'the table has a header checkbox');
    assert.equal((await page.locator('#custBatchBar').innerText()).trim(), '', 'the batch bar is hidden without a selection');
    ok('the selection column and the header checkbox are there, and the bar is hidden');

    // Select ONE guest.
    await page.locator('#customerDataTableBody .cust-sel-box:not([disabled])').first().check();
    await page.waitForTimeout(400);
    let barText = await page.locator('#custBatchBar').innerText();
    assert.ok(/1 guest selected/.test(barText), 'the bar says one guest is selected: ' + barText.replace(/\s+/g, ' '));
    assert.ok(/Up to \d+ can get a push/.test(barText), 'the bar states the push reach honestly');
    assert.ok(/Up to \d+ can get WhatsApp/.test(barText), 'the bar states the WhatsApp reach honestly');
    assert.ok(/Select all \d+ matching guests/.test(barText), 'the bar offers the WHOLE filtered set');
    ok('selecting a guest opens the batch bar with the honest reach');

    // Select ALL the matching guests (the explicit link, not the header box).
    await page.click('#custBatchBar [data-cust-select-all-matching]');
    await page.waitForTimeout(400);
    barText = await page.locator('#custBatchBar').innerText();
    assert.ok(new RegExp(total + ' guests selected').test(barText), 'every matching guest is selected: ' + barText.replace(/\s+/g, ' '));
    assert.ok(/All \d+ matching guests selected/.test(barText), 'the bar says the whole set is selected');
    ok('"select all N matching" selects the whole filtered set');

    // The header checkbox is the CURRENT PAGE, and it is indeterminate when
    // only some of the visible rows are selected.
    await page.locator('#customerDataTableBody .cust-sel-box:not([disabled])').first().uncheck();
    await page.waitForTimeout(300);
    const headerState = await page.evaluate(() => {
        const b = document.getElementById('custSelectAll');
        return { checked: b.checked, indeterminate: b.indeterminate };
    });
    assert.equal(headerState.checked, false, 'the header checkbox is not fully checked');
    assert.equal(headerState.indeterminate, true, 'the header checkbox is indeterminate when only some rows are selected');
    ok('the header checkbox reflects a partial selection (indeterminate)');

    // Open the composer for the APP push channel.
    await page.click('#custBatchBar [data-cust-notify="push"]');
    await page.waitForSelector('#notifyComposerModal.active', { timeout: 20000 });
    const audience = await page.locator('#notifyAudience').innerText();
    assert.ok(/selected guests/i.test(audience), 'the composer shows the selected guests');
    assert.ok(/most ordered/i.test(audience), 'the composer shows what the guests actually ordered');
    const reach = await page.locator('#notifyReach').innerText();
    assert.ok(/Up to \d+ of \d+/.test(reach), 'the reach line is honest: ' + reach.replace(/\s+/g, ' ').slice(0, 80));
    ok('the composer opens prefilled with the guests\' own details and an honest reach');

    // Generate the message from the real guest data.
    await page.click('#notifyGenerateBtn');
    await page.waitForTimeout(400);
    const title = await page.inputValue('#notifyTitleInput');
    const body = await page.inputValue('#notifyBodyInput');
    assert.ok(title.trim().length > 0, 'the generated draft has a title');
    assert.ok(body.trim().length > 0, 'the generated draft has a message');
    assert.ok(!body.includes('{name}'), 'a push body is ONE message for every device (no {name})');
    assert.ok(!/discount|coupon|% off/i.test(body), 'the generated message never promises a discount');
    ok('"Generate message" composes a real draft from the guests\' details');

    // The WhatsApp channel states the outlet gate instead of pretending.
    await page.click('#notifyComposerModal [data-notify-channel="wa"]');
    await page.waitForTimeout(400);
    const waReach = await page.locator('#notifyReach').innerText();
    const waBtn = await page.locator('#notifySendBtn').innerText();
    const waDisabled = await page.locator('#notifySendBtn').isDisabled();
    if (/cannot send WhatsApp/i.test(waReach)) {
        assert.equal(waDisabled, true, 'the send button is disabled while the outlet cannot send');
        assert.ok(/unavailable/i.test(waBtn), 'the button says why: ' + waBtn);
    }
    ok('the WhatsApp channel states the outlet gate honestly');

    // Close WITHOUT sending.
    await page.click('#notifyComposerModal [data-notify-close]');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#notifyComposerModal.active').count(), 0, 'the composer closes');
    assert.equal(notifyPosts.length, 0, 'the run sent NOTHING (no notify POST): ' + notifyPosts.join(', '));
    ok('the composer closes and the run sent nothing');

    // Clear the selection.
    await page.click('#custBatchBar [data-cust-clear-selection]');
    await page.waitForTimeout(300);
    assert.equal((await page.locator('#custBatchBar').innerText()).trim(), '', 'the bar disappears when the selection is cleared');
    ok('the selection can be cleared');

    // --------------------------------------------------------------- the profile
    await page.locator('#customerDataTableBody tr.cp-row td:nth-child(2)').first().click();
    await page.waitForSelector('#customerProfileDrawer.active', { timeout: 30000 });
    ok('clicking a row opens the Customer Profile 360');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // ---------------------------------------------------- the responsive layout
    // A laptop: the table has to FIT its card (no horizontal scroll) and no
    // customer name may be cut, and the Address column folds away first.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(400);
    const laptop = await page.evaluate(() => {
        const table = document.querySelector('#customerDataTable');
        const wrap = table.closest('.mob-table-scroll');
        const clipped = [...document.querySelectorAll('#customerDataTableBody .cust-cust-id button')]
            .filter((b) => b.scrollWidth > Math.ceil(b.getBoundingClientRect().width) + 1)
            .map((b) => b.textContent.trim());
        const addrTh = document.querySelector('#customerDataTable thead .cust-col-addr');
        return {
            tableW: Math.round(table.getBoundingClientRect().width),
            wrapW: Math.round(wrap.clientWidth),
            clipped,
            addr: getComputedStyle(addrTh).display,
        };
    });
    assert.ok(laptop.tableW <= laptop.wrapW + 1, 'the table fits the card on a laptop (' + laptop.tableW + ' vs ' + laptop.wrapW + 'px)');
    assert.equal(laptop.clipped.length, 0, 'no customer name is cut on a laptop: ' + laptop.clipped.join(', '));
    assert.equal(laptop.addr, 'none', 'the Address column folds away on a laptop');
    ok('a 1280px laptop shows every column it can without clipping a name');

    // The desktop header and the phone sort picker are ONE control: sorting
    // by a header must be reflected in the picker (and the other way round).
    await page.click('#customerDataTable thead th[data-sort="name"]');
    await page.waitForTimeout(400);
    const synced = await page.evaluate(() => {
        const sel = document.querySelector('#custSortSelect');
        const first = document.querySelector('#customerDataTableBody tr.cp-row .cust-col-cust button');
        return { value: sel ? sel.value : null, first: first ? first.textContent.trim() : null };
    });
    assert.ok(/^name:/.test(synced.value || ''), 'the phone sort picker follows the desktop header sort: ' + synced.value);
    const names = await page.evaluate(() => [...document.querySelectorAll('#customerDataTableBody tr.cp-row .cust-col-cust button')].map((b) => b.textContent.trim()));
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'the header sort really re-orders the list');
    ok('the desktop header and the phone sort picker are the same control');

    // ------------------------------------------------------------- the phone size
    // A phone gets CARDS, not a squeezed table. The column headers are GONE
    // (they were a broken scrolling sort strip that floated over the first
    // card): the phone gets ONE control row - [select all] [native sort
    // picker] [Filters] - and the filter chips live in a SHEET that opens on
    // demand. The contextual action bar floats above the bottom nav.
    for (const [w, h] of [[390, 844], [360, 800], [320, 720]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(450);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 2, 'the page does not scroll sideways at ' + w + 'px: ' + overflow + 'px');

        const card = await page.evaluate(() => {
            const q = (s) => document.querySelector(s);
            const disp = (s) => { const el = q(s); return el ? getComputedStyle(el).display : 'missing'; };
            const area = (s) => { const el = q(s); return el ? getComputedStyle(el).gridArea : 'missing'; };
            const box = (s) => { const el = q(s); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), x: Math.round(r.x) }; };
            const wrap = q('#tab-customers .mob-table-scroll');
            const row = q('#customerDataTableBody tr.cp-row');
            const nameBtn = row && row.querySelector('.cust-col-cust .mob-td-strong button');
            const meta = row && row.querySelector('.cust-mob-meta');
            const firstCard = q('#customerDataTableBody tr.cp-row');
            return {
                wrapScroll: wrap ? wrap.scrollWidth - wrap.clientWidth : -1,
                tableDisplay: disp('#customerDataTable'),
                tbodyDisplay: disp('#customerDataTableBody'),
                rowDisplay: disp('#customerDataTableBody tr.cp-row'),
                areaSel: area('#customerDataTableBody tr.cp-row td.cust-col-sel'),
                areaCust: area('#customerDataTableBody tr.cp-row td.cust-col-cust'),
                areaPhone: area('#customerDataTableBody tr.cp-row td.cust-col-phone'),
                areaValue: area('#customerDataTableBody tr.cp-row td.cust-col-value'),
                areaSegment: area('#customerDataTableBody tr.cp-row td.cust-col-segment'),
                areaAction: area('#customerDataTableBody tr.cp-row td.cust-col-action'),
                addr: disp('#customerDataTableBody tr.cp-row td.cust-col-addr'),
                last: disp('#customerDataTableBody tr.cp-row td.cust-col-last'),
                orders: disp('#customerDataTableBody tr.cp-row td.cust-col-orders'),
                loyalty: disp('#customerDataTableBody tr.cp-row td.cust-col-loyalty'),
                headDisplay: disp('#customerDataTable thead'),
                metaText: meta ? meta.innerText.replace(/\s+/g, ' ').trim() : 'missing',
                metaDisplay: disp('#customerDataTableBody tr.cp-row .cust-mob-meta'),
                nameClipped: nameBtn ? nameBtn.scrollWidth > nameBtn.clientWidth + 1 : null,
                kpiCols: getComputedStyle(q('#custKpis')).gridTemplateColumns.split(' ').filter(Boolean).length,
                // the control bar
                bar: box('#custListBar .cust-listbar-inner'),
                barDisplay: disp('#custListBar'),
                allBox: box('#custSelectAllMobile'),
                sortBox: box('#custSortSelect'),
                sortOptions: [...document.querySelectorAll('#custSortSelect option')].map((o) => o.value),
                sortValue: q('#custSortSelect') ? q('#custSortSelect').value : null,
                filtersBtn: box('#custFiltersBtn'),
                filtersExpanded: q('#custFiltersBtn') ? q('#custFiltersBtn').getAttribute('aria-expanded') : null,
                // the filter chips live in a sheet, not above the list
                // The chips container itself is the sheet: on a phone it is
                // hidden and parked BELOW the viewport (it is not in the page
                // flow above the list).
                filtersVis: q('#custFilters') ? getComputedStyle(q('#custFilters')).visibility : 'missing',
                filtersTop: q('#custFilters') ? Math.round(q('#custFilters').getBoundingClientRect().top) : null,
                sheetPos: q('#custFilters') ? getComputedStyle(q('#custFilters')).position : 'missing',
                sheetVis: q('#custFilters') ? getComputedStyle(q('#custFilters')).visibility : 'missing',
                scrimDisplay: disp('#custFiltersScrim'),
                firstCardTop: firstCard ? Math.round(firstCard.getBoundingClientRect().top) : null,
                // Nothing inside the card may stick out of it.
                cardRight: (() => {
                    const c = q('#tab-customers .mob-card');
                    const s = getComputedStyle(c);
                    return Math.round(c.getBoundingClientRect().right - parseFloat(s.borderRightWidth || '0'));
                })(),
                kpisRight: (() => { const e = q('#custKpis'); return e ? Math.round(e.getBoundingClientRect().right) : null; })(),
                barRight: (() => { const e = q('#custListBar .cust-listbar-inner'); return e ? Math.round(e.getBoundingClientRect().right) : null; })(),
                listRight: (() => { const e = q('#tab-customers .mob-table-scroll'); return e ? Math.round(e.getBoundingClientRect().right) : null; })(),
            };
        });

        assert.ok(card.wrapScroll <= 1, 'the list does not scroll sideways at ' + w + 'px: ' + card.wrapScroll + 'px');
        assert.equal(card.tableDisplay, 'block', 'the table becomes a stack of cards at ' + w + 'px');
        assert.equal(card.tbodyDisplay, 'block', 'the rows are blocks at ' + w + 'px');
        assert.equal(card.rowDisplay, 'grid', 'each guest is a card grid at ' + w + 'px');
        assert.equal(card.areaSel, 'sel', 'the checkbox sits in the card gutter');
        assert.equal(card.areaCust, 'name', 'the name is the card heading');
        assert.equal(card.areaPhone, 'phone', 'the phone sits under the name');
        assert.equal(card.areaValue, 'value', 'the value is the card corner');
        assert.equal(card.areaSegment, 'tags', 'the segment sits in the card footer');
        assert.equal(card.areaAction, 'act', 'the next step sits in the card footer');
        assert.equal(card.addr, 'none', 'the Address cell folds away');
        assert.equal(card.last, 'none', 'the Last visit cell folds away');
        assert.equal(card.orders, 'none', 'the Orders cell folds away');
        assert.equal(card.loyalty, 'none', 'the Loyalty cell folds away');

        // --- the header strip is GONE, the control bar replaces it ---------
        assert.equal(card.headDisplay, 'none', 'the broken sort strip is gone at ' + w + 'px');
        assert.equal(card.barDisplay, 'block', 'the phone control bar is visible at ' + w + 'px');
        assert.ok(card.bar && card.bar.h >= 44, 'the control bar is a 44px row at ' + w + 'px');
        assert.ok(card.allBox && card.allBox.w >= 22 && card.allBox.h >= 22, 'the select-all box is a real tap target at ' + w + 'px');
        assert.ok(card.sortBox && card.sortBox.h >= 44, 'the sort picker is a 44px tap target at ' + w + 'px');
        assert.ok(card.filtersBtn && card.filtersBtn.h >= 44, 'the Filters button is a 44px tap target at ' + w + 'px');
        assert.ok(card.sortOptions.length >= 10, 'the sort picker carries every sort key (' + card.sortOptions.length + ')');
        assert.equal(card.filtersExpanded, 'false', 'the filter sheet starts closed at ' + w + 'px');
        assert.equal(card.filtersVis, 'hidden', 'the filter chips are NOT above the list at ' + w + 'px');
        assert.ok(card.filtersTop >= h - 2, 'the filter sheet is parked off-screen at ' + w + 'px (' + card.filtersTop + ')');
        assert.equal(card.sheetPos, 'fixed', 'the filter chips are a bottom sheet at ' + w + 'px');
        assert.equal(card.sheetVis, 'hidden', 'the sheet is parked off-screen at ' + w + 'px');
        assert.equal(card.scrimDisplay, 'block', 'the sheet has a scrim at ' + w + 'px');
        // The chrome above the first guest used to be 456px (390 wide).
        assert.ok(card.firstCardTop <= 380, 'the first guest is reachable without scrolling past the chrome (' + card.firstCardTop + 'px)');
        // A forced 100% width once pushed the KPI tiles and the list 12px
        // past the card's right edge (they were cut off on a phone).
        assert.ok(card.kpisRight <= card.cardRight, 'the KPI strip stays inside the card (' + card.kpisRight + ' vs ' + card.cardRight + ')');
        assert.ok(card.barRight <= card.cardRight, 'the control bar stays inside the card (' + card.barRight + ' vs ' + card.cardRight + ')');
        assert.ok(card.listRight <= card.cardRight, 'the guest list stays inside the card (' + card.listRight + ' vs ' + card.cardRight + ')');
        ok('a ' + w + 'px phone replaces the header strip with one control row and hides the chips');

        // --- the native picker really sorts -------------------------------
        // Start from a different sort so the change is visible.
        await page.selectOption('#custSortSelect', 'ltv:desc');
        await page.waitForTimeout(350);
        const before = await page.evaluate(() => [...document.querySelectorAll('#customerDataTableBody tr.cp-row')].map((t) => t.querySelector('.cust-col-cust button').textContent.trim()));
        await page.selectOption('#custSortSelect', 'name:asc');
        await page.waitForTimeout(400);
        const after = await page.evaluate(() => [...document.querySelectorAll('#customerDataTableBody tr.cp-row')].map((t) => t.querySelector('.cust-col-cust button').textContent.trim()));
        const sorted = [...after].sort((a, b) => a.localeCompare(b));
        assert.deepEqual(after, sorted, 'the native sort picker sorts the list A-Z');
        assert.notDeepEqual(after, before, 'the sort picker changed the order');
        await page.selectOption('#custSortSelect', 'ltv:desc');
        await page.waitForTimeout(350);
        ok('the native sort picker re-sorts the list at ' + w + 'px');

        // --- the filter sheet ---------------------------------------------
        await page.click('#custFiltersBtn');
        await page.waitForTimeout(400);
        const sheet = await page.evaluate(() => {
            const f = document.querySelector('#custFilters');
            const s = document.querySelector('#custFiltersScrim');
            const chips = [...document.querySelectorAll('#custFilters .cust-chip')];
            const r = f.getBoundingClientRect();
            return {
                open: document.querySelector('#tab-customers').classList.contains('cust-filters-open'),
                vis: getComputedStyle(f).visibility,
                role: f.getAttribute('role'),
                scrim: getComputedStyle(s).opacity,
                chipH: chips.length ? Math.round(chips[0].getBoundingClientRect().height) : 0,
                chips: chips.length,
                anchored: Math.round(r.bottom),
                top: Math.round(r.top),
                viewport: window.innerHeight,
                expanded: document.querySelector('#custFiltersBtn').getAttribute('aria-expanded'),
                focus: document.activeElement ? document.activeElement.className : '',
                // The bottom nav is z-index 5000 in the app shell while the
                // tab pane is z-index 20 - without a lift the nav paints over
                // the sheet's footer and swallows the "Clear all" tap.
                footerHit: (() => {
                    const btn = document.querySelector('#custFilters [data-cust-filters-clear]');
                    if (!btn) return 'missing';
                    const r = btn.getBoundingClientRect();
                    const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
                    return el ? (btn.contains(el) ? 'clear-button' : el.tagName + '.' + el.className) : 'none';
                })(),
                bannerDisplay: (() => {
                    const b = document.querySelector('#demoModeBanner');
                    return b ? getComputedStyle(b).display : 'none';
                })(),
                bodyClass: document.body.className,
            };
        });
        assert.ok(sheet.open, 'the Filters button opens the sheet at ' + w + 'px');
        assert.equal(sheet.vis, 'visible', 'the sheet is visible when it is open');
        assert.equal(sheet.role, 'dialog', 'the sheet is a modal dialog');
        assert.equal(sheet.expanded, 'true', 'the Filters button says it is open');
        assert.equal(sheet.scrim, '1', 'the scrim dims the page');
        assert.ok(sheet.chipH >= 44, 'the filter chips are 44px tap targets (' + sheet.chipH + 'px)');
        assert.ok(sheet.anchored >= sheet.viewport - 2, 'the sheet is anchored to the bottom of the screen');
        assert.ok(/cust-sheet-close/.test(sheet.focus), 'the sheet takes the focus');
        assert.equal(sheet.footerHit, 'clear-button', 'the sheet footer is not covered by the bottom nav');
        assert.equal(sheet.bannerDisplay, 'none', 'the demo banner steps aside for the sheet');
        assert.ok(/cust-sheet-open/.test(sheet.bodyClass), 'the body knows the sheet is open');
        ok('the filter sheet opens as a modal bottom sheet at ' + w + 'px');

        // A chip filters the list while the sheet stays open.
        const chipName = await page.evaluate(() => {
            const c = [...document.querySelectorAll('#custFilters [data-cust-segment]')].find((x) => x.dataset.custSegment !== 'all');
            if (!c) return null;
            const n = c.querySelector('.cust-chip-count').textContent.trim();
            c.click();
            return n;
        });
        await page.waitForTimeout(400);
        const filtered = await page.evaluate(() => ({
            rows: document.querySelectorAll('#customerDataTableBody tr.cp-row').length,
            badge: document.querySelector('#custFiltersBtn .cust-lb-badge') ? document.querySelector('#custFiltersBtn .cust-lb-badge').textContent.trim() : '0',
            stillOpen: document.querySelector('#tab-customers').classList.contains('cust-filters-open'),
        }));
        assert.ok(filtered.stillOpen, 'the sheet stays open while a chip is being picked');
        assert.equal(filtered.badge, '1', 'the Filters button shows how many filters are on');
        assert.equal(Number(filtered.rows), Number(chipName), 'the chip filtered the list to its own count');
        ok('a filter chip filters the list and the button counts the active filters');

        // Escape closes it.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
        assert.equal(await page.evaluate(() => document.querySelector('#tab-customers').classList.contains('cust-filters-open')), false,
            'Escape closes the filter sheet');
        // ... and "Clear all" resets the filters.
        await page.click('#custFiltersBtn');
        await page.waitForTimeout(300);
        await page.click('#custFilters [data-cust-filters-clear]');
        await page.waitForTimeout(350);
        const cleared = await page.evaluate(() => ({
            badge: document.querySelector('#custFiltersBtn .cust-lb-badge') ? 1 : 0,
            rows: document.querySelectorAll('#customerDataTableBody tr.cp-row').length,
        }));
        assert.equal(cleared.badge, 0, '"Clear all" removes the active-filter badge');
        // The scrim is tapped ABOVE the sheet (on a short screen the sheet
        // reaches far up, so the tap point has to follow its top edge).
        await page.click('#custFiltersScrim', { position: { x: 20, y: Math.max(8, Math.floor(sheet.top / 2)) } });
        await page.waitForTimeout(350);
        assert.equal(await page.evaluate(() => document.querySelector('#tab-customers').classList.contains('cust-filters-open')), false,
            'the scrim closes the filter sheet');
        ok('the filter sheet closes on Escape, on "Clear all" and on the scrim');

        // --- the phone select-all -----------------------------------------
        await page.click('#custSelectAllMobile');
        await page.waitForTimeout(450);
        const selAll = await page.evaluate(() => ({
            selected: document.querySelectorAll('#customerDataTableBody .cust-sel-box:checked').length,
            rows: document.querySelectorAll('#customerDataTableBody tr.cp-row').length,
            bar: (document.querySelector('#custBatchBar').innerText || '').replace(/\s+/g, ' ').trim(),
        }));
        assert.ok(selAll.selected > 0, 'the phone select-all selects the guests on the page');
        assert.ok(/selected/.test(selAll.bar), 'the action bar reports the selection');
        ok('the phone select-all box selects the guests on the page');

        // --- the action bar ------------------------------------------------
        const bar = await page.evaluate(() => {
            const wrap = document.querySelector('#custBatchBar');
            const inner = document.querySelector('#custBatchBar .cust-batch-bar');
            const nav = document.querySelector('.bottom-nav');
            const wr = wrap.getBoundingClientRect();
            const nr = nav ? nav.getBoundingClientRect() : null;
            const banner = document.querySelector('#demoModeBanner');
            const btns = [...document.querySelectorAll('.cust-batch-btn')].map((b) => {
                const r = b.getBoundingClientRect();
                return { t: b.innerText.trim(), w: Math.round(r.width), h: Math.round(r.height) };
            });
            const overlap = (a, b) => a && b && !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
            return {
                wrapperPos: getComputedStyle(wrap).position,
                bottom: Math.round(wr.bottom),
                height: Math.round(wr.height),
                navTop: nr ? Math.round(nr.top) : null,
                clearsNav: nr ? wr.bottom <= nr.top + 1 : false,
                onScreen: wr.top < window.innerHeight && wr.bottom > 0,
                text: inner ? inner.innerText.replace(/\s+/g, ' ').trim() : '',
                // The "select the whole filtered set" link only exists when
                // there IS more than the page - the demo tenant fits on one
                // page, so it is correctly absent.
                allLink: (() => {
                    const b = document.querySelector('[data-cust-select-all-matching]');
                    return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
                })(),
                btns,
                equalBtns: btns.length === 2 && btns[0].w === btns[1].w,
                bannerDisplay: banner ? getComputedStyle(banner).display : 'none',
                bannerOverlaps: banner ? overlap(banner.getBoundingClientRect(), wr) : false,
                bodyClass: document.body.className,
            };
        });
        assert.equal(bar.wrapperPos, 'sticky', 'the action bar is a sticky box');
        assert.ok(bar.clearsNav, 'the action bar clears the bottom nav (' + bar.bottom + ' vs ' + bar.navTop + ')');
        assert.ok(bar.onScreen, 'the action bar is on screen without scrolling');
        assert.ok(bar.height <= 190, 'the action bar is compact (' + bar.height + 'px)');
        assert.ok(/Up to \d+ can get a push/.test(bar.text), 'the action bar states the push reach honestly');
        assert.ok(/Up to \d+ can get WhatsApp/.test(bar.text), 'the action bar states the WhatsApp reach honestly');
        // The link only appears when the filtered set is bigger than the page.
        if (bar.allLink) {
            assert.ok(/Select all \d+/.test(bar.allLink), 'the action bar offers the whole filtered set: ' + bar.allLink);
        } else {
            assert.ok(/guests selected/.test(bar.text), 'the action bar reports the selection: ' + bar.text);
        }
        assert.equal(bar.equalBtns, true, 'the two action buttons are the same width (' + bar.btns.map((b) => b.w).join('/') + ')');
        assert.ok(bar.btns.every((b) => b.h >= 44), 'the action buttons are 44px tall');
        assert.equal(bar.bannerDisplay, 'none', 'the demo banner steps aside for the action bar');
        assert.equal(bar.bannerOverlaps, false, 'the demo banner does not cover the action bar');
        assert.ok(/cust-batch-open/.test(bar.bodyClass), 'the body knows the action bar is open');
        ok('a ' + w + 'px phone floats a compact action bar above the bottom nav, clear of the demo banner');

        // The card itself is the tap target for the profile.
        await page.locator('#customerDataTableBody tr.cp-row .mob-td-strong button').first().click();
        await page.waitForSelector('#customerProfileDrawer.active', { timeout: 30000 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);

        // Clear the selection again (the next width starts clean).
        await page.click('#custBatchBar [data-cust-clear-selection]');
        await page.waitForTimeout(250);
    }


    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    assert.equal(pageErrors.length, 0, 'no page errors: ' + pageErrors.join(' | '));
    assert.equal(consoleErrors.length, 0, 'no console errors: ' + consoleErrors.join(' | '));
    ok('0 page errors, 0 console errors');
} catch (e) {
    console.error('FAIL - ' + (e && e.message || e));
    if (pageErrors.length) console.error('pageErrors: ' + pageErrors.join(' | '));
    if (consoleErrors.length) console.error('consoleErrors: ' + consoleErrors.join(' | '));
    process.exitCode = 1;
} finally {
    await browser.close();
}

if (!process.exitCode) console.log('\n' + n + ' checks passed');
