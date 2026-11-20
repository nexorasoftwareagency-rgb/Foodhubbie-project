// Customer Profile 360 — pure-layer + source guards.
//   node tests/customer-profile-360.check.mjs
//
// Two halves:
//   1. the pure view layer (the maths and the markup) is exercised with real
//      rows — paid-order basis, RFM against a guest's OWN rhythm + the outlet's
//      own base, channel mix, favourites, discount reliance, consent, and that
//      the rendered markup escapes hostile names;
//   2. source guards pin the things that would silently rot: the controller
//      must use the shared billing/loyalty helpers (not a private copy), the
//      staff notes must stay under the admin-only customers node, the drawer
//      ids must exist in index.html, and the service worker must precache the
//      two new modules under a bumped shell.
//
// Mutation self-test: --self-test copies the view module, breaks the paid
// basis, the lapsing test, the consent rule and the base scoring, and proves
// the checks above catch every one of them.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { isBilledOrder } from '../shared/cost-math.js';
import { tierForPoints } from '../shared/loyalty-math.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEW_FILE = process.env.PROFILE_VIEW_FILE || join(root, 'Admin/js/features/customer-profile-view.js');
const CTRL_FILE = process.env.PROFILE_CTRL_FILE || join(root, 'Admin/js/features/customer-profile.js');
const CUST_FILE = join(root, 'Admin/js/features/customers.js');
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
        createdAt: NOW - DAY,
        items: [{ name: 'Cheese Corn Pizza', size: 'Regular', qty: 1, price: 200, total: 200 }],
        ...overrides,
    };
}

function series(count, gapDays, total = 200, endDaysAgo = 2, base = {}) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const ago = endDaysAgo + (count - 1 - i) * gapDays;
        out.push(order({ ...base, orderId: `X-${i}`, createdAt: NOW - ago * DAY, total }));
    }
    return out;
}

// ------------------------------------------------------- 1. phone + timestamps

{
    assert.equal(V.normalizePhone('9000000201'), '9000000201');
    assert.equal(V.normalizePhone('+91 9000000201'), '9000000201');
    assert.equal(V.normalizePhone('919000000201'), '9000000201');
    assert.equal(V.normalizePhone('09000000201'), '9000000201');
    assert.equal(V.normalizePhone('12345'), '');
    assert.equal(V.normalizePhone(null), '');
    assert.equal(V.normalizePhone('+91 900000020'), '', 'a short number must not become a different customer');
    assert.equal(V.normalizePhone('9190000002011'), '', 'extra digits must not be silently trimmed');
    ok('normalizePhone folds +91 / 91 / leading 0 to the 10-digit database key and rejects anything else');
}
{
    assert.equal(V.toTs(1794811740000), 1794811740000);
    assert.equal(V.toTs('2026-11-01T10:53:00.000Z'), Date.parse('2026-11-01T10:53:00.000Z'));
    assert.equal(V.toTs('1794811740000'), 1794811740000);
    assert.equal(V.toTs(null), null);
    assert.equal(V.toTs('not a date'), null);
    assert.equal(V.toTs(''), null);
    ok('toTs reads number / ISO / numeric-string timestamps and refuses garbage');
}

// -------------------------------------------------------- 2. the paid basis

{
    assert.equal(V.isPaidOrder(order({ paymentStatus: 'Paid' }), isBilledOrder), true);
    assert.equal(V.isPaidOrder(order({ status: 'Delivered', paymentStatus: 'Unpaid' }), isBilledOrder), false);
    assert.equal(V.isPaidOrder(order({ status: 'Cancelled', paymentStatus: 'Paid' }), isBilledOrder), false);
    assert.equal(V.isPaidOrder(order({ status: 'Refunded', paymentStatus: 'Paid' }), isBilledOrder), false);
    assert.equal(V.isPaidOrder(order({ status: 'Pending', paymentStatus: 'Pending' }), isBilledOrder), false);
    assert.equal(V.isPaidOrder(order({ status: 'Placed', paymentStatus: 'Pending' }), isBilledOrder), false);
    assert.equal(V.isPaidOrder(order({ status: 'Walkout', paymentStatus: 'Paid' }), isBilledOrder), false);
    assert.equal(V.isPaidOrder(order({ status: 'Served', paymentStatus: '' }), isBilledOrder), true);
    ok('isPaidOrder counts only money actually paid (walkout and unpaid excluded)');
}
{
    let threw = false;
    try { V.isPaidOrder(order(), null); } catch (_) { threw = true; }
    assert.equal(threw, true, 'isPaidOrder must refuse to run without the shared billing helper');
    ok('isPaidOrder cannot run without the shared isBilledOrder (no private copy)');
}

