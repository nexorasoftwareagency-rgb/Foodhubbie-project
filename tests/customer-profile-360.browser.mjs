// Customer Profile 360 — real-browser verification against the demo tenant.
//   node tests/customer-profile.browser.mjs
//
// Uses the locally built Admin shell (tools/serve-dist.cjs admin → :5055) so the
// run costs no Hosting egress, but the DATA is the real demo tenant: real
// Firebase Auth sign-in, real RTDB reads, real writes for the note/tag
// round-trip (the fixtures are removed again at the end).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PW || 'playwright')); }

const BASE = process.env.CP_BASE || 'http://127.0.0.1:5055/demo';
let n = 0;
const ok = (m) => console.log('PASS ' + (++n) + ' - ' + m);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

async function gotoCustomers() {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tab-customers', { state: 'attached', timeout: 45000 });
    // The Customers tab is reachable from the sidebar.
    await page.click('[data-tab="customers"]');
    // Wait for a REAL row (the table shows a "Loading customers..." placeholder first).
    await page.waitForSelector('#customerDataTableBody [data-cust-profile]', { timeout: 45000 });
}

try {
    // ---------------------------------------------------------- open a profile
    await gotoCustomers();
    const rowCount = await page.locator('#customerDataTableBody tr.cp-row').count();
    assert.ok(rowCount > 0, 'the demo tenant has customer rows');
    ok('Customers tab rendered ' + rowCount + ' customers');

    // The header and the cells must line up.
    const cols = await page.evaluate(() => {
        const heads = [...document.querySelectorAll('#customerDataTable thead th')].map((th) => th.textContent.trim());
        const row = document.querySelector('#customerDataTableBody tr.cp-row');
        const cells = row ? [...row.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim()) : [];
        return { heads, cells };
    });
    assert.equal(cols.heads.length, cols.cells.length, 'the header and the row have the same number of columns');
    const valueIdx = cols.heads.findIndex((h) => /Value/.test(h));
    const loyIdx = cols.heads.findIndex((h) => /Loyalty/.test(h));
    assert.ok(/^₹/.test(cols.cells[valueIdx] || ''), 'the Value column shows the rupee total: ' + cols.cells[valueIdx]);
    assert.ok(/pts|bronze|silver|gold/i.test(cols.cells[loyIdx] || ''), 'the Loyalty column shows the tier and points: ' + cols.cells[loyIdx]);
    ok('the table columns match their headers (Value under Value, points under Loyalty)');

    // A LINK inside the row must keep its own click (no profile).
    await page.evaluate(() => {
        const a = document.querySelector('#customerDataTableBody tr.cp-row a');
        if (a) { a.dataset.testHref = a.getAttribute('href') || ''; a.removeAttribute('href'); }
    });
    await page.locator('#customerDataTableBody tr.cp-row a').first().click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#customerProfileDrawer.active').count(), 0, 'a link inside the row must not open the profile');
    ok('a link inside the row keeps its own click (the profile stays closed)');

    // The WHOLE row opens the profile: click the ORDERS cell (no link inside).
    await page.locator('#customerDataTableBody tr.cp-row td:nth-child(4)').first().click();
    await page.waitForSelector('#customerProfileDrawer.active', { timeout: 30000 });
    await page.waitForSelector('#customerProfileBody .cp-kpis', { timeout: 30000 });
    ok('clicking anywhere in the row opens the customer profile');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#customerProfileDrawer.active').count(), 0, 'Escape closed it again');

    const firstName = page.locator('#customerDataTableBody button[data-cust-profile]').first();
    const phone = await firstName.getAttribute('data-cust-profile');
    assert.ok(/^\d{10}$/.test(phone || ''), 'the row carries a 10-digit phone: ' + phone);
    await firstName.click();

    await page.waitForSelector('#customerProfileDrawer.active', { timeout: 30000 });
    await page.waitForSelector('#customerProfileBody .cp-kpis', { timeout: 30000 });
    ok('the profile drawer opened for ' + phone);

    // ----------------------------------------------------------- header + KPIs
    const name = (await page.locator('#custProfName').innerText()).trim();
    assert.ok(name.length > 0, 'the guest has a name');
    const kpis = await page.locator('#customerProfileBody .cp-kpi').count();
    assert.ok(kpis >= 6, 'the KPI strip rendered: ' + kpis);
    const kpiText = await page.locator('#customerProfileBody .cp-kpis').innerText();
    assert.ok(/Paid orders/.test(kpiText) && /Lifetime spend/.test(kpiText), 'the KPI labels are there');
    ok('header + KPI strip: ' + name + ' / ' + kpis + ' KPIs');

    // -------------------------------------------------------- the heading + CTA
    // The eyebrow is uppercased by CSS, so compare case-insensitively.
    const eyebrow = (await page.locator('#customerProfileHead .cp-eyebrow').innerText()).trim();
    assert.equal(eyebrow.toLowerCase(), 'customer profile', 'the profile has a heading');
    const ctaKicker = (await page.locator('#customerProfileHead .cp-cta-kicker').innerText()).trim();
    const ctaTitle = (await page.locator('#customerProfileHead .cp-cta-title').innerText()).trim();
    assert.ok(ctaKicker.length > 0 && ctaTitle.length > 0, 'the CTA has a kicker and a title');
    const waHref = await page.locator('#customerProfileHead .cp-cta-primary').getAttribute('href');
    assert.ok(/^https:\/\/wa\.me\/91\d{10}\?text=/.test(waHref || ''), 'the primary CTA opens WhatsApp with a draft: ' + waHref);
    const ctaBtns = (await page.locator('#customerProfileHead .cp-cta-btn').allInnerTexts()).join(' ');
    assert.ok(ctaBtns.includes('Message on WhatsApp'), 'the WhatsApp CTA is labelled');
    assert.ok(ctaBtns.includes('Add a note'), 'the notes jump is labelled');
    const draft = decodeURIComponent((waHref || '').split('?text=')[1] || '');
    assert.ok(draft.length > 10 && !/%/.test(draft), 'the WhatsApp draft is readable: ' + draft);
    ok('the profile has a heading + a primary CTA (draft: "' + draft.slice(0, 58) + '...")');

    // "Add a note" jumps to the Notes tab.
    await page.click('#customerProfileHead [data-cp-tab="notes"]');
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#customerProfileTabs [data-cp-tab="notes"]').getAttribute('aria-selected'), 'true', 'the CTA switched to the Notes tab');
    await page.click('#customerProfileTabs [data-cp-tab="overview"]');
    await page.waitForTimeout(250);
    ok('the CTA can jump straight to the Notes tab');

    // --------------------------------------------------------------- the tabs
    const tabLabels = await page.locator('#customerProfileTabs [data-cp-tab]').allInnerTexts();
    assert.deepEqual(tabLabels.map((t) => t.trim()), ['Overview', 'Orders', 'Loyalty', 'Discounts', 'Notes']);
    for (const tab of ['overview', 'orders', 'loyalty', 'discounts', 'notes']) {
        await page.click(`#customerProfileTabs [data-cp-tab="${tab}"]`);
        await page.waitForTimeout(220);
        const bodyLen = (await page.locator('#customerProfileBody').innerHTML()).length;
        assert.ok(bodyLen > 200, 'tab ' + tab + ' rendered something');
    }
    ok('all five tabs render');

    // The Overview must carry the deeper insights, not just the KPIs.
    await page.click('#customerProfileTabs [data-cp-tab="overview"]');
    await page.waitForTimeout(220);
    const overview = await page.locator('#customerProfileBody').innerText();
    for (const needle of ['Segment & churn', 'Where they order', 'Favourites', 'Visit rhythm', 'Marketing consent', 'Details on file']) {
        assert.ok(overview.includes(needle), 'the overview is missing: ' + needle);
    }
    assert.ok(/Champion|Loyal|Potential|Promising|At risk|Needs attention|Dormant|Lapsed|New/.test(overview), 'a segment is named');
    ok('the overview carries the derived insight cards');

    // ------------------------------------------------------- orders + the link
    await page.click('#customerProfileTabs [data-cp-tab="orders"]');
    await page.waitForTimeout(220);
    const orderButtons = await page.locator('#customerProfileBody [data-cp-order]').count();
    const ordersText = await page.locator('#customerProfileBody').innerText();
    assert.ok(/paid/.test(ordersText), 'the orders tab states the paid basis');
    ok('orders tab: ' + orderButtons + ' orders listed');

    // -------------------------------------------------------- notes + tags
    await page.click('#customerProfileTabs [data-cp-tab="notes"]');
    await page.waitForTimeout(220);
    await page.fill('#cpNoteText', 'E2E note — allergic to peanuts');
    await page.click('[data-cp-note-form] button[type="submit"]');
    await page.waitForTimeout(1200);
    let notesText = await page.locator('#customerProfileBody').innerText();
    assert.ok(notesText.includes('E2E note'), 'the note appears in the list');
    ok('a staff note round-tripped');

    await page.fill('#cpTagInput', 'E2ETag');
    await page.click('[data-cp-tag-form] button[type="submit"]');
    await page.waitForTimeout(1200);
    notesText = await page.locator('#customerProfileBody').innerText();
    assert.ok(notesText.includes('E2ETag'), 'the tag appears');
    ok('a tag round-tripped');

    // Remove the tag again (the fixture must be cleaned up).
    await page.click('[data-cp-tag-remove="E2ETag"]');
    await page.waitForTimeout(1000);
    notesText = await page.locator('#customerProfileBody').innerText();
    assert.ok(!notesText.includes('E2ETag'), 'the tag was removed');
    ok('the tag was removed again');

    // Remove the note again — the demo tenant must be left byte-identical.
    // (An earlier interrupted run can leave one behind, so remove every
    //  note carrying the E2E marker, not just the newest.)
    for (let i = 0; i < 6; i++) {
        const targets = await page.locator('#customerProfileBody .cp-note-list li').evaluateAll((lis) => lis
            .filter((li) => (li.querySelector('.cp-note-text') || {}).textContent?.includes('E2E note'))
            .map((li) => li.querySelector('[data-cp-note-del]')?.getAttribute('data-cp-note-del'))
            .filter(Boolean));
        if (!targets.length) break;
        for (const id of targets) {
            await page.click(`[data-cp-note-del="${id}"]`);
            await page.waitForTimeout(900);
        }
    }
    notesText = await page.locator('#customerProfileBody').innerText();
    assert.ok(!notesText.includes('E2E note'), 'the note was deleted');
    ok('the note was deleted again');

    // ------------------------------------------------------------ responsive
    for (const width of [390, 360, 320]) {
        await page.setViewportSize({ width, height: 780 });
        await page.waitForTimeout(350);
        const box = await page.locator('#customerProfileDrawer').boundingBox();
        assert.ok(box && box.width <= width + 1, 'the drawer fits ' + width + 'px: ' + (box && box.width));
        assert.ok(box && box.x >= -1, 'the drawer is on screen at ' + width + 'px');
        const overflow = await page.evaluate(() => {
            const d = document.getElementById('customerProfileDrawer');
            return d ? d.scrollWidth - d.clientWidth : 999;
        });
        assert.ok(overflow <= 2, 'no sideways scroll at ' + width + 'px: ' + overflow);
        // The action buttons must be reachable.
        const act = await page.locator('#customerProfileHead [data-cp="copy-phone"]').boundingBox();
        assert.ok(act && act.width > 24 && act.height > 24, 'the copy button is tappable at ' + width + 'px');
    }
    ok('the drawer fits 390 / 360 / 320 with no sideways scroll');

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(250);

    // ------------------------------------------- an order hands over to Orders
    await page.click('#customerProfileTabs [data-cp-tab="orders"]');
    await page.waitForTimeout(400);
    await page.locator('#customerProfileBody [data-cp-order]').first().click();
    await page.waitForTimeout(1800);
    const profileClosed = !(await page.locator('#customerProfileDrawer').evaluate((d) => d.classList.contains('active')));
    assert.equal(profileClosed, true, 'the profile drawer closed for the order');
    const orderDrawerOpen = await page.locator('#orderDrawer.active').count();
    assert.equal(orderDrawerOpen, 1, 'the order drawer opened');
    ok('an order row hands over to the order drawer');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // --------------------------------------------------------- close + errors
    // Reopen the profile and close it with Escape.
    await page.locator('#customerDataTableBody button[data-cust-profile]').first().click();
    await page.waitForSelector('#customerProfileDrawer.active', { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    assert.ok(!(await page.locator('#customerProfileDrawer').evaluate((d) => d.classList.contains('active'))), 'Escape closes the drawer');
    ok('Escape closes the drawer');

    const realErrors = consoleErrors.filter((e) => !/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(e));
    assert.deepEqual(pageErrors, [], 'page errors: ' + pageErrors.join(' | '));
    assert.deepEqual(realErrors, [], 'console errors: ' + realErrors.join(' | '));
    ok('0 page errors, 0 console errors');
} finally {
    await browser.close();
}
console.log('\n' + n + ' checks passed.');
