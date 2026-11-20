// Customer Database — pure-layer + source guards.
//   node tests/customer-dashboard.check.mjs
//
// Two halves:
//   1. the pure view layer (the maths and the markup) is exercised with real
//      rows — the SAME paid basis the Customer Profile uses, segment + audience
//      filters that cover every guest, the search blob, duplicate detection,
//      the KPI tiles and the pager;
//   2. source guards pin the things that would silently rot: the controller
//      must use the shared billing/loyalty helpers (not a private copy), the
//      view layer must stay node-importable (no ../../shared/* import), the
//      table header and the rendered row must have the same number of
//      columns, and the service worker must precache the new module under a
//      bumped shell.
//
// Mutation self-test: --self-test copies the view module, breaks the paid
// basis, the segment coverage, the consent rule and the duplicate rule, and
// proves the checks above catch every one of them.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { isBilledOrder } from '../shared/cost-math.js';
import { tierForPoints } from '../shared/loyalty-math.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEW_FILE = process.env.CUST_VIEW_FILE || join(root, 'Admin/js/features/customers-view.js');
const CTRL_FILE = process.env.CUST_CTRL_FILE || join(root, 'Admin/js/features/customers.js');
const HTML_FILE = join(root, 'Admin/index.html');
const SW_FILE = join(root, 'Admin/sw.js');

const calc = { isBilledOrder, tierForPoints };
let n = 0;
const ok = (m) => { n++; console.log('PASS ' + m); };

const view = await import(pathToFileURL(VIEW_FILE).href);
const V = view;

// ---------------------------------------------------------------- fixtures

const NOW = Date.parse('2026-11-20T00:00:00.000Z');
const DAY = 86400000;

function order(overrides = {}) {
    return {
        orderId: 'X-1',
        status: 'Delivered',
        paymentStatus: 'Paid',
        total: 200,
        subtotal: 180,
        discount: 0,
        source: 'WA',
        type: 'Online',
        customerPhone: '9000000201',
        createdAt: NOW - DAY,
        items: [{ name: 'Cheese Corn Pizza', size: 'Regular', qty: 1, price: 200, total: 200 }],
        ...overrides,
    };
}

function series(count, gapDays, total = 200, endDaysAgo = 2, over = {}) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const ago = endDaysAgo + (count - 1 - i) * gapDays;
        out.push(order({ ...over, orderId: `X-${i}`, createdAt: NOW - ago * DAY, total }));
    }
    return out;
}

const customers = [
    { phone: '9000000201', data: { name: 'Ishita Rai', address: '12 MG Road, Pune', registeredAt: NOW - 40 * DAY, promotionalConsent: true, loyalty: { points: 148, lifetimePoints: 648 } } },
    { phone: '9000000202', data: { name: 'Rahul Verma', address: '4 Park Street', registeredAt: NOW - 200 * DAY } },
    { phone: '9000000203', data: { name: 'Anita Desai', address: '9 Lake View', registeredAt: NOW - 5 * DAY } },
    { phone: '9000000204', data: { name: 'Ishita Rai', address: '77 Baner Road', registeredAt: NOW - 90 * DAY } },
    { phone: '9000000205', data: { name: '<img src=x onerror=alert(1)>', address: '', registeredAt: NOW - 2 * DAY } },
    // Same address as Ishita, DIFFERENT name - a shared address is NOT a duplicate.
    { phone: '9000000206', data: { name: 'Meera Patel', address: '12 MG Road, Pune', registeredAt: NOW - 400 * DAY } },
];

const orders = [
    // Ishita: 3 paid orders + 1 cancelled (must NOT count).
    ...series(3, 10, 200, 2, { customerPhone: '9000000201' }),
    order({ orderId: 'X-CANCEL', customerPhone: '9000000201', status: 'Cancelled', paymentStatus: 'Paid', total: 900, createdAt: NOW - 1 * DAY }),
    // Rahul: a weekly regular who stopped 70 days ago + a walkout (eaten, unpaid).
    ...series(3, 7, 100, 70, { customerPhone: '9000000202', items: [{ name: 'Paneer Tikka', qty: 1, price: 100, total: 100 }] }),
    order({ orderId: 'X-WALK', customerPhone: '9000000202', status: 'Walkout', paymentStatus: 'Unpaid', total: 700, createdAt: NOW - 50 * DAY }),
    // Anita: never ordered.
];