// ------------------------------------------------------------ 3. lifetime

{
    const l = V.computeLifetime([
        order({ total: 100 }),
        order({ total: 300, createdAt: NOW - 10 * DAY }),
        order({ status: 'Cancelled', total: 999 }),
        order({ status: 'Delivered', paymentStatus: 'Unpaid', total: 500 }),
    ], NOW, isBilledOrder);
    assert.equal(l.paidCount, 2);
    assert.equal(l.excludedCount, 2);
    assert.equal(l.totalOrders, 4);
    assert.equal(l.lifetimeSpend, 400);
    assert.equal(l.aov, 200);
    assert.equal(l.daysInactive, 1);
    ok('computeLifetime separates paid spend from excluded orders and never hides them');
}

// ------------------------------------------------------------- 4. channels

{
    const mix = V.computeChannels([
        order({ source: 'QR', type: 'Dine-in' }),
        order({ source: 'WA' }),
        order({ source: 'APP', channel: 'app' }),
        order({ source: 'POS' }),
        order({ source: 'something-else' }),
    ], isBilledOrder);
    const byKey = Object.fromEntries(mix.map((m) => [m.key, m.count]));
    assert.equal(byKey['QR menu'], 1);
    assert.equal(byKey['WhatsApp'], 1);
    assert.equal(byKey['Customer app'], 1);
    assert.equal(byKey['Counter'], 1);
    assert.equal(byKey['Other'], 1);
    ok('computeChannels classifies QR / WhatsApp / app / counter / other');
}

// ---------------------------------------------------------- 5. favourites

{
    const fav = V.computeFavourites([
        order({ orderId: 'X-1', items: [{ name: 'Margherita', qty: 2, price: 100, total: 200 }] }),
        order({ orderId: 'X-2', items: [{ name: 'Margherita', qty: 1, price: 100, total: 100 }, { name: 'Samosa', qty: 3, price: 20, total: 60 }] }),
    ], isBilledOrder);
    assert.equal(fav[0].name, 'Margherita');
    assert.equal(fav[0].qty, 3);
    assert.equal(fav[0].orders, 2);
    assert.equal(fav[1].name, 'Samosa');
    assert.equal(fav[1].qty, 3);
    ok('computeFavourites totals quantity, spend and distinct orders');
}

// ------------------------------------------------------------ 6. discounts

{
    const d = V.computeDiscounts([
        order({ total: 90, discount: 10 }),
        order({ total: 100, discount: 0 }),
    ], [{ discountId: 'd1', discountLabel: 'WELCOME10', amountGiven: 10 }], isBilledOrder);
    assert.equal(d.total, 10);
    assert.equal(d.ordersWith, 1);
    assert.equal(d.gross, 200);
    assert.equal(d.reliancePct, 5);
    assert.equal(d.byOffer[0].label, 'WELCOME10');
    ok('computeDiscounts totals the discount, the reliance % and the offer split');
}

// ------------------------------------------------------------------ 7. RFM

