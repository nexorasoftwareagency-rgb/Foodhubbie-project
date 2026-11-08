// Loyalty dashboard — pure-layer checks (no browser, no Firebase).
//   node tests/loyalty-dashboard.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as V from '../Admin/js/features/loyalty-view.js';
import { computeEarnPoints, computeTenderPaise } from '../shared/loyalty-math.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const calc = { computeEarnPoints, computeTenderPaise };
let n = 0;
const ok = (name) => { n++; console.log('PASS ' + name); };

// 1 ── the example bill is the REAL earn math, not a copy of it
{
    const base = V.formFromConfig(null);
    for (const [rs, mult, bill] of [[50, 1, 500], [50, 1.25, 500], [50, 1.5, 1234.5], [12.5, 1.25, 333], [100, 1, 99], [20, 1.5, 0]]) {
        const ex = V.buildExample({ ...base, earnRs: String(rs), silverMult: String(mult) }, bill, calc);
        const want = computeEarnPoints(bill, Math.round(rs * 100), mult);
        assert.equal(ex.tiers.find(t => t.key === 'silver').points, want, `silver pts rs=${rs} m=${mult} bill=${bill}`);
    }
    const ex = V.buildExample(base, 500, calc);
    assert.deepEqual(ex.tiers.map(t => t.points), [10, 12, 15], 'defaults: ₹500 earns 10/12/15');
    assert.equal(ex.tiers[0].worthRs, 10); // 10 pts x ₹1
    assert.equal(ex.capped, false);
    ok('example bill matches shared/loyalty-math (6 cases + defaults 10/12/15)');
}

// 2 ── redemption cap + minimum spend shown in the example
{
    const base = V.formFromConfig(null);
    let ex = V.buildExample({ ...base, maxPct: '10' }, 500, calc);
    assert.equal(ex.maxPayWithPointsRs, 50); assert.equal(ex.capped, true);
    ex = V.buildExample({ ...base, minSpend: '100' }, 500, calc);
    assert.equal(ex.maxPayWithPointsRs, 400);
    ex = V.buildExample({ ...base, maxPct: '10', minSpend: '100' }, 500, calc);
    assert.equal(ex.maxPayWithPointsRs, 50, 'tighter of the two limits wins');
    assert.equal(V.buildExample({ ...base, earnRs: '' }, 500, calc).ok, false, 'blank rate -> no example, no crash');
    assert.equal(V.buildExample({ ...base, earnRs: '0' }, 500, calc).ok, false);
    ok('example shows % cap and minimum spend; bad input yields a calm empty state');
}

// 3 ── config <-> form round trip keeps every saved field (nothing silently dropped)
{
    const saved = {
        earnRatePaisePerPoint: 2500, redeemValuePaisePerPoint: 50, minSpendAfterRedemption: 80, maxRedeemPercentOfOrder: 15,
        expiryDays: 90, earnEnabled: false, dineInEarnEnabled: false, clawbackEnabled: false,
        tiers: { bronze: { min: 0, label: 'Copper', multiplier: 1 }, silver: { min: 700, label: 'Steel', multiplier: 1.2 }, gold: { min: 3000, label: 'Aurum', multiplier: 2 } },
        rewards: [{ id: 'x', label: 'X', cost: 5, type: 'item' }]
    };
    const r = V.validateForm(V.formFromConfig(saved), saved);
    assert.ok(r.ok, JSON.stringify(r.errors));
    const out = V.buildPayload(saved, r.fields);
    assert.deepEqual(out, V.cloneConfig(saved), 'unchanged form saves identical config');
    assert.equal(out.tiers.silver.label, 'Steel', 'custom tier labels survive');
    assert.deepEqual(out.rewards, saved.rewards, 'rewards untouched by a rules save');
    const d = V.cloneConfig(null);
    assert.deepEqual(V.buildPayload(d, V.validateForm(V.formFromConfig(d), d).fields), d);
    // what database.rules.json requires of loyalty/config
    assert.ok(Number.isFinite(out.earnRatePaisePerPoint) && out.earnRatePaisePerPoint >= 1);
    assert.deepEqual(Object.keys(out.tiers).sort(), ['bronze', 'gold', 'silver']);
    ok('form round-trip saves identical config; labels, rewards kept; rules-valid shape');
}