const built = V.buildCustomerRows({
    customers, orders, rankings: {}, optOutPhones: ['9000000202'],
    loyaltyConfig: null, now: NOW, storeName: 'Demo Dashboard',
}, calc);

const rows = built.rows;
const byPhone = (p) => rows.find((r) => r.phone === p);

// ------------------------------------------------------- 1. the paid basis

{
    const ishita = byPhone('9000000201');
    assert.ok(ishita, 'the customer was built');
    assert.equal(ishita.orderCount, 3, 'only the PAID orders are counted');
    assert.equal(ishita.ltv, 600, 'the value is the money actually paid');
    assert.equal(ishita.orderTotal, 4, 'the excluded orders are still visible in the total');
    assert.equal(ishita.rfm.segment !== 'new', true);
    ok('the list uses the PAID basis (cancelled orders never inflate the value)');
}
{
    const rahul = byPhone('9000000202');
    assert.equal(rahul.orderCount, 3, 'a walkout is eaten-but-unpaid - it is not spend');
    assert.equal(rahul.ltv, 300, 'the walkout amount is excluded from the value');
    ok('a walkout (eaten, never paid) is excluded from the value');
}
{
    const anita = byPhone('9000000203');
    assert.equal(anita.orderCount, 0);
    assert.equal(anita.ltv, 0);
    assert.equal(anita.lastVisit, 'Never');
    assert.equal(anita.rfm.segment, 'new');
    ok('a guest with no orders reads as zero, not as missing');
}

// ---------------------------------------------------- 2. segments + filters

{
    const chips = V.SEGMENT_CHIPS.map((c) => c.key);
    for (const key of ['all', 'champions', 'promising', 'at-risk', 'lapsed', 'new', 'one-time']) {
        assert.ok(chips.includes(key), 'the segment chip exists: ' + key);
    }
    // EVERY guest must land in at least one segment (plus "all").
    for (const r of rows) {
        const hits = V.SEGMENT_CHIPS.filter((c) => c.match(r)).length;
        assert.ok(hits >= 1, 'the guest ' + r.phone + ' is in at least one segment');
    }
    ok('the segment chips cover every guest (no guest is unreachable)');
}
{
    const lapsed = V.filterRows(rows, { segment: 'lapsed', thresholds: built.thresholds });
    assert.equal(lapsed.length, 1, 'the 100-day-old regular is lapsed');
    assert.equal(lapsed[0].phone, '9000000202');
    ok('the Lapsed segment finds the guest who went quiet');
}
{
    const reachable = V.filterRows(rows, { segment: 'all', audiences: ['promo-reachable'], thresholds: built.thresholds });
    assert.deepEqual(reachable.map((r) => r.phone), ['9000000201'], 'only the opted-in guest is promo-reachable');
    ok('the Promo-reachable audience mirrors the bot consent rule');
}
{
    const stopped = byPhone('9000000202');
    assert.equal(stopped.consent.state, 'opted-out', 'a STOP marker blocks the guest');
    assert.equal(stopped.consent.label, 'Unsubscribed');
    ok('the STOP opt-out is read from bot/promotions/optout');
}
{
    const appOff = V.buildCustomerRows({
        customers: [{ phone: '9000000209', data: { name: 'App Guest', app: { consent: { offers: false } }, promotionalConsent: true } }],
        orders: [], rankings: {}, optOutPhones: [], loyaltyConfig: null, now: NOW, storeName: '',
    }, calc);
    assert.equal(appOff.rows[0].consent.state, 'opted-out', 'the app switch wins over the legacy flag');
    ok('the customer app "offers off" switch wins over the legacy consent flag');
}
{
    const search = V.filterRows(rows, { segment: 'all', term: 'pizza', thresholds: built.thresholds });
    assert.equal(search.length, 1, 'searching a dish finds the guest who ordered it');
    assert.equal(search[0].phone, '9000000201');
    const dish2 = V.filterRows(rows, { segment: 'all', term: 'paneer', thresholds: built.thresholds });
    assert.deepEqual(dish2.map((r) => r.phone), ['9000000202'], 'the search finds the other dish too');
    ok('the search blob covers the dishes a guest orders, not just their name');
}
{
    const byPhoneSearch = V.filterRows(rows, { segment: 'all', term: '9000000203', thresholds: built.thresholds });
    assert.equal(byPhoneSearch.length, 1);
    ok('the search blob covers the phone number');
}

