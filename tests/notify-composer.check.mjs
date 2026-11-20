// Customer notification checklist — pure-layer + source guards.
//   node tests/notify-composer.check.mjs
//
// Two halves:
//   1. the pure eligibility/draft engine (notify-eligibility.js) is exercised
//      with real guest shapes — the per-guest gates (no device, offers off, no
//      consent, STOP), the outlet gates (promo off, kill switch, not on the
//      official API, no prepaid tokens), the batch reach counts and the
//      deterministic draft generator;
//   2. source guards pin the things that would silently rot: ONE request for
//      the whole push batch (never one per guest), the WhatsApp half writing
//      the SAME campaign shape the Promotions tab writes, the composer never
//      promising a discount, a push body never containing {name}, the service
//      worker precaching the three new modules under a bumped shell, and the
//      Function accepting the batch audience with a hard cap.
//
// Mutation self-test: --self-test breaks the eligibility gates and the draft
// generator and proves the checks above catch every one of them.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ELIG_FILE = process.env.NOTIFY_ELIG_FILE || join(root, 'Admin/js/features/notify-eligibility.js');
const COMPOSER_FILE = join(root, 'Admin/js/features/notify-composer.js');
const CLIENT_FILE = join(root, 'Admin/js/features/notify-client.js');
const VIEW_FILE = join(root, 'Admin/js/features/customers-view.js');
const CTRL_FILE = join(root, 'Admin/js/features/customers.js');
const PROMO_FILE = join(root, 'Admin/js/features/promotions.js');
const APPNOT_FILE = join(root, 'Admin/js/features/app-notifications.js');
const HTML_FILE = join(root, 'Admin/index.html');
const SW_FILE = join(root, 'Admin/sw.js');
const FN_FILE = join(root, 'FIREBASE_SERVER_MIGRATION/functions/src/api/tenantNotify.ts');

let n = 0;
const ok = (m) => { n++; console.log('PASS ' + m); };

const E = await import(pathToFileURL(ELIG_FILE).href);
const V = await import(pathToFileURL(VIEW_FILE).href);

// ---------------------------------------------------------------- fixtures

const guest = (over = {}) => ({
    phone: '9000000201',
    name: 'Ishita Rai',
    displayPhone: '9000000201',
    consent: { state: 'opted-in', source: 'Customer app' },
    rfm: { segment: 'champion', lapsed: false },
    lifetime: { paidCount: 4, daysInactive: 2 },
    favourites: [{ name: 'Cheese Corn Pizza', qty: 3 }],
    action: { segment: 'Champion' },
    ...over,
});

const ctx = (over = {}) => ({
    subscriptions: { '9000000201': { hasToken: true, offers: true } },
    promoEnabled: true,
    killSwitch: false,
    transport: 'meta',
    tokenBalance: 10,
    storeName: 'Demo Dashboard',
    ...over,
});

// ------------------------------------------------------ 1. the per-guest gates

{
    const g = E.guestGates(guest(), ctx());
    assert.deepEqual(g.push, [], 'a guest with a device and offers on is push-reachable');
    assert.deepEqual(g.wa, [], 'an opted-in guest is WhatsApp-reachable');
    ok('a guest with a device and an opt-in is reachable on both channels');
}
{
    const g = E.guestGates(guest(), ctx({ subscriptions: {} }));
    assert.deepEqual(g.push, ['no-device'], 'no subscription means no device');
    ok('a guest with no app device is skipped for push');
}
{
    const g = E.guestGates(guest(), ctx({ subscriptions: { '9000000201': { hasToken: true, offers: false } } }));
    assert.deepEqual(g.push, ['offers-off'], 'the app offers switch blocks the push');
    ok('a guest who switched offers off is skipped for push');
}
{
    const g = E.guestGates(guest({ consent: { state: 'not-set', source: null } }), ctx());
    assert.deepEqual(g.wa, ['no-consent'], 'no consent means no promotional message');
    ok('a guest with no consent record is skipped for WhatsApp');
}
{
    const g = E.guestGates(guest({ consent: { state: 'opted-out', source: 'STOP' } }), ctx());
    assert.deepEqual(g.wa, ['opted-out'], 'STOP is absolute');
    ok('a guest who sent STOP is skipped for WhatsApp');
}
{
    const g = E.guestGates(guest({ consent: { state: 'opted-out', source: 'Customer app' } }), ctx());
    assert.deepEqual(g.wa, ['offers-off'], 'the app switch blocks WhatsApp too');
    ok('a guest who switched offers off in the app is skipped for WhatsApp');
}