// 4 ── validation
{
    const f = V.formFromConfig(null);
    const bad = (patch) => V.validateForm({ ...f, ...patch }, null);
    const ids = (r) => r.errors.map(e => e.id);
    assert.ok(ids(bad({ earnRs: '' })).includes('loyalty-earn-rate'));
    assert.ok(ids(bad({ earnRs: '-3' })).includes('loyalty-earn-rate'));
    assert.ok(ids(bad({ redeemRs: '0' })).includes('loyalty-redeem-value'));
    assert.ok(ids(bad({ maxPct: '101' })).includes('loyalty-max-redeem-pct'));
    assert.ok(ids(bad({ minSpend: '-1' })).includes('loyalty-min-spend'));
    assert.ok(ids(bad({ expiry: '' })).includes('loyalty-expiry-days'), 'blank expiry must not silently mean "never"');
    assert.ok(ids(bad({ goldMin: '900', silverMin: '1000' })).includes('loyalty-tier-gold-min'), 'gold must start above silver');
    assert.ok(ids(bad({ silverMult: '0' })).includes('loyalty-tier-silver-mult'));
    assert.equal(bad({ earnRs: '12.5' }).fields.earnRatePaisePerPoint, 1250);
    assert.equal(bad({ maxPct: '' }).fields.maxRedeemPercentOfOrder, 0, 'blank cap = no cap');
    assert.equal(bad({ expiry: '0' }).fields.expiryDays, 0, '0 = never expires (explicit)');
    for (const e of bad({ earnRs: '' }).errors) assert.ok(e.msg.length > 10 && !/undefined|NaN/.test(e.msg));
    ok('validation: 9 bad inputs caught with plain messages; 12.5 -> 1250 paise');
}

// 5 ── stats roll-up
{
    const rows = [
        { phone: '9000000001', lifetimePoints: 6000, totalSpent: 90000, tier: 'gold' },
        { phone: '9000000002', lifetimePoints: 1200, totalSpent: 20000, tier: 'silver' },
        { phone: '9000000003', lifetimePoints: 100, totalSpent: 1500, tier: 'bronze' },
        { phone: '9000000004', lifetimePoints: 1200, totalSpent: 30000 }, // no tier -> derived from points
        null, 'junk'
    ];
    const s = V.summarize(rows, V.cloneConfig(null));
    assert.equal(s.members, 4); assert.equal(s.lifetime, 8500); assert.equal(s.spent, 141500);
    assert.deepEqual(s.counts, { bronze: 1, silver: 2, gold: 1 });
    assert.equal(s.valueRs, 8500);
    assert.deepEqual(s.top.map(r => r.phone), ['9000000001', '9000000004', '9000000002', '9000000003'], 'ties broken by spend');
    assert.equal(V.summarize([], V.cloneConfig(null)).members, 0);
    assert.equal(V.summarize(null, null).members, 0);
    assert.equal(V.summarize(Array.from({ length: 20 }, (_, i) => ({ phone: '90000000' + (10 + i), lifetimePoints: i })), null).top.length, 8);
    ok('summarize: totals, tier counts, tie-break, junk rows ignored, top 8');
}

// 6 ── next tier maths
{
    const c = V.cloneConfig(null);
    assert.deepEqual([V.nextTier(0, c).key, V.nextTier(0, c).percent, V.nextTier(0, c).remaining], ['silver', 0, 1000]);
    assert.equal(V.nextTier(500, c).percent, 50);
    assert.equal(V.nextTier(1000, c).key, 'gold');
    assert.equal(V.nextTier(5000, c), null);
    assert.equal(V.tierForPoints(999, c), 'bronze'); assert.equal(V.tierForPoints(1000, c), 'silver');
    ok('next tier: thresholds inclusive, % through the band, top tier null');
}