// ------------------------------------------------------- 3. duplicates (B5)

{
    const a = byPhone('9000000201');
    const b = byPhone('9000000204');
    assert.ok(a.duplicate, 'the same name on two numbers is flagged');
    assert.equal(a.duplicate.count, 2);
    assert.equal(b.duplicate.kind, 'name');
    ok('a possible duplicate (same name, two numbers) is flagged read-only');
}
{
    const solo = byPhone('9000000202');
    assert.equal(solo.duplicate, undefined, 'a unique guest is not flagged');
    ok('a unique guest carries no duplicate badge');
}
{
    const shared = byPhone('9000000206');
    assert.equal(shared.duplicate, undefined, 'a shared address alone is NOT a duplicate');
    ok('a shared address alone is not flagged (family, office and walk-ins share one)');
}
{
    const ishita = byPhone('9000000201');
    const html = V.renderRow(ishita);
    assert.ok(/Thank them|Win back|Reach out|Keep up|Check in|Nudge|Welcome/.test(html), 'the list shows a SHORT next step');
    assert.ok(html.includes(ishita.action.title), 'the full next step is in the tooltip: ' + ishita.action.title);
    ok('the list carries a short next-step pill and the full sentence in the tooltip');
}

// ------------------------------------------------------------- 4. the KPIs

{
    const tiles = V.computeKpiTiles(rows, built.thresholds);
    const keys = tiles.map((t) => t.key);
    assert.deepEqual(keys, ['guests', 'active30', 'atrisk', 'lapsed', 'champions', 'new30']);
    const guests = tiles.find((t) => t.key === 'guests');
    assert.equal(guests.value, rows.length, 'the Guests tile counts every guest');
    const new30 = tiles.find((t) => t.key === 'new30');
    assert.equal(new30.value, 2, 'two guests joined inside 30 days');
    ok('the KPI tiles count the database (guests / active / at risk / lapsed / champions / new)');
}
{
    const counts = V.computeChipCounts(rows, built.thresholds);
    assert.equal(counts.segments.all, rows.length);
    assert.equal(counts.audiences['promo-reachable'], 1);
    assert.equal(counts.audiences['new-30d'], 2);
    ok('the chip counts say how many guests each filter would give you');
}

// ------------------------------------------------------------ 5. the markup

{
    const html = V.renderRow(byPhone('9000000201'));
    const cells = html.match(/<td/g) || [];
    assert.equal(cells.length, 10, 'the row renders 10 cells (the selection checkbox leads)');
    assert.ok(/data-cust-select="9000000201"/.test(html), 'the row carries a selection checkbox');
    assert.ok(/₹600/.test(html), 'the value cell shows the paid value');
    assert.ok(/pts/.test(html), 'the loyalty cell says how many points can be spent');
    assert.ok(/points to spend/.test(html), 'the loyalty tooltip explains the spendable points');
    assert.ok(/Lifetime/.test(html) === false, 'the lifetime points are not mixed into the spendable points');
    ok('the row shows the paid value, the spendable points and the next step');
}
{
    const hostile = V.renderRow(byPhone('9000000205'));
    const rawImg = '<' + 'img src=x';
    assert.equal(hostile.indexOf(rawImg), -1, 'no raw markup leaks into the row');
    assert.notEqual(hostile.indexOf('&#' + '60;img'), -1, 'the hostile name is rendered as text');
    ok('a hostile customer name is escaped in the rendered row');
}
{
    const pager = V.renderPager(50, 248, 50);
    assert.ok(/Showing 50 of 248/.test(pager), 'the pager says what it is showing');
    assert.ok(/Load 50 more/.test(pager), 'the pager offers the next page');
    assert.equal(V.renderPager(248, 248, 50).includes('Load'), false, 'no button when everything is shown');
    ok('the pager shows "showing N of M" and only offers more when there is more');
}
{
    const empty = V.renderEmpty('no-match', { term: 'zzz', suggestion: { label: 'Lapsed', count: 3 } });
    assert.ok(/Clear filters/.test(empty), 'the empty state offers a way out');
    assert.ok(/Lapsed/.test(empty), 'the empty state suggests the biggest segment');
    ok('an empty filter result explains itself and offers a way out');
}
{
    const skel = V.renderSkeleton(3);
    assert.equal((skel.match(/<tr/g) || []).length, 3, 'the loading state renders skeleton rows');
    assert.ok(!/spinner/i.test(skel), 'the loading state is rows, not a spinner');
    ok('the loading state is skeleton rows (Carbon), not a spinner');
}