{
    const r0 = V.computeRfm([], NOW, isBilledOrder);
    assert.equal(r0.segment, 'new');
    ok('RFM: no paid orders -> new');
}
{
    // One order is a first impression, not a champion.
    const r1 = V.computeRfm([order({ createdAt: NOW - DAY })], NOW, isBilledOrder);
    assert.equal(r1.segment, 'promising');
    assert.notEqual(r1.segment, 'champion');
    ok('RFM: a single order never reads as Champion');
}
{
    // Weekly regular, active: 12 orders, 7 days apart, last 2 days ago.
    const champ = V.computeRfm(series(12, 7, 200, 2), NOW, isBilledOrder);
    assert.equal(champ.segment, 'champion');
    assert.equal(champ.r, 5);
    assert.equal(champ.f, 4);
    assert.equal(champ.m, 3);
    assert.equal(champ.risk, 'low');
    assert.equal(champ.baseSource, 'guest');
    ok('RFM: an active weekly regular is a Champion');
}
{
    // Same guest, last visit 120 days ago -> lapsed, not merely "at risk".
    const gone = V.computeRfm(series(12, 7, 200, 120), NOW, isBilledOrder);
    assert.equal(gone.segment, 'lapsed');
    assert.equal(gone.lapsed, true);
    assert.equal(gone.risk, 'high');
    ok('RFM: a regular who stopped 120 days ago is Lapsed');
}
{
    // A guest whose OWN rhythm is every 25+ days is not "at risk" after 20 days.
    const slow = V.computeRfm(series(6, 30, 200, 20), NOW, isBilledOrder);
    assert.ok(slow.expectedGapDays >= 20, 'expected gap is the guest own: ' + slow.expectedGapDays);
    assert.equal(slow.segment, 'loyal');
    assert.notEqual(slow.segment, 'at-risk');
    ok('RFM: the lapsing test uses the guest own visit gap, not a flat calendar rule');
}
{
    // ...and the same guest IS flagged once they pass their own gap x3.
    const slowGone = V.computeRfm(series(6, 30, 200, 95), NOW, isBilledOrder);
    assert.equal(slowGone.segment, 'lapsed');
    ok('RFM: the same slow guest is Lapsed once past 3x their own gap');
}
{
    // The restaurant's own base is the yardstick for frequency and spend.
    const base = V.computeBase([
        ...series(4, 30, 100, 2).map((o) => ({ ...o, phone: '9000000001' })),
        ...series(4, 30, 100, 2).map((o) => ({ ...o, phone: '9000000002' })),
        ...series(4, 30, 100, 2).map((o) => ({ ...o, phone: '9000000003' })),
        ...series(4, 30, 100, 2).map((o) => ({ ...o, phone: '9000000004' })),
    ], NOW, isBilledOrder);
    assert.equal(base.customers, 4);
    assert.ok(base.visitsMedian > 0 && base.spendMedian > 0, 'the base has medians');
    const r = V.computeRfm(series(12, 7, 200, 2), NOW, isBilledOrder, { base });
    assert.equal(r.baseSource, 'restaurant');
    assert.equal(r.baseCustomers, 4);
    assert.equal(r.f, 5, 'four times the median guest -> the top frequency band');
    ok('RFM: frequency and spend are scored against the outlets own customer base');
}
{
    // A brand-new guest is scored on their own history, not a full window of
    // hypothetical visits, and never as a dormant regular.
    const fresh = V.computeRfm([order({ createdAt: NOW - DAY })], NOW, isBilledOrder);
    assert.equal(fresh.segment, 'promising');
    assert.equal(fresh.actualVisits, 1);
    ok('RFM: a brand-new guest reads as promising, never dormant');
}

// --------------------------------------------------------------- 8. consent

{
    assert.equal(V.consentState({}, null, false).state, 'not-set');
    assert.equal(V.consentState({ promotionalConsent: true }, null, false).state, 'opted-in');
    assert.equal(V.consentState({ promotionalConsent: false }, { consent: { offers: true } }, false).state, 'opted-in');
    assert.equal(V.consentState({ promotionalConsent: true }, { consent: { offers: false } }, false).state, 'opted-out');
    assert.equal(V.consentState({}, { consent: { offers: false } }, false).state, 'opted-out');
    assert.equal(V.consentState({}, null, true).state, 'opted-out');
    ok('consentState mirrors the bot: the app switch wins, no signal means blocked');
}

// --------------------------------------------------------- 9. completeness

{
    const c = V.computeCompleteness({ name: 'A', address: 'B', location: { lat: 1, lng: 2 } }, { platform: 'android' }, { state: 'opted-in' });
    assert.equal(c.total, 7);
    assert.equal(c.filled, 7);
    assert.equal(c.pct, 100);
    ok('computeCompleteness scores the details on file');
}

// ------------------------------------------------------- 10. buildProfile