// 7 ── every string from the database is escaped
{
    const evil = `"><img src=x onerror=alert(1)>`;
    const c = V.cloneConfig({ ...V.cloneConfig(null), rewards: [{ id: evil, label: evil, cost: 5, type: 'item' }], tiers: undefined });
    c.tiers.silver.label = evil;
    const html = [
        V.renderRewards({ config: c, editingId: null }),
        V.renderRewards({ config: c, editingId: evil }),
        V.renderMemberSheet({
            phone: evil, app: { name: evil }, loy: { points: 5, lifetimePoints: 5, tier: evil, totalSpent: 1, orderCount: 1 },
            rank: { rank: 1 }, rewards: [{ id: 'r', label: evil, code: evil, redeemedAt: 1, status: evil }],
            orders: [{ id: evil, orderId: evil, createdAt: 1, total: 10, status: evil }]
        }, c),
        V.renderOverview({
            config: c, configured: true, loading: false,
            stats: V.summarize([{ phone: evil, lifetimePoints: 3, totalSpent: 1, tier: evil }], c),
            adjustments: [{ phone: evil, delta: 5, reason: evil, createdAt: 1 }]
        }),
        V.renderShell({ view: 'overview', earnOn: true, dirty: false, outlet: evil, body: '' }),
        V.renderNoRecord(evil),
        V.renderMembers({ prefill: evil })
    ].join('\n');
    assert.ok(!/<img\b/i.test(html), 'raw <img> reached the markup');
    assert.ok(!/"\s*onerror=/i.test(html.replace(/&quot;/g, '')) || !/ onerror=/.test(html), 'attribute break-out');
    assert.ok(!html.includes('"><img'), 'attribute break-out');
    ok('database strings (names, labels, ids, reasons, outlet) are escaped in all 7 renderers');
}

// 8 ── overview states
{
    const c = V.cloneConfig(null);
    const loading = V.renderOverview({ config: c, stats: null, loading: true });
    assert.ok(loading.includes('…') && !/NaN|undefined/.test(loading));
    const failed = V.renderOverview({ config: c, stats: null, failed: true, loading: false });
    assert.ok(failed.includes('role="alert"') && failed.includes('loyalty-refresh'));
    const empty = V.renderOverview({ config: c, stats: V.summarize([], c), loading: false, adjustments: [] });
    assert.ok(empty.includes('Nobody has earned points yet') && empty.includes('data-view="rules"'));
    const unconfigured = V.renderOverview({ config: c, stats: V.summarize([], c), configured: false });
    assert.ok(unconfigured.includes('not saved your own rules'));
    const full = V.renderOverview({ config: c, configured: true, stats: V.summarize([{ phone: '9876543210', lifetimePoints: 10, totalSpent: 500, tier: 'bronze' }], c), adjustments: [] });
    assert.ok(full.includes('98765 43210') && full.includes('No manual changes yet'));
    assert.ok(!/NaN|undefined|null/.test(full));
    ok('overview: loading, failed (retry), empty (next step), unconfigured, populated');
}

// 9 ── accessibility + structure of the shell
{
    const html = V.renderShell({ view: 'rules', earnOn: false, dirty: true, outlet: 'pizza', body: 'B' });
    assert.equal((html.match(/role="tab"/g) || []).length, 4);
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
    assert.ok(html.includes('role="tabpanel"') && html.includes('aria-labelledby="lyd-tab-rules"'));
    assert.ok(html.includes('role="switch"') && html.includes('aria-checked="false"') && html.includes('Earning is paused'));
    assert.ok(html.includes('Unsaved changes'), 'unsaved marker on the Rules tab');
    const rules = V.renderRules({ form: V.formFromConfig(null), dirty: false, billRs: '500', example: V.buildExample(V.formFromConfig(null), 500, calc) });
    for (const m of rules.matchAll(/<input[^>]*\sid="([^"]+)"/g)) {
        assert.ok(new RegExp(`for="${m[1]}"`).test(rules), `input #${m[1]} has no <label for>`);
    }
    ok('a11y: tabs/tabpanel/switch roles, unsaved marker, every rules input has a label');
}

