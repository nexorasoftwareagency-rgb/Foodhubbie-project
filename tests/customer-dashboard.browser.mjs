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
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
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
    assert.equal(heads.length, 9, 'the table has 9 columns');
    ok('the header and the rows agree (' + heads.length + ' columns)');

    // The value cell is the money actually PAID, and the loyalty cell says how
    // many points can be spent (not the lifetime points).
    const firstRow = await page.evaluate(() => {
        const tr = document.querySelector('#customerDataTableBody tr.cp-row');
        const td = [...tr.querySelectorAll('td')].map((x) => x.innerText.replace(/\s+/g, ' ').trim());
        return td;
    });
    assert.ok(/^₹/.test(firstRow[5] || ''), 'the Value column shows a rupee total: ' + firstRow[5]);
    assert.ok(/pts/i.test(firstRow[6] || ''), 'the Loyalty column shows the spendable points: ' + firstRow[6]);
    assert.ok(firstRow[7] && firstRow[7].length > 0, 'the Segment column carries a badge');
    assert.ok(firstRow[8] && firstRow[8].length > 0, 'the Next-step column carries a pill');
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

    // --------------------------------------------------------------- the profile
    await page.locator('#customerDataTableBody tr.cp-row td:nth-child(1)').first().click();
    await page.waitForSelector('#customerProfileDrawer.active', { timeout: 30000 });
    ok('clicking a row opens the Customer Profile 360');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // ------------------------------------------------------------- the phone size
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 2, 'the page does not scroll sideways on a phone: ' + overflow + 'px');
    const kpiCols = await page.evaluate(() => {
        const g = getComputedStyle(document.querySelector('#custKpis')).gridTemplateColumns;
        return g.split(' ').filter(Boolean).length;
    });
    assert.ok(kpiCols === 3, 'the KPI strip folds to 3 columns on a phone: ' + kpiCols);
    ok('the dashboard fits a 390px phone (no sideways scroll, 3-column KPIs)');

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

    // A phone: five columns (identity, phone, value, segment, next step), the
    // customer cell pinned while the rest scrolls, and the chips in ONE
    // scrolling row so the table stays reachable.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const phone = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const disp = (s) => { const el = q(s); return el ? getComputedStyle(el).display : 'missing'; };
        const chips = q('#custFilters .cust-chips');
        const row = q('#custFilters .cust-filter-row');
        return {
            cust: disp('#customerDataTable thead .cust-col-cust'),
            phone: disp('#customerDataTable thead .cust-col-phone'),
            addr: disp('#customerDataTable thead .cust-col-addr'),
            last: disp('#customerDataTable thead .cust-col-last'),
            orders: disp('#customerDataTable thead .cust-col-orders'),
            value: disp('#customerDataTable thead .cust-col-value'),
            loyalty: disp('#customerDataTable thead .cust-col-loyalty'),
            segment: disp('#customerDataTable thead .cust-col-segment'),
            action: disp('#customerDataTable thead .cust-col-action'),
            sticky: getComputedStyle(q('#customerDataTableBody tr.cp-row td.cust-col-cust')).position,
            chipsScroll: chips ? chips.scrollWidth > chips.clientWidth : false,
            chipRowH: row ? Math.round(row.getBoundingClientRect().height) : 0,
        };
    });
    assert.equal(phone.addr, 'none', 'the Address column is gone on a phone');
    assert.equal(phone.last, 'none', 'the Last visit column is gone on a phone');
    assert.equal(phone.orders, 'none', 'the Orders column is gone on a phone');
    assert.equal(phone.loyalty, 'none', 'the Loyalty column is gone on a phone');
    assert.notEqual(phone.cust, 'none', 'the Customer column stays');
    assert.notEqual(phone.phone, 'none', 'the Phone column stays');
    assert.notEqual(phone.value, 'none', 'the Value column stays');
    assert.notEqual(phone.segment, 'none', 'the Segment column stays');
    assert.notEqual(phone.action, 'none', 'the Next step column stays');
    assert.equal(phone.sticky, 'sticky', 'the customer cell is pinned while the table scrolls');
    assert.ok(phone.chipsScroll, 'the chip row scrolls sideways on a phone');
    assert.ok(phone.chipRowH < 90, 'the chip groups stay on ONE line each (' + phone.chipRowH + 'px)');
    ok('a 390px phone keeps five columns, a pinned customer cell and one-line chip groups');

    // The pin has to WORK, not just be declared: scroll the table sideways and
    // the customer cell must stay at the left edge of the card.
    const pinned = await page.evaluate(async () => {
        const wrap = document.querySelector('#tab-customers .mob-table-scroll');
        const cell = document.querySelector('#customerDataTableBody tr.cp-row td.cust-col-cust');
        wrap.scrollLeft = 200;
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
        return {
            scrollLeft: Math.round(wrap.scrollLeft),
            cellLeft: Math.round(cell.getBoundingClientRect().left),
            wrapLeft: Math.round(wrap.getBoundingClientRect().left),
        };
    });
    assert.ok(pinned.scrollLeft > 0, 'the table really scrolls sideways on a phone: ' + pinned.scrollLeft + 'px');
    assert.ok(Math.abs(pinned.cellLeft - pinned.wrapLeft) <= 2, 'the customer cell stays pinned while the table scrolls (' + pinned.cellLeft + ' vs ' + pinned.wrapLeft + ')');
    ok('the customer cell stays pinned while the table scrolls sideways');

    // The last visit is not LOST on a phone - it moves under the name.
    const mobileLast = await page.locator('#customerDataTableBody tr.cp-row .cust-last-mobile').first().innerText();
    assert.ok(/Last visit/i.test(mobileLast), 'the phone shows the last visit under the name: ' + mobileLast);
    ok('the phone carries the last visit under the customer name');

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