{
    const customer = {
        name: 'Aarav Sharma',
        registeredAt: NOW - 30 * DAY,
        address: 'Bandra West',
        location: { lat: 19.05, lng: 72.84 },
        app: { name: 'Aarav', platform: 'android', consent: { offers: true } },
        loyalty: { points: 132, lifetimePoints: 632, tier: 'bronze' },
        rewards: { r1: { label: '10% Off', cost: 500, redeemedAt: NOW - DAY } },
        notes: { n1: { text: 'Allergic to nuts', byName: 'Asha', at: NOW - DAY } },
        tags: ['VIP'],
    };
    const p = V.buildProfile({
        phone: '9000000201',
        customer,
        orders: [
            order({ orderId: 'DD-1', phone: '9000000201', createdAt: NOW - DAY }),
            order({ orderId: 'DD-2', phone: '919000000201', createdAt: NOW - 5 * DAY, total: 300 }),
            order({ orderId: 'DD-3', phone: '9000000999', createdAt: NOW - DAY }),
        ],
        ranking: { rank: 2, tier: 'bronze', lifetimePoints: 632 },
        loyaltyConfig: { tiers: { bronze: { min: 0, label: 'Bronze' }, silver: { min: 1000, label: 'Silver' }, gold: { min: 5000, label: 'Gold' } }, redeemValuePaisePerPoint: 100 },
        adjustments: [{ phone: '9000000201', delta: 50, reason: 'Good service', createdAt: NOW - DAY }],
        usageRows: [{ customerPhone: '9000000201', discountId: 'd1', discountLabel: 'WELCOME10', amountGiven: 10 }],
        chat: { name: 'Aarav', lastText: 'Thanks!', lastTs: NOW - DAY, lastDir: 'customer', unread: 2 },
        feedbacks: [{ phone: '9000000201', rating: 5, comment: 'Great', timestamp: NOW - DAY }],
        rewards: customer.rewards,
        now: NOW,
    }, calc);

    assert.equal(p.phone, '9000000201');
    assert.equal(p.name, 'Aarav Sharma');
    assert.equal(p.orders.length, 2, 'only this customer orders');
    assert.equal(p.lifetime.paidCount, 2);
    assert.equal(p.lifetime.lifetimeSpend, 500);
    assert.equal(p.loyalty.points, 132);
    assert.equal(p.loyalty.valueRs, 132);
    assert.equal(p.loyalty.nextTier.key, 'silver');
    assert.equal(p.loyalty.nextTier.needed, 368);
    assert.equal(p.loyalty.rank, 2);
    assert.equal(p.loyalty.adjustedTotal, 50);
    assert.equal(p.notes.length, 1);
    assert.deepEqual(p.tags, ['VIP']);
    assert.equal(p.consent.state, 'opted-in');
    assert.equal(p.feedbacks.length, 1);
    assert.equal(p.discounts.total, 0);
    assert.equal(p.discounts.byOffer.length, 1);
    ok('buildProfile assembles the whole 360 from the raw rows');
}
{
    let threw = false;
    try { V.buildProfile({ phone: '9000000201' }, {}); } catch (_) { threw = true; }
    assert.equal(threw, true);
    ok('buildProfile refuses to run without the shared helpers');
}

// ------------------------------------------------------------ 11. markup

{
    const customer = { name: '<img src=x onerror=alert(1)>', phone: '9000000201' };
    const p = V.buildProfile({ phone: '9000000201', customer, orders: [], now: NOW }, calc);
    const head = V.renderHead(p);
    assert.ok(head.includes('&#60;img'), 'hostile name must be escaped: ' + head.slice(0, 200));
    assert.ok(!head.includes('<img'), 'no raw tag in the header');
    const tabs = V.renderTabs('overview');
    assert.equal((tabs.match(/aria-selected="true"/g) || []).length, 1);
    assert.ok(tabs.includes('data-cp-tab="orders"'));
    for (const tab of ['overview', 'orders', 'loyalty', 'discounts', 'notes']) {
        const html = V.renderBody(p, tab);
        assert.equal(typeof html, 'string');
        assert.ok(html.length > 20, 'tab ' + tab + ' rendered something');
    }
    ok('renderHead escapes hostile names and every tab renders');
}
{
    // An order row must never leak a raw tag from the order payload.
    const p = V.buildProfile({
        phone: '9000000201',
        customer: { name: 'X' },
        orders: [order({ orderId: 'DD-1', phone: '9000000201', items: [{ name: '<b>bad</b>', qty: 1 }] })],
        now: NOW,
    }, calc);
    const html = V.renderBody(p, 'orders');
    assert.ok(!html.includes('<b>bad</b>'), 'order item names are escaped');
    assert.ok(html.includes('&#60;b&#62;'));
    ok('order rows escape item names');
}