// 10 ── controller wiring: every action the markup emits is handled; no leftovers
{
    const ctl = readFileSync(join(root, 'Admin/js/features/loyalty.js'), 'utf8');
    const view = readFileSync(join(root, 'Admin/js/features/loyalty-view.js'), 'utf8');
    const used = new Set([...view.matchAll(/data-action="(loyalty-[a-z-]+)"/g)].map(m => m[1]));
    assert.ok(used.size >= 12, 'expected the dashboard to emit its actions, got ' + used.size);
    for (const a of used) {
        if (a === 'loyalty-search-customer') { assert.ok(/data-lyd-find/.test(ctl), 'find form handled by submit'); continue; }
        assert.ok(ctl.includes(`'${a}'`), `controller does not handle ${a}`);
    }
    assert.ok(/shared\/loyalty-math\.js/.test(ctl), 'controller must use the real earn math');
    assert.ok(!/_config\.tiers\s*=\s*tiers/.test(ctl), 'must not mutate shared config on input');
    assert.ok(/from '\.\.\/firebase\.js'/.test(ctl) && !/from '\.\.\/firebase\.js'/.test(view), 'view stays Firebase-free');
    // data paths unchanged from before the redesign (rules compatibility)
    for (const p of ['loyalty/config', 'loyalty/rankings', 'loyalty/adjustments', '/loyalty`', '/rewards`', '/orders`', '/app`']) {
        assert.ok(ctl.includes(p), 'missing data path ' + p);
    }
    // a transaction transition that returns null DELETES the record (live-caught:
    // it wiped a demo customer's points when the row had no `phone` field)
    assert.ok(/const snap = await get\(rowRef\)/.test(ctl) && /const seed = snap\.exists\(\) \? snap\.val\(\) : null/.test(ctl), 'points adjustment must read the record before transacting');
    assert.ok(/const c = cur \|\| seed;/.test(ctl), 'transaction must be seeded with the real record');
    const txStart = ctl.indexOf('runTransaction(rowRef');
    assert.ok(txStart > -1, 'points adjustment uses a transaction');
    const tx = ctl.slice(txStart, txStart + 900);
    assert.ok(!/return\s+null/.test(tx), 'points transaction must never return null (that deletes the record)');
    ok(`controller handles all ${used.size} actions; same RTDB paths; view has no Firebase import`);
}

// 11 ── points outstanding (spendable balances, computed in the browser) + names
{
    const c = V.cloneConfig(null); // 1 point = 100 paise
    const t = V.tallyOutstanding([{ points: 280, lifetimePoints: 5400 }, { points: 700 }, { points: 0 }, {}, { points: -5 }, null, 'x', { points: '40' }], c, { failed: 2, total: 10, at: 123 });
    assert.equal(t.points, 1020, 'sums spendable `points`, not lifetime points; negatives and junk count as 0');
    assert.equal(t.holders, 3); assert.equal(t.counted, 6); assert.equal(t.valueRs, 1020);
    assert.deepEqual([t.failed, t.total, t.at], [2, 10, 123]);
    assert.equal(V.tallyOutstanding([{ points: 10 }], { ...c, redeemValuePaisePerPoint: 50 }).valueRs, 5, 'worth follows the saved point value');
    assert.equal(V.tallyOutstanding(null, c).points, 0);
    assert.equal(V.pickName('', '  ', 'Anita Rao', 'x'), 'Anita Rao'); assert.equal(V.pickName(null, undefined, 5), '');
    assert.equal(V.pickName('A'.repeat(100)).length, 40, 'long names are cut');
    const base = { config: c, configured: true, stats: V.summarize([{ phone: '9876543210', lifetimePoints: 10, totalSpent: 5, tier: 'bronze' }, { phone: '9811122233', lifetimePoints: 5, totalSpent: 5, tier: 'bronze' }], c), adjustments: [] };
    const idle = V.renderOverview({ ...base, outstandingState: 'idle', outstanding: null, names: { '9876543210': 'Anita Rao' } });
    assert.ok(idle.includes('Count now') && idle.includes('data-action="loyalty-update-outstanding"') && !/<button[^>]*lyd-update[^>]*disabled/.test(idle));
    assert.ok(idle.includes('Anita Rao') && idle.includes('98765 43210'), 'name with phone beneath');
    assert.ok(idle.includes('98111 22233') && !idle.includes('undefined'), 'unnamed member falls back to the phone');
    const counting = V.renderOverview({ ...base, outstandingState: 'counting', progress: { done: 3, total: 9 } });
    assert.ok(counting.includes('Counting 3 of 9 members') && /lyd-update[^>]*disabled/.test(counting), 'button locked while counting');
    const done = V.renderOverview({ ...base, outstandingState: 'idle', outstanding: { ...t, valueRs: 1020 } });
    assert.ok(done.includes('1,020') && done.includes('worth ₹1,020') && done.includes('3 members hold') && done.includes('>Update<'));
    assert.ok(done.includes('2 could not be read, so this may be low'), 'partial counts are labelled');
    const none = V.renderOverview({ ...base, stats: V.summarize([], c), outstandingState: 'idle', outstanding: null });
    assert.ok(/lyd-update[^>]*disabled/.test(none), 'Update is disabled when there are no members to count');
    const evil = V.renderOverview({ ...base, names: { '9876543210': '"><img src=x onerror=1>' } });
    assert.ok(!/<img\b/i.test(evil), 'names are escaped');
    ok('points outstanding: sums spendable points, junk-proof, value follows point price; names escaped; button states');
}