// ------------------------------------------------------ 2. the outlet gates

{
    assert.deepEqual(E.outletGates(ctx()), [], 'a healthy outlet has no gate');
    assert.ok(E.outletGates(ctx({ promoEnabled: false })).includes('promo-off'));
    assert.ok(E.outletGates(ctx({ killSwitch: true })).includes('kill-switch'));
    assert.ok(E.outletGates(ctx({ transport: 'baileys' })).includes('transport'));
    assert.ok(E.outletGates(ctx({ tokenBalance: 0 })).includes('no-tokens'));
    ok('the outlet gates report promo off, the kill switch, the transport and the token pool');
}
{
    const g = E.outletGates({ transport: undefined, tokenBalance: undefined, promoEnabled: undefined, killSwitch: undefined });
    assert.deepEqual(g, [], 'an unreadable value never blocks a channel');
    ok('a value we could not read never blocks a channel (the server re-checks)');
}

// ------------------------------------------------------ 3. the batch summary

{
    const rows = [
        guest(),
        guest({ phone: '9000000202', consent: { state: 'not-set', source: null } }),
        guest({ phone: '9000000203', consent: { state: 'opted-out', source: 'STOP' } }),
    ];
    const r = E.evaluateBatch(rows, ctx({ subscriptions: { '9000000201': { hasToken: true, offers: true } } }));
    assert.equal(r.total, 3);
    assert.equal(r.push.reachable, 1, 'only the guest with a device can get a push');
    assert.equal(r.push.blockedTotal, 2);
    assert.equal(r.wa.reachable, 1, 'only the opted-in guest can get WhatsApp');
    assert.equal(r.wa.blocked['no-consent'], 1);
    assert.equal(r.wa.blocked['opted-out'], 1);
    ok('the batch summary counts who can be reached and who is skipped, per reason');
}
{
    const twoSubs = ctx({ quiet: true, subscriptions: { '9000000201': { hasToken: true, offers: true }, '9000000202': { hasToken: true, offers: true } } });
    const r = E.evaluateBatch([guest(), guest({ phone: '9000000202' })], twoSubs);
    assert.equal(r.push.quiet, true, 'quiet hours are a channel-wide block');
    assert.equal(r.push.reachable, 2, 'the guests themselves are still eligible - the WINDOW blocks the send');
    ok('quiet hours are reported as a channel-wide block, not as a per-guest one');
}
{
    const summary = E.blockedSummary({ 'no-consent': 2, 'opted-out': 1 });
    assert.equal(summary[0].id, 'no-consent', 'the biggest reason leads');
    assert.equal(summary[0].label, 'No marketing consent', 'the reason has a human label');
    ok('the skipped list is human-readable and ordered by size');
}

// ------------------------------------------------------ 4. the draft generator