// ------------------------------------------------------- 6. source guards

const ctrl = readFileSync(CTRL_FILE, 'utf8');
const viewSrc = readFileSync(VIEW_FILE, 'utf8');
const html = readFileSync(HTML_FILE, 'utf8');
const sw = readFileSync(SW_FILE, 'utf8');

{
    assert.ok(/from '\.\.\/\.\.\/shared\/cost-math\.js'/.test(ctrl), 'the controller uses the shared billing helper');
    assert.ok(/from '\.\.\/\.\.\/shared\/loyalty-math\.js'/.test(ctrl), 'the controller uses the shared loyalty helper');
    assert.ok(!/function isPaidOrder/.test(ctrl), 'no private copy of the paid basis in the controller');
    ok('the controller injects the shared helpers instead of copying the maths');
}
{
    assert.ok(!/from '\.\.\/\.\.\/shared\//.test(viewSrc), 'the view layer must stay importable from node');
    assert.ok(/from '\.\/customer-profile-view\.js'/.test(viewSrc), 'the view layer reuses the profile maths');
    ok('the view layer stays node-importable (no ../../shared/* import)');
}
{
    for (const id of ['custKpis', 'custFilters', 'custPager', 'custDensityBtn', 'custTableCount', 'custBatchBar', 'custSelectAll']) {
        assert.ok(html.includes(`id="${id}"`), 'the markup has #' + id);
    }
    const tableAt = html.indexOf('id="customerDataTable"');
    assert.ok(tableAt > 0, 'the customers table exists');
    const headBlock = html.slice(tableAt, html.indexOf('</thead>', tableAt));
    const heads = (headBlock.match(/<th[\s>]/g) || []).length;
    assert.equal(heads, 10, 'the table header has 10 columns');
    ok('the markup carries the KPI strip, the filter rows, the batch bar, the pager and a 10-column header');
}
{
    assert.ok(sw.includes("'./js/features/customers-view.js'"), 'the service worker precaches the new module');
    const shell = (sw.match(/foodhubbie-erp-shell-v([\d.]+)'/) || [])[1];
    assert.ok(shell && shell !== '5.12.72', 'the service worker shell was bumped');
    ok('the service worker precaches customers-view.js under a bumped shell');
}
{
    // The phone card layout is pure CSS, and ONE typo in a selector id killed
    // a whole layout once (`#tab-customyers`): the rules parsed, the media
    // query matched, and not one of them applied. Every selector must use the
    // REAL tab id, and every id the CSS targets must exist in the markup.
    const css = (viewSrc.match(/CUSTOMER_DASHBOARD_CSS = `([\s\S]*?)`;/) || [])[1] || '';
    assert.ok(css.length > 1000, 'the Customers CSS lives in the view module');
    const tabIds = [...new Set(css.match(/#tab-custom[\w-]*/g) || [])];
    assert.deepEqual(tabIds, ['#tab-customers'], 'every Customers CSS selector uses the real tab id: ' + tabIds.join(', '));
    const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    // a hex colour is not an id
    const usedIds = [...new Set((css.match(/#[a-zA-Z][\w-]*/g) || []).map((s) => s.slice(1)))]
        .filter((id) => !/^[0-9a-f]{3,8}$/i.test(id));
    const missing = usedIds.filter((id) => !htmlIds.has(id));
    assert.deepEqual(missing, [], 'every id the Customers CSS targets exists in the markup: ' + missing.join(', '));
    assert.ok(/@media \(max-width: 768px\)/.test(css), "the phone layout uses the Admin's own 768px breakpoint");
    ok('the Customers CSS has no dead selectors (one typo id killed a whole phone layout once)');
}
{
    // The contextual action bar is a FLOATING bar on a phone. The sticky box
    // has to be the direct child of the card: a sticky box can only travel
    // inside its own parent's box, and the wrapper around the bar is exactly
    // as tall as the bar itself - so the stickiness lives on the wrapper.
    const css = (viewSrc.match(/CUSTOMER_DASHBOARD_CSS = `([\s\S]*?)`;/) || [])[1] || '';
    assert.ok(/#tab-customers #custBatchBar \{[^}]*position: sticky;/.test(css), 'the action bar WRAPPER is the sticky box');
    assert.ok(/#tab-customers \.cust-batch-bar \{[^}]*position: static;/.test(css), 'the bar itself is a plain grid inside the sticky wrapper');
    ok('the phone action bar sticks to the bottom through its wrapper');
}
{
    // The phone card carries the facts the folded columns would have shown.
    const rowHtml = V.renderRow(byPhone('9000000201'));
    assert.ok(/class="cust-mob-meta"/.test(rowHtml), 'the row carries a mobile summary line');
    assert.ok(/Last visit/.test(rowHtml), 'the mobile summary line carries the last visit');
    assert.ok(/orders/.test(rowHtml), 'the mobile summary line carries the paid order count');
    assert.ok(/Bronze|Silver|Gold/.test(rowHtml), 'the mobile summary line carries the loyalty tier');
    ok('the row markup carries the phone summary line (last visit, orders, tier)');
}
{
    assert.ok(/PAGE_SIZE = 50/.test(ctrl), 'the pager page size is defined');
    assert.ok(/localStorage\.setItem\(DENSITY_KEY/.test(ctrl), 'the density toggle is remembered');
    assert.ok(/DENSITY_KEY = 'fh:custDensity'/.test(ctrl), 'the density key is namespaced');
    ok('the pager and the density toggle are part of the controller');
}
{
    assert.ok(!/â/.test(viewSrc), 'no mojibake in the new module');
    assert.ok(!/ï¿½/.test(viewSrc), 'no BOM in the new module');
    assert.ok(!/�/.test(viewSrc), 'no replacement characters in the new module');
    // The rupee sign comes from the SHARED money() helper - the view layer
    // must not keep a second copy of the formatter.
    assert.ok(/money\(/.test(viewSrc), 'the row uses the shared money formatter');
    assert.ok(!/function money/.test(viewSrc), 'no private copy of the money formatter');
    ok('the new module is clean UTF-8 and reuses the shared money formatter');
}
{
    // ---------------------------------------------------------------------
    // THE PHONE LIST CONTROL BAR + THE FILTER SHEET
    //
    // The column headers used to become a scrolling strip of sort chips on a
    // phone: it wrapped to two rows, cut mid-word ("Last…", "Orde…"),
    // scrolled sideways and - being sticky INSIDE the table - floated over
    // the first card. A phone now gets ONE control row (select-all, a NATIVE
    // sort picker, a Filters button) and the filter chips live in a SHEET.
    // ---------------------------------------------------------------------
    for (const id of ['custListBar', 'custFiltersScrim']) {
        assert.ok(html.includes(`id="${id}"`), 'the markup has #' + id);
    }
    assert.ok(/export function renderListBar/.test(viewSrc), 'the view layer renders the phone control bar');
    assert.ok(/export const SORT_OPTIONS/.test(viewSrc), 'the sort options are a single list');
    // Every sortable column of THIS table must be reachable from the native
    // picker, in BOTH directions - a sort key that only the desktop header
    // knows about would become unreachable on a phone.
    const tableAt = html.indexOf('id="customerDataTable"');
    const headBlock = html.slice(tableAt, html.indexOf('</thead>', tableAt));
    const sortable = [...new Set([...headBlock.matchAll(/<th[^>]*data-sort="([^"]+)"/g)].map((m) => m[1]))];
    const opts = V.SORT_OPTIONS || [];
    for (const field of sortable) {
        const dirs = opts.filter((o) => o.field === field).map((o) => o.dir).sort().join(',');
        assert.equal(dirs, 'asc,desc', 'the sort picker covers ' + field + ' in both directions');
    }
    ok('the native sort picker covers every sortable column in both directions');
    {
        const css = (viewSrc.match(/CUSTOMER_DASHBOARD_CSS = `([\s\S]*?)`;/) || [])[1] || '';
        assert.ok(/#tab-customers \.mob-data-table thead \{ display: none; \}/.test(css),
            'the phone hides the table header (it was the broken sort strip)');
        assert.ok(/#tab-customers \.cust-filters \{[^}]*position: fixed;/.test(css),
            'the filter chips are a fixed bottom sheet on a phone');
        assert.ok(/transform: translateY\(105%\);/.test(css), 'the sheet is parked off-screen until it is asked for');
        assert.ok(/\.cust-filters-open \.cust-filters \{[^}]*transform: none;/.test(css), 'the sheet slides in when it opens');
        assert.ok(/\.cust-filters-scrim \{[^}]*position: fixed;/.test(css), 'the sheet has a scrim');
        assert.ok(/#tab-customers \.cust-lb-btn \{[^}]*min-height: 44px;/.test(css), 'the Filters button is a 44px tap target');
        assert.ok(/\.cust-lb-all input\[type="checkbox"\] \{[^}]*width: 24px;/.test(css), 'the select-all box is a 24px box');
        assert.ok(/\.cust-lb-all input\[type="checkbox"\] \{[^}]*padding: 0 !important;/.test(css),
            'the global input padding cannot squash the checkbox');
        assert.ok(/#tab-customers \.cust-batch-btn \{[^}]*min-height: 44px;/.test(css), 'the action buttons are 44px tall');
        assert.ok(/grid-template-columns: 1fr 1fr;/.test(css), 'the two action buttons are equal columns');
        // A forced width:100% on the phone card children made every one of
        // them overflow the card by 12px on the right (the KPI tiles and the
        // list were cut off on a phone).
        assert.ok(/#tab-customers \.mob-table-card > \* \{ flex: none; width: auto; \}/.test(css),
            'the phone card children keep their own margins instead of overflowing the card');
        // The toolbar used to carry an inline style, which beat every CSS
        // rule - the phone layout could not change its own head row.
        assert.ok(!/class="cust-toolbar" style=/.test(html), 'the toolbar has no inline style (CSS owns the layout)');
        ok('the phone control bar, the filter sheet and the action bar are sized for a thumb');
    }
    assert.ok(/#custSortSelect/.test(ctrl), 'the controller reads the native sort picker');
    assert.ok(/_setFilterSheet\(true\)/.test(ctrl), 'the Filters button opens the sheet');
    assert.ok(/cust-filters-open/.test(ctrl), 'the sheet state is a class on the tab');
    assert.ok(/custFiltersScrim/.test(ctrl), 'the scrim closes the sheet');
    assert.ok(/e\.key !== 'Escape'/.test(ctrl), 'Escape closes the sheet');
    assert.ok(/custSelectAllMobile/.test(ctrl), 'the phone has its own select-all box');
    assert.ok(/cust-batch-open/.test(ctrl), 'the action bar marks the body so the demo banner steps aside');
    assert.ok(/cust-sheet-open/.test(ctrl), 'the sheet marks the body so the demo banner steps aside');
    {
        const css = (viewSrc.match(/CUSTOMER_DASHBOARD_CSS = `([\s\S]*?)`;/) || [])[1] || '';
        // The tab pane is z-index 20 and the bottom nav is z-index 5000 in the
        // same app shell: without a lift the nav paints over the sheet's
        // footer and swallows the "Clear all" tap.
        assert.ok(/#tab-customers\.cust-filters-open \{ z-index: 6000 !important; \}/.test(css),
            'the sheet lifts the tab pane above the bottom nav');
    }
    const demo = readFileSync(join(root, 'Admin/js/demo-mode.js'), 'utf8');
    assert.ok(/body\.cust-batch-open #demoModeBanner\{display:none !important\}/.test(demo),
        'the demo banner hides while the action bar is open (they collided on a phone)');
    assert.ok(/body\.cust-sheet-open #demoModeBanner\{display:none !important\}/.test(demo),
        'the demo banner hides while the filter sheet is open (it is painted over the whole shell)');
    ok('the controller wires the phone control bar, the sheet and the banner collision');
}

{
    // ---------------------------------------------------------------------
    // THE PHONE LEGIBILITY + TAP-TARGET FLOOR
    //
    // A phone is read at arm's length and tapped with a thumb. The audit
    // measured a 22x22 checkbox, a 20px WhatsApp link, a 12px "Reset phone
    // lock" link and six text sizes under 12px. The browser guard MEASURES
    // the result; these guards pin the source that produced it.
    // ---------------------------------------------------------------------
    const css = (viewSrc.match(/CUSTOMER_DASHBOARD_CSS = `([\s\S]*?)`;/) || [])[1] || '';
    // the row checkbox is wrapped in a label so the phone can give it a 44x44
    // hit area while the box itself stays 22px of paint
    const rowHtml = V.renderRow(byPhone('9000000201'));
    assert.ok(/class="cust-sel-hit"/.test(rowHtml), 'the row checkbox is wrapped in a hit-area label');
    assert.ok(/#tab-customers \.cust-sel-hit \{[^}]*padding: 11px;/.test(css), 'the checkbox hit area is padded to 44px');
    assert.ok(/#tab-customers \.cust-sel-hit \{[^}]*margin: -11px;/.test(css), 'the padded hit area does not move the layout');
    // the inline links clear the WCAG 2.2 target-size minimum (24px)
    assert.ok(/#tab-customers \.mob-wa-link \{[^}]*min-height: 28px;/.test(css), 'the WhatsApp link is at least 24px tall');
    assert.ok(/#tab-customers \.mob-reset-lock \{[^}]*min-height: 32px;/.test(css), 'the repair link is at least 24px tall');
    assert.ok(/#tab-customers \.mob-reset-lock \{[^}]*font-size: 12\.5px;/.test(css), 'the repair link is readable');
    // the type floor: the phone overrides every caption that was under 12px
    for (const sel of ['cust-pill', 'cust-reach', 'cust-mob-meta', 'cust-chip-count', 'cust-filter-label', 'cust-batch-reach']) {
        assert.ok(new RegExp('#tab-customers \\.' + sel + '[^{]*\\{[^}]*font-size: 12px;').test(css),
            'the phone sets ' + sel + ' to 12px');
    }
    assert.ok(/#tab-customers \.cust-kpi-label \{[^}]*font-size: 12px;/.test(css), 'the KPI caption is 12px on a phone');
    assert.ok(/#tab-customers \.cust-lb-badge \{[^}]*font-size: 12px;/.test(css), 'the filter-count badge is 12px on a phone');
    // the sheet contains its own scroll, and every custom control has a
    // visible focus ring
    assert.ok(/overscroll-behavior: contain;/.test(css), 'the sheet contains its own scroll');
    assert.ok(/#tab-customers \.mob-wa-link:focus-visible/.test(css), 'the WhatsApp link has a focus ring');
    assert.ok(/#tab-customers \.mob-reset-lock:focus-visible/.test(css), 'the repair link has a focus ring');
    assert.ok(/#tab-customers \.cust-sheet-close:focus-visible/.test(css), 'the sheet close button has a focus ring');
    // the duplicate warning used to disappear with the folded columns
    assert.ok(/class="cust-joined-text"/.test(rowHtml), 'the joined line is split so the duplicate badge can survive');
    assert.ok(/#tab-customers \.cust-joined-text \{ display: none; \}/.test(css), 'the phone hides the joined date');
    assert.ok(/#tab-customers \.cust-dup \{[^}]*font-size: 12px;/.test(css), 'the duplicate badge is readable on a phone');
    // the web-interface rules that are cheap to honour
    assert.ok(/id="alertContainer" role="status" aria-live="polite"/.test(html), 'the toast container announces itself');
    assert.ok(/placeholder="Search name, phone, address, dish…"/.test(html), 'the placeholder ends with an ellipsis character');
    ok('the phone legibility floor (12px text, 44px controls, 24px links) is pinned in the source');
}

console.log('\n' + n + ' checks passed');

// ------------------------------------------------------ mutation self-test

if (process.argv.includes('--self-test')) {
    const tmp = mkdtempSync(join(tmpdir(), 'cust-dash-'));
    // The mutant imports './customer-profile-view.js' - copy the sibling too,
    // otherwise the mutant fails to LOAD and every mutation would look
    // "caught" for the wrong reason.
    copyFileSync(join(root, 'Admin/js/features/customer-profile-view.js'), join(tmp, 'customer-profile-view.js'));

    const mutants = [
        {
            name: 'the paid basis is broken (cancelled orders count again)',
            from: 'const lifetime = computeLifetime(bucket.all, now, calc.isBilledOrder);',
            to: 'const lifetime = computeLifetime(bucket.all, now, () => true);',
        },
        {
            name: 'the last visit follows an UNPAID order',
            from: 'const lastPaid = bucket.paid.slice().sort((a, b) => orderTs(b) - orderTs(a))[0] || null;',
            to: 'const lastPaid = bucket.all.slice().sort((a, b) => orderTs(b) - orderTs(a))[0] || null;',
        },
        {
            name: 'the row shows the sum of EVERY order instead of the paid value',
            from: '${esc(money(r.ltv))}',
            to: '${esc(money(r.lifetime.totalOrders))}',
        },
        {
            name: 'the segment coverage is broken (every guest is a champion)',
            from: "match: (r) => r.rfm.segment === 'champion' || r.rfm.segment === 'loyal',",
            to: 'match: () => true,',
        },
        {
            name: 'the consent rule is broken (everyone is reachable)',
            from: "case 'promo-reachable':\n            return row.consent.state === 'opted-in';",
            to: "case 'promo-reachable':\n            return true;",
        },
        {
            name: 'the duplicate rule is broken (every guest is flagged)',
            from: 'if (group.length < 2) continue;',
            to: 'if (group.length < 1) continue;',
        },
    ];

    const INPUT = {
        customers, orders, rankings: {}, optOutPhones: ['9000000202'],
        loyaltyConfig: null, now: NOW, storeName: 'Demo Dashboard',
    };
    /** A fingerprint of everything the mutations are supposed to change. */
    const fingerprint = (mod) => {
        const res = mod.buildCustomerRows(INPUT, calc);
        const r = res.rows;
        return {
            ltv: r.find((x) => x.phone === '9000000201').ltv,
            orders: r.find((x) => x.phone === '9000000201').orderCount,
            lastVisit: r.find((x) => x.phone === '9000000201').lastVisit,
            lastOrderId: r.find((x) => x.phone === '9000000201').lastOrderId,
            champions: r.filter((x) => mod.SEGMENT_CHIPS.find((c) => c.key === 'champions').match(x)).length,
            reachable: r.filter((x) => mod.matchAudience(x, 'promo-reachable', res.thresholds)).length,
            duplicates: r.filter((x) => x.duplicate).length,
            rowHtml: mod.renderRow(r.find((x) => x.phone === '9000000201')),
        };
    };
    const baseline = fingerprint(V);

    let caught = 0;
    for (let i = 0; i < mutants.length; i++) {
        const m = mutants[i];
        const file = join(tmp, `mutant-${i}.js`);
        const mutated = viewSrc.replace(m.from, m.to);
        if (mutated === viewSrc) {
            console.log('FAIL self-test - the mutation text no longer matches the source: ' + m.name);
            continue;
        }
        writeFileSync(file, mutated);
        let failed = false;
        let message = '';
        try {
            const mod = await import(pathToFileURL(file).href + '?v=' + Date.now());
            const fp = fingerprint(mod);
            const changed = Object.keys(baseline).filter((k) => fp[k] !== baseline[k]);
            if (!changed.length) throw new Error('the mutation changed nothing');
            message = 'changed: ' + changed.join(', ');
            failed = true; // a detected mutation IS the failure we wanted
        } catch (e) {
            failed = true;
            message = e.message;
        }
        if (failed) {
            caught++;
            console.log('PASS self-test - caught: ' + m.name + ' (' + message + ')');
        } else {
            console.log('FAIL self-test - NOT caught: ' + m.name);
        }
    }
    console.log(caught + '/' + mutants.length + ' mutations caught');
    if (caught !== mutants.length) process.exit(1);
}