// 12 ── program health + quick picks (plain-language guidance for the owner)
{
    const good = V.cloneConfig({ ...V.cloneConfig(null), maxRedeemPercentOfOrder: 10 });
    const h = V.healthChecks({ config: good, configured: true, stats: V.summarize([{ phone: '9876543210', lifetimePoints: 1, totalSpent: 1, tier: 'bronze' }], good) });
    assert.ok(h.every(i => i.level === 'ok'), 'a sensible saved setup has nothing flagged: ' + JSON.stringify(h.filter(i => i.level !== 'ok')));
    assert.ok(h.find(i => i.id === 'rewards').detail.includes('Free Samosa') && h.find(i => i.id === 'rewards').detail.includes('₹10,000'), 'cheapest reward in rupees of spending (200 pts x ₹50)');
    const bad = V.healthChecks({ config: V.cloneConfig({ ...V.cloneConfig(null), earnEnabled: false, expiryDays: 0, maxRedeemPercentOfOrder: 0, rewards: [] }), configured: false, stats: V.summarize([], good) });
    const att = Object.fromEntries(bad.filter(i => i.level === 'attention').map(i => [i.id, i]));
    assert.deepEqual(Object.keys(att).sort(), ['cap', 'earning', 'expiry', 'members', 'rewards', 'saved']);
    assert.equal(att.earning.action, 'loyalty-toggle-earning'); assert.equal(att.rewards.view, 'rewards'); assert.equal(att.expiry.view, 'rules');
    assert.ok(Object.values(att).every(i => !/NaN|undefined/.test(i.title + i.detail)));
    assert.ok(bad.every(i => typeof i.title === 'string' && i.title.length > 3 && typeof i.detail === 'string'));
    const html = V.renderHealth(bad);
    assert.ok(html.includes('6 things are worth a look') && html.includes('Needs a look: ') && html.includes('data-action="loyalty-toggle-earning"'));
    assert.ok(V.renderHealth(h).includes('Everything looks sensible'));
    assert.ok(V.renderOverview({ config: good, configured: true, stats: V.summarize([{ phone: '9876543210', lifetimePoints: 1, totalSpent: 1, tier: 'bronze' }], good), adjustments: [] }).includes('Program health'));
    // quick picks
    assert.equal(V.earnForBackPct(2, 1), 50); assert.equal(V.earnForBackPct(4, 1), 25); assert.equal(V.earnForBackPct(1, 0.5), 50); assert.equal(V.earnForBackPct(3, 1), 33.33);
    assert.equal(V.earnForBackPct(0, 1), null); assert.equal(V.earnForBackPct(2, ''), null);
    const f = V.formFromConfig(null);
    assert.equal(V.backPct(f), 2); assert.equal(V.backPct({ ...f, earnRs: '' }), null);
    const q = V.renderQuickPicks(f);
    assert.ok(q.includes('aria-pressed="true"') && (q.match(/aria-pressed="true"/g) || []).length === 1, 'exactly the matching chip is pressed');
    assert.ok(/data-pct="2"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-pct="2"/.test(q) || q.indexOf('2% back') > 0);
    assert.ok(q.includes('about 2% back'));
    assert.ok(V.renderQuickPicks({ ...f, redeemRs: '' }).includes('disabled'), 'no chips without a point value');
    // the stylesheet must keep glass, a no-blur fallback, reduced motion and the 44px mobile rules
    assert.ok(/backdrop-filter:var\(--g-blur\)/.test(V.LOYALTY_CSS) && /@supports not/.test(V.LOYALTY_CSS) && /prefers-reduced-motion/.test(V.LOYALTY_CSS));
    assert.ok(/overflow:clip/.test(V.LOYALTY_CSS), 'overflow:clip so the sticky receipt keeps working');
    ok('health checks (ok / 6 attention / actions), cheapest-reward maths, quick picks, glass + fallback CSS present');
}

console.log(`\nloyalty-dashboard OK (${n} checks)`);