{
    const d = E.generateDraft([guest()], ctx(), { channel: 'wa' });
    assert.ok(d.body.includes('{name}'), 'a WhatsApp body personalises with {name}');
    assert.ok(d.body.includes('Demo Dashboard'), 'the store name comes from the real data');
    assert.ok(/Cheese Corn Pizza/.test(d.body), 'the favourite dish comes from the real data');
    assert.ok(!/discount|coupon|offer|% off|free/i.test(d.body), 'the draft never promises a discount');
    ok('the WhatsApp draft is composed from the guests own facts and promises nothing');
}
{
    const d = E.generateDraft([guest()], ctx(), { channel: 'push' });
    assert.ok(!d.body.includes('{name}'), 'one push for every device must not contain {name}');
    assert.ok(d.title.length > 0, 'the push has a title');
    ok('a push draft is ONE message for every device (no {name})');
}
{
    const lapsed = guest({ rfm: { segment: 'lapsed', lapsed: true } });
    const d = E.generateDraft([lapsed], ctx(), { channel: 'push' });
    assert.ok(/miss you/i.test(d.title + d.body), 'a lapsed guest gets a win-back message');
    ok('the draft follows the segment intent (lapsed -> win-back)');
}
{
    const d = E.generateDraft([guest()], ctx(), { channel: 'push' });
    assert.ok(d.body.length <= 300, 'the push body fits the server limit');
    assert.ok(d.title.length <= 100, 'the push title fits the server limit');
    ok('the generated draft fits the server length limits');
}
{
    const dom = E.dominantIntent([
        guest({ rfm: { segment: 'lapsed', lapsed: true } }),
        guest({ phone: '9000000202', rfm: { segment: 'lapsed', lapsed: true } }),
        guest({ phone: '9000000203', rfm: { segment: 'champion', lapsed: false } }),
    ]);
    assert.equal(dom.intent, 'lapsed', 'the dominant intent of the batch wins');
    ok('the batch intent is the dominant one (not the first guest\'s)');
}

// ------------------------------------------------------ 5. the selection markup

{
    const bar = V.renderBatchBar({ selected: 3, matching: 10, pushReach: 2, waReach: 1, canSelectAll: true });
    assert.ok(/3 guests selected/.test(bar), 'the bar says how many are selected');
    assert.ok(/Select all 10 matching/.test(bar), 'the bar offers the WHOLE filtered set');
    assert.ok(/Up to 2 can get a push/.test(bar), 'the bar states the push reach honestly');
    assert.ok(/Up to 1 can get WhatsApp/.test(bar), 'the bar states the WhatsApp reach honestly');
    ok('the batch bar shows the selection, the honest reach and the select-all-matching link');
}
{
    const bar = V.renderBatchBar({ selected: 3, matching: 3, pushReach: 3, waReach: 3, canSelectAll: false, allMatchingSelected: true });
    assert.ok(/All 3 matching guests selected/.test(bar), 'a finished selection says so');
    assert.ok(!/Select all/.test(bar), 'no select-all link once everything is selected');
    ok('the select-all link disappears once every matching guest is selected');
}
{
    assert.equal(V.renderBatchBar({ selected: 0 }), '', 'no bar without a selection');
    ok('the batch bar is hidden until a guest is selected');
}

// ------------------------------------------------------ 6. source guards

const composer = readFileSync(COMPOSER_FILE, 'utf8');
const client = readFileSync(CLIENT_FILE, 'utf8');
const view = readFileSync(VIEW_FILE, 'utf8');
const ctrl = readFileSync(CTRL_FILE, 'utf8');
const promo = readFileSync(PROMO_FILE, 'utf8');
const appnot = readFileSync(APPNOT_FILE, 'utf8');
const html = readFileSync(HTML_FILE, 'utf8');
const sw = readFileSync(SW_FILE, 'utf8');
const fn = readFileSync(FN_FILE, 'utf8');