// -------------------------------------------------------- 12. source guards

{
    const ctrl = readFileSync(CTRL_FILE, 'utf8');
    assert.ok(ctrl.includes("from '../../shared/cost-math.js'"), 'controller must use the shared billing helper');
    assert.ok(ctrl.includes("from '../../shared/loyalty-math.js'"), 'controller must use the shared loyalty helper');
    assert.ok(ctrl.includes('isBilledOrder'), 'controller wires isBilledOrder');
    assert.ok(/customers\/\$\{phone\}\/notes\/\$\{id\}/.test(ctrl), 'notes are written under customers/{phone}/notes');
    assert.ok(/customers\/\$\{phone\}`/.test(ctrl), 'tags are written under customers/{phone}');
    assert.ok(ctrl.includes('data-cp-tab'), 'controller renders the tab strip');
    assert.ok(ctrl.includes('data-cp-order'), 'controller wires the order rows');
    assert.ok(ctrl.includes('data-cp-note-form'), 'controller wires the note form');
    assert.ok(ctrl.includes('data-cp-tag-form'), 'controller wires the tag form');
    assert.ok(ctrl.includes('data-cp-note-del'), 'controller wires the note delete button');
    assert.ok(/remove\(Outlet\.ref\(`customers\/\$\{phone\}\/notes\/\$\{noteId\}`\)\)/.test(ctrl), 'a note can be deleted');
    assert.ok(ctrl.includes('computeBase'), 'the controller builds the outlets customer base');
    ok('controller uses the shared helpers and writes notes/tags under the customers node');
}
{
    // The global Escape handler must not let a HIDDEN modal swallow the key:
    // #userManualModal keeps `.modal.active` while it is display:none, and
    // that made every Escape close the invisible modal instead of the drawer.
    const main = readFileSync(join(root, 'Admin/js/main.js'), 'utf8');
    assert.ok(/getClientRects\(\)\.length > 0/.test(main), 'the Escape handler only accepts a RENDERED modal');
    assert.ok(!/const activeModal = document\.querySelector\('\.modal\.active:not\(\.hidden\)'\)/.test(main), 'the old class-only query must be gone');
    ok('the global Escape handler ignores modals that are not rendered');
}
{
    const src = readFileSync(VIEW_FILE, 'utf8');
    assert.ok(!/^\s*import\s/m.test(src), 'the view layer must stay dependency-free so node can import it');
    ok('view layer has no imports (source-tree importable)');
}
{
    const cust = readFileSync(CUST_FILE, 'utf8');
    assert.ok(cust.includes('data-cust-profile'), 'the Customers table must link to the profile');
    assert.ok(cust.includes("import('./customer-profile.js')"), 'the profile module is loaded on demand');
    assert.ok(cust.includes('normalizePhone(o.customerPhone || o.phone)'), 'the table and the profile must match orders the same way');
    ok('Customers table opens the profile and matches orders the same way');
}
{
    const html = readFileSync(HTML_FILE, 'utf8');
    for (const id of ['customerProfileRoot', 'customerProfileOverlay', 'customerProfileDrawer', 'customerProfileHead', 'customerProfileTabs', 'customerProfileBody', 'customerProfileClose']) {
        assert.ok(html.includes(`id="${id}"`), 'index.html must contain #' + id);
    }
    assert.ok(html.includes('class="drawer-content cp-drawer"'));
    ok('index.html carries the whole drawer skeleton');
}
{
    const sw = readFileSync(SW_FILE, 'utf8');
    assert.ok(/const CACHE_NAME = 'foodhubbie-erp-shell-v5\.12\.(?!68)\d+'/.test(sw), 'the shell cache must be bumped');
    assert.ok(sw.includes('./js/features/customer-profile.js'), 'SW precaches the controller');
    assert.ok(sw.includes('./js/features/customer-profile-view.js'), 'SW precaches the view layer');
    ok('service worker precaches both new modules under a bumped shell');
}
{
    // The staff notes must stay PRIVATE to the dashboard: they live under the
    // customers node (admin write) and have no shallower read grant for the
    // customer app.
    const rules = readFileSync(join(root, 'database.rules.json'), 'utf8');
    const customersIdx = rules.indexOf('"customers"');
    assert.ok(customersIdx > 0, 'the rules have a customers node');
    const notesIdx = rules.indexOf('notes');
    assert.ok(notesIdx === -1 || notesIdx > customersIdx + 400, 'no shallower public grant for customer notes');
    assert.ok(!/"pushInbox"[^}]*"read"\s*:\s*true/.test(rules), 'the push inbox is not world readable');
    ok('staff notes inherit the admin-only customers grant');
}

// ------------------------------------------------- 13. mutation self-test

if (process.argv.includes('--self-test')) {
    const dir = mkdtempSync(join(tmpdir(), 'fh-cp-'));
    const copy = join(dir, 'mutated-view.mjs');
    const original = readFileSync(VIEW_FILE, 'utf8');

    const mutations = [
        {
            name: 'paid basis accepts unpaid orders',
            from: "if (['unpaid', 'pending', 'failed', 'refunded', 'walkout'].includes(ps)) return false;",
            to: 'if (false) return false;',
            expectFail: async () => {
                const m = await import(pathToFileURL(copy).href + '?v=' + Date.now());
                assert.equal(m.isPaidOrder(order({ status: 'Delivered', paymentStatus: 'Unpaid' }), isBilledOrder), false);
            },
        },
        {
            name: 'a walkout counts as spend',
            from: "if (st === 'walkout') return false;",
            to: 'if (false) return false;',
            expectFail: async () => {
                const m = await import(pathToFileURL(copy).href + '?v=' + Date.now());
                assert.equal(m.isPaidOrder(order({ status: 'Walkout', paymentStatus: 'Paid' }), isBilledOrder), false);
            },
        },
        {
            name: 'lapsing test never fires',
            from: 'const lapsed = paid.length >= 3 && daysInactive > Math.max(expectedGapDays * 3, 60);',
            to: 'const lapsed = false;',
            expectFail: async () => {
                const m = await import(pathToFileURL(copy).href + '?v=' + Date.now());
                assert.equal(m.computeRfm(series(12, 7, 200, 120), NOW, isBilledOrder).segment, 'lapsed');
            },
        },
        {
            name: 'consent ignores the app switch',
            from: 'if (offers === false) {',
            to: 'if (false) {',
            expectFail: async () => {
                const m = await import(pathToFileURL(copy).href + '?v=' + Date.now());
                assert.equal(m.consentState({}, { consent: { offers: false } }, false).state, 'opted-out');
            },
        },
        {
            name: 'the outlet base is ignored for frequency',
            from: 'f = band(visitsPerMonth / base.visitsMedian);',
            to: 'f = bandVisits(visitsPerMonth);',
            expectFail: async () => {
                const m = await import(pathToFileURL(copy).href + '?v=' + Date.now());
                const base = m.computeBase([
                    ...series(4, 30, 100, 2).map((o) => ({ ...o, phone: '9000000001' })),
                    ...series(4, 30, 100, 2).map((o) => ({ ...o, phone: '9000000002' })),
                    ...series(4, 30, 100, 2).map((o) => ({ ...o, phone: '9000000003' })),
                    ...series(4, 30, 100, 2).map((o) => ({ ...o, phone: '9000000004' })),
                ], NOW, isBilledOrder);
                const r = m.computeRfm(series(12, 7, 200, 2), NOW, isBilledOrder, { base });
                assert.equal(r.baseSource, 'restaurant');
                assert.equal(r.f, 5);
            },
        },
    ];

    for (const mut of mutations) {
        assert.ok(original.includes(mut.from), 'mutation anchor missing: ' + mut.name);
        writeFileSync(copy, original.replace(mut.from, mut.to));
        let caught = false;
        try {
            await mut.expectFail();
        } catch (_) {
            caught = true;
        }
        assert.equal(caught, true, 'the guard did NOT catch: ' + mut.name);
        ok('mutation caught: ' + mut.name);
    }
    copyFileSync(VIEW_FILE, copy);
    console.log(`\n${n} checks passed (including the mutation self-test).`);
    process.exit(0);
}

console.log(`\n${n} checks passed.`);