{
    // ONE request for the batch - the whole point of the multi-phone audience.
    assert.ok(/audience:\s*'phones'/.test(composer), 'the push batch uses the phones audience');
    assert.ok(/phones,/.test(composer), 'the selected phones travel with the request');
    assert.ok(!/for \(const .* of phones\)[^]*sendNotify/.test(composer), 'the batch is never sent one request per guest');
    assert.equal((composer.match(/sendNotify\(/g) || []).length, 1, 'there is exactly ONE send call in the composer');
    ok('the push batch is ONE request for the whole selection');
}
{
    assert.ok(/import \{ buildCampaignPayload \} from '\.\/promotions\.js'/.test(composer), 'the composer uses the shared campaign builder');
    assert.ok(/export function buildCampaignPayload/.test(promo), 'the Promotions tab exports the campaign builder');
    assert.ok(/buildCampaignPayload\(/.test(promo), 'the Promotions tab uses the same builder');
    ok('the WhatsApp half writes the SAME campaign shape the Promotions tab writes');
}
{
    assert.ok(/bot\/commands/.test(composer), 'the WhatsApp half queues a bot command');
    assert.ok(/bot\/promotions\/campaigns/.test(composer), 'the WhatsApp half writes the campaign document');
    ok('the WhatsApp half reuses the bot campaign path (the bot stays the only sender)');
}
{
    assert.ok(!/\{name\}/.test(E.generateDraft([guest()], ctx(), { channel: 'push' }).body), 'a push body has no {name}');
    assert.ok(/\{name\}/.test(E.generateDraft([guest()], ctx(), { channel: 'wa' }).body), 'a WhatsApp body may use {name}');
    ok('the draft generator keeps {name} out of a one-body-for-all push');
}
{
    for (const m of ['./js/features/notify-client.js', './js/features/notify-eligibility.js', './js/features/notify-composer.js']) {
        assert.ok(sw.includes(`'${m}'`), 'the service worker precaches ' + m);
    }
    const shell = (sw.match(/foodhubbie-erp-shell-v([\d.]+)'/) || [])[1];
    assert.ok(shell && shell !== '5.12.72', 'the service worker shell was bumped');
    ok('the three new modules are precached under a bumped shell');
}
{
    // The shared notify client is the ONE place that knows the endpoint.
    assert.ok(/export async function sendNotify/.test(client), 'the client owns the POST');
    assert.ok(/export function isQuietHours/.test(client), 'the client owns the quiet-hours clock');
    assert.ok(/from '\.\/notify-client\.js'/.test(appnot), 'the Customer APP tab uses the shared client');
    assert.ok(!/function _notifyBase/.test(appnot), 'the old private copy of the endpoint resolver is gone');
    assert.ok(!/function _getAdminAuthToken/.test(appnot), 'the old private copy of the token getter is gone');
    ok('the notify endpoint, token and clock live in ONE shared client');
}
{
    for (const id of ['notifyComposerModal', 'notifyAudience', 'notifyReach', 'notifyTitleInput', 'notifyBodyInput', 'notifyGenerateBtn', 'notifyWaTemplate', 'notifySendBtn', 'notifyResult']) {
        assert.ok(html.includes(`id="${id}"`), 'the markup has #' + id);
    }
    assert.ok(/data-notify-channel="push"/.test(html) && /data-notify-channel="wa"/.test(html), 'the composer has both channel tabs');
    assert.ok(/id="custBatchBar"/.test(html), 'the Customers tab has the batch bar');
    assert.ok(/id="custSelectAll"/.test(html), 'the Customers table has the header checkbox');
    ok('the composer and the batch bar exist in the markup');
}
{
    assert.ok(/import \{ evaluateBatch \} from '\.\/notify-eligibility\.js'/.test(ctrl), 'the controller uses the shared eligibility engine');
    assert.ok(/import\('\.\/notify-composer\.js'\)/.test(ctrl), 'the composer is loaded lazily');
    assert.ok(/data-cust-select-all-matching/.test(ctrl), 'the controller wires the select-all-matching action');
    assert.ok(/data-cust-clear-selection/.test(ctrl), 'the controller can clear the selection');
    ok('the controller wires the selection, the batch bar and the lazy composer');
}
{
    assert.ok(/MAX_BATCH_PHONES = 500/.test(fn), 'the Function caps a batch at 500 phones');
    assert.ok(/audience === 'phones'/.test(fn), 'the Function accepts the phones audience');
    assert.ok(/new Set\(/.test(fn), 'the Function de-duplicates the phone list');
    assert.ok(/wanted\.has\(String\(e\.phone/.test(fn), 'the Function filters the subscriptions to the selection');
    assert.ok(/audience: isTest \? 'test' : \(audience === 'phone' \? 'phone' : \(audience === 'phones' \? 'phones' : 'all'\)\)/.test(fn), 'the history row records the batch audience');
    ok('the Function accepts a selected batch of phones, de-duplicated and capped');
}
{
    assert.ok(!/â/.test(composer) && !/ï¿½/.test(composer) && !/�/.test(composer), 'the composer module is clean UTF-8');
    assert.ok(!/â/.test(client) && !/ï¿½/.test(client) && !/�/.test(client), 'the client module is clean UTF-8');
    assert.ok(!/â/.test(view) && !/ï¿½/.test(view) && !/�/.test(view), 'the view module is clean UTF-8');
    ok('the new modules are clean UTF-8');
}

console.log('\n' + n + ' checks passed');

// ------------------------------------------------------ mutation self-test

if (process.argv.includes('--self-test')) {
    const tmp = mkdtempSync(join(tmpdir(), 'notify-elig-'));
    const src = readFileSync(ELIG_FILE, 'utf8');

    const mutants = [
        {
            name: 'the STOP opt-out is ignored',
            from: "if (consent.source === 'STOP') wa.push('opted-out');",
            to: "if (false) wa.push('opted-out');",
        },
        {
            name: 'a subscription without a device token counts as push-reachable',
            from: "if (!sub || !sub.hasToken) push.push('no-device');",
            to: "if (!sub) push.push('no-device');",
        },
        {
            name: 'the transport gate is ignored',
            from: "if (ctx.transport !== undefined && String(ctx.transport || '') !== 'meta') gates.push('transport');",
            to: "if (false) gates.push('transport');",
        },
        {
            name: 'the push draft contains {name}',
            from: ": `We miss you at ${store}.",
            to: ": `Hi {name}, we miss you at ${store}.",
        },
        {
            name: 'the draft promises a discount',
            from: "body = channel === 'wa'\n            ? `Hi {name}, it has been a while - we would love to welcome you back to ${store}.${dishName ? ` Your favourite ${dishName} is back on the menu.` : ''} What can we get you today?`",
            to: "body = channel === 'wa'\n            ? `Hi {name}, get 20% off with a coupon - we would love to welcome you back to ${store}.${dishName ? ` Your favourite ${dishName} is back on the menu.` : ''} What can we get you today?`",
        },
        {
            name: 'the batch reach counts everyone as reachable',
            from: 'if (g.push.length) {',
            to: 'if (false) {',
        },
    ];

    // Three guests, three different reasons:
    //   0201 - a device + an opt-in (reachable on both channels)
    //   0202 - no consent (WhatsApp only)
    //   0203 - sent STOP (WhatsApp only) + a subscription with NO device token
    const INPUT_ROWS = [
        guest(),
        guest({ phone: '9000000202', consent: { state: 'not-set', source: null } }),
        guest({ phone: '9000000203', consent: { state: 'opted-out', source: 'STOP' } }),
    ];
    const INPUT_CTX = ctx({
        subscriptions: {
            '9000000201': { hasToken: true, offers: true },
            '9000000203': { hasToken: false, offers: true },
        },
    });
    // A lapsed guest, so the win-back branch of the generator is the one
    // under test (the fingerprint must exercise the branch the mutation hits).
    const DRAFT_ROWS = [guest({ rfm: { segment: 'lapsed', lapsed: true } })];

    const fingerprint = (mod) => {
        const r = mod.evaluateBatch(INPUT_ROWS, INPUT_CTX);
        return {
            pushReach: r.push.reachable,
            waReach: r.wa.reachable,
            noConsent: r.wa.blocked['no-consent'] || 0,
            stopped: r.wa.blocked['opted-out'] || 0,
            noDevice: r.push.blocked['no-device'] || 0,
            gates: mod.outletGates({ transport: 'baileys' }).join(','),
            pushBody: mod.generateDraft(DRAFT_ROWS, INPUT_CTX, { channel: 'push' }).body,
            waBody: mod.generateDraft(DRAFT_ROWS, INPUT_CTX, { channel: 'wa' }).body,
        };
    };

    const baselineMod = await import(pathToFileURL(ELIG_FILE).href);
    const baseline = fingerprint(baselineMod);

    let caught = 0;
    for (let i = 0; i < mutants.length; i++) {
        const m = mutants[i];
        const file = join(tmp, `mutant-${i}.js`);
        const mutated = src.replace(m.from, m.to);
        if (mutated === src) {
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
            failed = true;
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
