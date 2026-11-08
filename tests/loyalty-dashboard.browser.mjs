// Loyalty dashboard in a real headless Chromium: the real Admin stylesheets and the real
// loyalty.js / loyalty-view.js, with Firebase replaced by an in-memory stub.
// Not a substitute for a real-device test against a real database.
// Run: NODE_PATH=$(npm root -g) node tests/loyalty-dashboard.browser.mjs [screenshotDir]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import assert from 'assert/strict';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shotDir = process.argv[2] || '';
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpeg': 'image/jpeg' };

// ---- stub modules the loyalty feature imports -------------------------------
const FIREBASE_STUB = `
const DB = window.__DB;
const parts = (p) => String(p).split('/').filter(Boolean);
const readAt = (p) => parts(p).reduce((o, k) => (o == null ? undefined : o[k]), DB);
const writeAt = (p, v) => { const ks = parts(p); let o = DB; ks.slice(0, -1).forEach(k => { o[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {}; o = o[k]; }); o[ks[ks.length - 1]] = v; };
const snap = (v) => ({ exists: () => v !== undefined && v !== null, val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) });
export const auth = { currentUser: { uid: 'admin-uid' } };
export const Outlet = { current: 'pizza', ref: (p) => ({ path: 'businesses/b/outlets/pizza/' + p }) };
export const BUSINESS_ID = () => 'b';
export const query = (r) => r;
export const orderByChild = () => null;
export const limitToLast = () => null;
export async function get(r) {
  window.__reads.push(r.path);
  if (window.__delayMs) await new Promise(res => setTimeout(res, window.__delayMs));
  if (window.__failRead && r.path.includes(window.__failRead)) throw new Error('boom');
  return snap(readAt(r.path));
}
export async function set(r, v) {
  window.__writes.push({ path: r.path, value: JSON.parse(JSON.stringify(v)) });
  if (window.__failWrite) throw new Error('write failed');
  writeAt(r.path, JSON.parse(JSON.stringify(v)));
}
export async function runTransaction(r, fn) {
  const cur = readAt(r.path);
  const next = fn(cur === undefined ? null : JSON.parse(JSON.stringify(cur)));
  if (next === undefined || next === null) return { committed: false, snapshot: snap(cur) };
  writeAt(r.path, next);
  return { committed: true, snapshot: snap(next) };
}
`;
const UTILS_STUB = `
export const showToast = (m, t) => { window.__toasts.push({ m, t }); };
export const showConfirm = async (m, title) => { window.__confirms.push({ m, title }); return window.__confirmAnswer !== false; };
`;
const LOGGER_STUB = `export const logger = { info(){}, warn(){}, error(){}, debug(){} };`;

const OVERRIDE = {
    '/Admin/js/firebase.js': FIREBASE_STUB,
    '/Admin/js/utils.js': UTILS_STUB,
    '/Admin/js/utils/logger.js': LOGGER_STUB
};
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/Admin/style.css"><link rel="stylesheet" href="/Admin/mobile-overrides.css"></head>
<body style="background:#f1f5f9"><div id="tab-loyalty" class="tab-content" style="display:block"><div id="loyaltyApp"></div></div>
<script type="module">import { loadLoyalty } from '/Admin/js/features/loyalty.js'; window.__load = loadLoyalty;</script></body></html>`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let pth = decodeURIComponent(url.pathname);
    if (pth === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
    if (pth === '/Admin/shared/loyalty-math.js') pth = '/shared/loyalty-math.js'; // Admin build copies shared/ into dist/shared
    if (OVERRIDE[pth]) { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(OVERRIDE[pth]); }
    const p = path.join(root, pth);
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const seed = () => {
    const O = 'businesses/b/outlets/pizza';
    const db = {};
    const put = (p, v) => { const ks = p.split('/'); let o = db; ks.slice(0, -1).forEach(k => { o[k] = o[k] || {}; o = o[k]; }); o[ks.at(-1)] = v; };
    put(`${O}/loyalty/config`, {
        earnRatePaisePerPoint: 5000, redeemValuePaisePerPoint: 100, minSpendAfterRedemption: 0, maxRedeemPercentOfOrder: 10,
        expiryDays: 180, earnEnabled: true, dineInEarnEnabled: true, clawbackEnabled: true,
        tiers: { bronze: { min: 0, label: 'Bronze', multiplier: 1 }, silver: { min: 1000, label: 'Silver', multiplier: 1.25 }, gold: { min: 5000, label: 'Gold', multiplier: 1.5 } },
        rewards: [{ id: 'free-samosa', label: 'Free Samosa', cost: 200, type: 'item' }, { id: '10pct-off', label: '10% Off Next Order', cost: 500, type: 'discount' }]
    });
    const ranks = [
        ['9876543210', 5400, 108000, 'gold', 1], ['9811122233', 2150, 43000, 'silver', 2], ['9822233344', 1320, 26400, 'silver', 3],
        ['9833344455', 640, 12800, 'bronze', 4], ['9844455566', 380, 7600, 'bronze', 5], ['9855566677', 90, 1800, 'bronze', 6]
    ];
    for (const [ph, lp, sp, tier, rank] of ranks) put(`${O}/loyalty/rankings/${ph}`, { phone: ph, outlet: 'pizza', business: 'b', lifetimePoints: lp, totalSpent: sp, tier, rank, updatedAt: 1 });
    put(`${O}/loyalty/adjustments/1730000000000_9811122233`, { phone: '9811122233', delta: 50, pointsAfter: 700, reason: 'Goodwill after a late delivery', createdBy: 'admin-uid', createdAt: 1730000000000 });
    put(`${O}/loyalty/adjustments/1730100000000_9876543210`, { phone: '9876543210', delta: -30, pointsAfter: 250, reason: 'Corrected a double credit', createdBy: 'admin-uid', createdAt: 1730100000000 });
    put(`${O}/customers/9876543210/loyalty`, { phone: '9876543210', points: 280, lifetimePoints: 5400, pointsSpent: 200, totalSpent: 108000, orderCount: 36, tier: 'gold', updatedAt: 1 });
    put(`${O}/customers/9876543210/app`, { name: 'Anita Rao', phone: '9876543210' });
    put(`${O}/customers/9876543210/rewards/r1`, { label: 'Free Samosa', code: 'SAM-4821', redeemedAt: 1730200000000, status: 'used' });
    put(`${O}/customers/9876543210/orders/o1`, { orderId: 'FH-1042', createdAt: 1730300000000, total: 640, status: 'Delivered' });
    put(`${O}/customers/9876543210/orders/o2`, { orderId: 'FH-1031', createdAt: 1730000000000, total: 420, status: 'Delivered' });
    put(`${O}/customers/9811122233/loyalty`, { phone: '9811122233', points: 700, lifetimePoints: 2150, totalSpent: 43000, orderCount: 14, tier: 'silver', updatedAt: 1 });
    put(`${O}/customers/9811122233/name`, 'Vikram Shah'); // WhatsApp-side name (no app profile)
    put(`${O}/customers/9822233344/loyalty`, { phone: '9822233344', points: 150, lifetimePoints: 1320, tier: 'silver' });
    put(`${O}/customers/9833344455/loyalty`, { phone: '9833344455', points: 0, lifetimePoints: 640, tier: 'bronze' });
    put(`${O}/customers/9844455566/loyalty`, { phone: '9844455566', points: 60, lifetimePoints: 380, tier: 'bronze' });
    // 9855566677 has a ranking row but no loyalty row: counts as 0
    return db;
};

const browser = await chromium.launch();
let failures = 0;
async function scenario(name, viewport, fn, dbOverride) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|\[Loyalty\] (save|reward save) failed/.test(m.text())) errors.push('console: ' + m.text()); });
    const db = dbOverride ? dbOverride(seed()) : seed();
    await page.addInitScript((d) => { window.__failRead = d.__failRead || null; delete d.__failRead; window.__DB = d; window.__reads = []; window.__writes = []; window.__toasts = []; window.__confirms = []; }, db);
    await page.goto(base + '/page');
    await page.waitForFunction(() => window.__load);
    try {
        await page.evaluate(() => window.__load());
        await page.waitForSelector('.lyd-tabs');
        await fn(page);
        assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
        console.log('PASS ' + name);
    } catch (e) {
        failures++;
        console.log('FAIL ' + name + '\n   ' + String(e.message).split('\n').slice(0, 6).join('\n   '));
        if (shotDir) await page.screenshot({ path: path.join(shotDir, 'FAIL-' + name.replace(/\W+/g, '-') + '.png') }).catch(() => {});
    }
    await ctx.close();
}
const DESKTOP = { width: 1280, height: 900 }, MOBILE = { width: 390, height: 844 };
const shot = async (page, name, full = true) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: full }); };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const O = 'businesses/b/outlets/pizza';

await scenario('overview shows real numbers, tier split and top members (desktop)', DESKTOP, async (page) => {
    await page.waitForFunction(() => /6/.test(document.querySelector('.lyd-fig-num')?.textContent || ''));
    const figs = await page.$$eval('.lyd-fig', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
    assert.match(figs[0], /^6 Members/); assert.match(figs[1], /^9,980 Points handed out/);
    assert.match(figs[2], /^— Points members can spend now\. Press Update to count them\. Count now/, 'outstanding is not guessed: it waits for Update'); assert.match(figs[3], /^₹1,99,600 /);
    const tierLabel = await page.$eval('.lyd-tierbar', e => e.getAttribute('aria-label'));
    assert.equal(tierLabel, 'Bronze 3, Silver 2, Gold 1');
    assert.equal(await page.$$eval('.lyd-top li', l => l.length), 6);
    assert.match(await page.$eval('.lyd-top li:first-child', e => e.innerText.replace(/\s+/g, ' ')), /1 Anita Rao 98765 43210 Gold 5,400 points ₹1,08,000 spent/);
    const adj = await page.$$eval('.lyd-adjs li', l => l.map(e => e.innerText.replace(/\s+/g, ' ')));
    assert.match(adj[0], /^−30 points (Anita Rao|98765 43210) Corrected a double credit/, 'newest manual change first');
    assert.equal(await overflow(page), 0);
    await shot(page, '1-overview-desktop');
});

await scenario('overview on a phone: no sideways scroll in any view', MOBILE, async (page) => {
    await page.waitForFunction(() => /6/.test(document.querySelector('.lyd-fig-num')?.textContent || ''));
    await shot(page, '2-overview-mobile');
    const sw = await page.$eval('#lyd-earn-switch', e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    assert.deepEqual(sw, [44, 26], 'switch keeps its shape despite the global mobile button rules');
    for (const v of ['overview', 'members', 'rewards', 'rules']) {
        const r = await page.$eval(`#lyd-tab-${v}`, e => { const b = e.getBoundingClientRect(); return b.right <= window.innerWidth && b.left >= 0; });
        assert.ok(r, `${v} tab is clipped at 390px`);
        await page.click(`#lyd-tab-${v}`);
        assert.equal(await overflow(page), 0, `${v} overflows horizontally at 390px`);
    }
    await page.click('#lyd-tab-rules'); await shot(page, '3-rules-mobile');
    await page.click('#lyd-tab-rewards'); await shot(page, '4-rewards-mobile');
});

await scenario('rules: live example, unsaved marker, draft survives tab switch, discard, save', DESKTOP, async (page) => {
    await page.click('#lyd-tab-rules');
    const bill = () => page.$eval('#lyd-bill', e => e.innerText.replace(/\s+/g, ' '));
    assert.match(await bill(), /Bronze member earns 10 points.*Silver member earns 12 points.*Gold member earns 15 points/);
    assert.match(await bill(), /At most ₹50 of this bill can be paid with points/);
    assert.match(await page.$eval('#lyd-savebar-msg', e => e.textContent), /All changes saved/);
    await page.fill('#loyalty-earn-rate', '25');
    assert.match(await bill(), /Bronze member earns 20 points.*Silver member earns 25 points.*Gold member earns 30 points/, 'example follows the form');
    assert.match(await page.$eval('#lyd-savebar-msg', e => e.textContent), /unsaved/);
    assert.equal(await page.$$eval('#lyd-tab-rules .lyd-unsaved-dot', e => e.length), 1);
    await page.fill('#lyd-bill-amount', '1000');
    assert.match(await bill(), /Bill ₹1,000.*earns 40 points/);
    await page.click('#lyd-tab-rewards'); await page.click('#lyd-tab-rules');
    assert.equal(await page.inputValue('#loyalty-earn-rate'), '25', 'draft survived switching tabs');
    assert.equal(await page.$$eval('#lyd-tab-rules .lyd-unsaved-dot', e => e.length), 1);
    await page.click('#lyd-discard');
    assert.equal(await page.inputValue('#loyalty-earn-rate'), '50');
    assert.equal(await page.$$eval('.lyd-unsaved-dot', e => e.length), 0);
    await page.fill('#loyalty-earn-rate', '25'); await page.fill('#loyalty-max-redeem-pct', '0');
    assert.match(await bill(), /The whole bill can be paid with points/);
    await shot(page, '5-rules-desktop');
    await page.click('#lyd-save');
    await page.waitForFunction(() => window.__writes.length === 1);
    const w = await page.evaluate(() => window.__writes[0]);
    assert.equal(w.path, `${O}/loyalty/config`);
    assert.equal(w.value.earnRatePaisePerPoint, 2500); assert.equal(w.value.maxRedeemPercentOfOrder, 0);
    assert.equal(w.value.tiers.gold.multiplier, 1.5); assert.equal(w.value.rewards.length, 2, 'rewards untouched by a rules save');
    assert.equal(w.value.expiryDays, 180);
    assert.ok((await page.evaluate(() => window.__toasts)).some(t => t.m === 'Rules saved' && t.t === 'success'));
    assert.match(await page.$eval('#lyd-savebar-msg', e => e.textContent), /All changes saved/);
    assert.equal(await page.inputValue('#loyalty-earn-rate'), '25');
});

await scenario('rules: bad input is explained and nothing is written', DESKTOP, async (page) => {
    await page.click('#lyd-tab-rules');
    await page.fill('#loyalty-expiry-days', '');
    await page.click('#lyd-save');
    const t = await page.evaluate(() => ({ toasts: window.__toasts, writes: window.__writes }));
    assert.equal(t.writes.length, 0);
    assert.match(t.toasts[0].m, /Enter a number of days/); assert.equal(t.toasts[0].t, 'error');
    assert.equal(await page.getAttribute('#loyalty-expiry-days', 'aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'loyalty-expiry-days');
    await page.fill('#loyalty-expiry-days', '90');
    assert.equal(await page.getAttribute('#loyalty-expiry-days', 'aria-invalid'), null, 'error clears on edit');
    await page.fill('#loyalty-tier-gold-min', '900');
    await page.click('#lyd-save');
    assert.match((await page.evaluate(() => window.__toasts)).at(-1).m, /Gold must start at more points than Silver/);
});

await scenario('rules: a failed save keeps the draft and says so', DESKTOP, async (page) => {
    await page.click('#lyd-tab-rules');
    await page.fill('#loyalty-earn-rate', '40');
    await page.evaluate(() => { window.__failWrite = true; });
    await page.click('#lyd-save');
    await page.waitForFunction(() => window.__toasts.length > 0);
    assert.match((await page.evaluate(() => window.__toasts))[0].m, /Could not save the rules/);
    assert.equal(await page.inputValue('#loyalty-earn-rate'), '40', 'typed value kept');
    assert.equal(await page.isEnabled('#lyd-save'), true);
    assert.equal(await page.evaluate(() => window.__DB.businesses.b.outlets.pizza.loyalty.config.earnRatePaisePerPoint), 5000, 'saved config unchanged');
});

await scenario('earning switch: confirm, save, header and state change', DESKTOP, async (page) => {
    assert.equal(await page.getAttribute('#lyd-earn-switch', 'aria-checked'), 'true');
    await page.evaluate(() => { window.__confirmAnswer = false; });
    await page.click('#lyd-earn-switch');
    assert.equal(await page.evaluate(() => window.__writes.length), 0, 'declined confirm writes nothing');
    await page.evaluate(() => { window.__confirmAnswer = true; });
    await page.click('#lyd-earn-switch');
    await page.waitForFunction(() => document.getElementById('lyd-earn-state')?.textContent === 'Earning is paused');
    const w = await page.evaluate(() => window.__writes[0].value);
    assert.equal(w.earnEnabled, false); assert.equal(w.earnRatePaisePerPoint, 5000);
    assert.equal(await page.getAttribute('#lyd-earn-switch', 'aria-checked'), 'false');
    await page.click('#lyd-earn-switch'); // turning back on needs no confirm
    await page.waitForFunction(() => document.getElementById('lyd-earn-state')?.textContent === 'Earning is on');
    assert.equal(await page.evaluate(() => window.__confirms.length), 2, 'only the pause asked for confirmation (once declined, once accepted)');
});

await scenario('members: open from the leaderboard, read the sheet, adjust points', DESKTOP, async (page) => {
    await page.waitForSelector('.lyd-top li');
    await page.click('.lyd-top li:first-child .lyd-link');
    await page.waitForSelector('.lyd-member');
    assert.equal(await page.getAttribute('#lyd-tab-members', 'aria-selected'), 'true');
    const txt = await page.$eval('.lyd-member', e => e.innerText.replace(/\s+/g, ' '));
    assert.match(txt, /Anita Rao/); assert.match(txt, /98765 43210/); assert.match(txt, /Gold/);
    assert.match(txt, /280 points to spend, worth ₹280/); assert.match(txt, /Top tier reached/);
    assert.match(txt, /Free Samosa Code SAM-4821/); assert.match(txt, /FH-1042/);
    assert.ok(txt.indexOf('FH-1042') < txt.indexOf('FH-1031'), 'newest order first');
    await shot(page, '6-member-desktop');
    await page.fill('#loyalty-adj-delta', '-500');
    assert.match(await page.$eval('#lyd-adj-preview', e => e.textContent), /from 280 to 0/, 'preview floors at zero');
    await page.fill('#loyalty-adj-delta', '25');
    assert.match(await page.$eval('#lyd-adj-preview', e => e.textContent), /from 280 to 305/);
    await page.click('[data-action="loyalty-adjust-points"]');
    assert.match((await page.evaluate(() => window.__toasts)).at(-1).m, /short reason/);
    assert.equal(await page.getAttribute('#loyalty-adj-reason', 'aria-invalid'), 'true');
    await page.fill('#loyalty-adj-reason', 'Goodwill for a cold order');
    await page.click('[data-action="loyalty-adjust-points"]');
    await page.waitForFunction(() => document.getElementById('lyd-balance')?.textContent === '305');
    const after = await page.evaluate((O) => ({ loy: window.__DB.businesses.b.outlets.pizza.customers['9876543210'].loyalty, adj: Object.values(window.__DB.businesses.b.outlets.pizza.loyalty.adjustments).filter(a => a.reason.startsWith('Goodwill for')) }), O);
    assert.equal(after.loy.points, 305); assert.equal(after.loy.lifetimePoints, 5400, 'lifetime points untouched'); assert.equal(after.loy.tier, 'gold');
    assert.equal(after.adj.length, 1); assert.equal(after.adj[0].delta, 25); assert.equal(after.adj[0].pointsAfter, 305);
});

await scenario('members: typed lookup, unknown number, bad number', MOBILE, async (page) => {
    await page.click('#lyd-tab-members');
    await page.fill('#loyalty-lookup-phone', '12345');
    await page.press('#loyalty-lookup-phone', 'Enter');
    assert.match(await page.$eval('#loyalty-customer-result', e => e.textContent), /10-digit mobile number/);
    assert.equal(await page.getAttribute('#loyalty-lookup-phone', 'aria-invalid'), 'true');
    await page.fill('#loyalty-lookup-phone', '98765 00000');
    await page.press('#loyalty-lookup-phone', 'Enter');
    await page.waitForSelector('.lyd-empty');
    assert.match(await page.$eval('#loyalty-customer-result', e => e.textContent), /98765 00000 has no points yet/);
    await page.fill('#loyalty-lookup-phone', '9811122233');
    await page.click('#loyalty-search-customer');
    await page.waitForSelector('.lyd-member');
    assert.match(await page.$eval('.lyd-member', e => e.innerText.replace(/\s+/g, ' ')), /No name on file.*Silver.*700 points to spend.*2,850 more points to reach Gold/);
    assert.equal(await overflow(page), 0);
    await shot(page, '7-member-mobile');
});

await scenario('rewards: add, edit, delete, duplicate and invalid input', DESKTOP, async (page) => {
    await page.click('#lyd-tab-rewards');
    assert.equal(await page.$$eval('.lyd-reward', l => l.length), 2);
    assert.match(await page.$eval('.lyd-reward:first-child', e => e.innerText.replace(/\s+/g, ' ')), /Free Samosa Free item 200 points ₹200 of points/);
    await page.click('[data-action="loyalty-add-reward"]');
    assert.match((await page.evaluate(() => window.__toasts)).at(-1).m, /reward name and a cost/);
    await page.fill('#loyalty-new-label', 'Garlic Bread'); await page.fill('#loyalty-new-cost', '350');
    await page.click('[data-action="loyalty-add-reward"]');
    await page.waitForFunction(() => document.querySelectorAll('.lyd-reward').length === 3);
    assert.equal((await page.evaluate(() => window.__writes.at(-1).value.rewards.at(-1))).id, 'garlic-bread');
    await page.fill('#loyalty-new-label', 'garlic bread'); await page.fill('#loyalty-new-cost', '10');
    await page.click('[data-action="loyalty-add-reward"]');
    assert.match((await page.evaluate(() => window.__toasts)).at(-1).m, /already exists/);
    await page.click('[data-reward="free-samosa"] [data-action="loyalty-edit-reward"]');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lyd-edit-label', 'edit focuses the name field');
    await page.fill('#lyd-edit-cost', '250'); await page.selectOption('#lyd-edit-type', 'discount');
    await shot(page, '8-rewards-edit-desktop');
    await page.click('[data-action="loyalty-save-reward"]');
    await page.waitForFunction(() => !document.querySelector('.lyd-reward.is-editing'));
    const r = await page.evaluate(() => window.__writes.at(-1).value.rewards.find(x => x.id === 'free-samosa'));
    assert.deepEqual(r, { id: 'free-samosa', label: 'Free Samosa', cost: 250, type: 'discount' });
    await page.click('[data-reward="garlic-bread"] [data-action="loyalty-delete-reward"]');
    await page.waitForFunction(() => document.querySelectorAll('.lyd-reward').length === 2);
    assert.equal((await page.evaluate(() => window.__writes.at(-1).value.rewards)).some(x => x.id === 'garlic-bread'), false);
});

await scenario('rewards: a failed save changes nothing on screen or in memory', DESKTOP, async (page) => {
    await page.click('#lyd-tab-rewards');
    await page.evaluate(() => { window.__failWrite = true; });
    await page.fill('#loyalty-new-label', 'Cold Coffee'); await page.fill('#loyalty-new-cost', '300');
    await page.click('[data-action="loyalty-add-reward"]');
    await page.waitForFunction(() => window.__toasts.length > 0);
    assert.equal(await page.$$eval('.lyd-reward', l => l.length), 2, 'list not changed by a failed save');
    await page.evaluate(() => { window.__failWrite = false; });
    await page.click('#lyd-tab-overview'); await page.click('#lyd-tab-rewards');
    assert.equal(await page.$$eval('.lyd-reward', l => l.length), 2, 'in-memory config not polluted by the failed save');
});

await scenario('keyboard: arrow keys move between tabs; roving tabindex', DESKTOP, async (page) => {
    await page.focus('#lyd-tab-overview');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lyd-tab-members');
    assert.equal(await page.getAttribute('#lyd-tab-members', 'aria-selected'), 'true');
    assert.equal(await page.getAttribute('#lyd-tab-overview', 'tabindex'), '-1');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lyd-tab-rules');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lyd-tab-overview', 'wraps around');
});

await scenario('overview: empty program points to the rules', DESKTOP, async (page) => {
    await page.waitForSelector('.lyd-empty');
    assert.match(await page.$eval('.lyd-empty', e => e.innerText), /Nobody has earned points yet/);
    assert.equal(await page.isDisabled('#lyd-update-outstanding'), true, 'nothing to count yet');
    await page.click('.lyd-empty [data-action="loyalty-view"]');
    assert.equal(await page.getAttribute('#lyd-tab-rules', 'aria-selected'), 'true');
    await shot(page, '9-overview-empty');
}, (db) => { delete db.businesses.b.outlets.pizza.loyalty.rankings; delete db.businesses.b.outlets.pizza.loyalty.adjustments; return db; });

await scenario('overview: a failed read says so and can be retried', DESKTOP, async (page) => {
    await page.waitForSelector('.lyd-empty[role="alert"]');
    assert.match(await page.$eval('.lyd-empty', e => e.innerText), /Could not load member numbers/);
    await page.evaluate(() => { window.__failRead = null; });
    await page.click('[data-action="loyalty-refresh"]');
    await page.waitForSelector('.lyd-top');
}, (db) => { db.__failRead = 'loyalty/rankings'; return db; });

await scenario('first-time outlet (never saved) shows the standard rules notice', DESKTOP, async (page) => {
    await page.waitForFunction(() => /not saved your own rules/.test(document.querySelector('.lyd-note')?.textContent || ''));
    await page.click('#lyd-tab-rules');
    assert.equal(await page.inputValue('#loyalty-earn-rate'), '50');
    assert.equal(await page.inputValue('#loyalty-expiry-days'), '180');
}, (db) => { delete db.businesses.b.outlets.pizza.loyalty.config; return db; });

await scenario('names: app name, then WhatsApp name, else the phone number', DESKTOP, async (page) => {
    await page.waitForFunction(() => /Anita Rao/.test(document.querySelector('.lyd-top')?.innerText || ''));
    const rows = await page.$$eval('.lyd-top li', l => l.map(e => e.innerText.replace(/\s+/g, ' ')));
    assert.match(rows[0], /Anita Rao 98765 43210 Gold/, 'app profile name, phone beneath');
    assert.match(rows[1], /Vikram Shah 98111 22233 Silver/, 'falls back to the WhatsApp-side name');
    assert.match(rows[2], /^3 98222 33344 Silver/, 'no name anywhere: phone only, no "undefined"');
    assert.ok(!(await page.$eval('.lyd', e => e.innerText)).includes('undefined'));
    assert.match(await page.$eval('.lyd-adjs li:first-child', e => e.innerText.replace(/\s+/g, ' ')), /Anita Rao/, 'names on recent changes too');
    await page.click('.lyd-top li:nth-child(2) .lyd-link');
    await page.waitForSelector('.lyd-member');
    assert.match(await page.$eval('.lyd-member-name', e => e.textContent), /No name on file|Vikram/);
    await shot(page, '10-overview-names-desktop');
});

await scenario('points outstanding: Update counts balances in the browser, writes nothing, handles failures', DESKTOP, async (page) => {
    await page.waitForSelector('#lyd-update-outstanding:not([disabled])');
    assert.equal(await page.textContent('#lyd-outstanding-num'), '\u2014');
    assert.equal((await page.textContent('#lyd-update-outstanding')).trim(), 'Count now');
    await page.evaluate(() => { window.__reads.length = 0; });
    await page.click('#lyd-update-outstanding');
    await page.waitForFunction(() => document.getElementById('lyd-outstanding-num')?.textContent === '1,190');
    const cap = await page.textContent('#lyd-outstanding-cap');
    assert.match(cap, /worth ₹1,190/); assert.match(cap, /4 members hold/);
    assert.equal((await page.textContent('#lyd-update-outstanding')).trim(), 'Update');
    const info = await page.evaluate(() => ({ reads: window.__reads.filter(r => r.endsWith('/loyalty') && r.includes('/customers/')).length, writes: window.__writes.length, toasts: window.__toasts }));
    assert.equal(info.reads, 6, 'one small read per member, nothing bulk');
    assert.equal(info.writes, 0, 'counting never writes to the database');
    assert.ok(info.toasts.some(t => t.m === 'Points outstanding updated'));
    assert.match(await page.$eval('.lyd-fig-when', e => e.textContent), /^Counted /);
    await shot(page, '11-outstanding-desktop');
    // a balance changes -> Update picks it up
    await page.evaluate(() => { window.__DB.businesses.b.outlets.pizza.customers['9833344455'].loyalty.points = 100; });
    await page.click('#lyd-update-outstanding');
    await page.waitForFunction(() => document.getElementById('lyd-outstanding-num')?.textContent === '1,290');
    // one member's read fails -> counted, labelled as possibly low, error toast
    await page.evaluate(() => { window.__failRead = 'customers/9822233344/loyalty'; });
    await page.click('#lyd-update-outstanding');
    await page.waitForFunction(() => document.getElementById('lyd-outstanding-num')?.textContent === '1,140');
    assert.match(await page.$eval('.lyd-fig-when', e => e.textContent), /1 could not be read, so this may be low/);
    assert.match((await page.evaluate(() => window.__toasts)).at(-1).m, /Counted 5 of 6 members\. 1 could not be read/);
    // the saved point value drives the rupee figure: 1 point = ₹0.50
    await page.evaluate(() => { window.__failRead = null; window.__DB.businesses.b.outlets.pizza.loyalty.config.redeemValuePaisePerPoint = 50; });
    await page.evaluate(() => window.__load());
    await page.waitForSelector('#lyd-update-outstanding:not([disabled])');
    await page.click('#lyd-update-outstanding');
    await page.waitForFunction(() => document.getElementById('lyd-outstanding-num')?.textContent === '1,290');
    assert.match(await page.textContent('#lyd-outstanding-cap'), /worth ₹645/);
});

await scenario('points outstanding: shows live progress and ignores a second tap while counting', DESKTOP, async (page) => {
    await page.waitForSelector('#lyd-update-outstanding:not([disabled])');
    await page.evaluate(() => { window.__delayMs = 120; });
    await page.click('#lyd-update-outstanding');
    await page.waitForFunction(() => /Counting/.test(document.getElementById('lyd-update-outstanding')?.textContent || ''));
    assert.equal(await page.isDisabled('#lyd-update-outstanding'), true, 'locked while counting');
    assert.match(await page.textContent('#lyd-outstanding-cap'), /Counting \d+ of 6 members/);
    await page.waitForFunction(() => document.getElementById('lyd-outstanding-num')?.textContent === '1,190');
    const reads = await page.evaluate(() => window.__reads.filter(r => r.includes('/customers/') && r.endsWith('/loyalty')).length);
    assert.equal(reads, 6, 'counted once');
});

await scenario('mobile: names, outstanding and touch sizes at 390, 360 and 320 wide', MOBILE, async (page) => {
    await page.waitForFunction(() => /Anita Rao/.test(document.querySelector('.lyd-top')?.innerText || ''));
    for (const w of [390, 360, 320]) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.waitForSelector('#lyd-update-outstanding:not([disabled])');
        assert.equal(await overflow(page), 0, `overview overflows at ${w}px`);
    }
    await page.click('#lyd-update-outstanding');
    await page.waitForFunction(() => document.getElementById('lyd-outstanding-num')?.textContent === '1,190');
    await page.setViewportSize({ width: 320, height: 800 });
    for (const v of ['overview', 'members', 'rewards', 'rules']) {
        await page.click(`#lyd-tab-${v}`);
        assert.equal(await overflow(page), 0, `${v} overflows at 320px after counting`);
        const clipped = await page.$$eval('.lyd-tab', ts => ts.filter(t => { const r = t.getBoundingClientRect(); return r.right > window.innerWidth + 1; }).length);
        assert.equal(clipped, 0, `a tab is clipped at 320px (${v})`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#lyd-tab-overview');
    const small = await page.$$eval('.lyd button, .lyd input, .lyd select', els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 43.5) && !e.matches('input[type=checkbox]') && !e.matches('.lyd-switch'); }).map(e => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().height)));
    assert.deepEqual(small, [], 'tap targets under 44px: ' + small.join(', '));
    await page.click('#lyd-tab-members');
    await page.focus('#loyalty-lookup-phone');
    const fs = await page.$eval('#loyalty-lookup-phone', e => getComputedStyle(e).fontSize);
    assert.equal(fs, '16px', 'focused inputs are 16px (Admin global rule) so iOS does not zoom');
    await page.click('#lyd-tab-overview');
    const lefts = await page.$$eval('.lyd-top li .lyd-who-name, .lyd-top li .lyd-who:not(:has(.lyd-who-name))', els => els.map(e => Math.round(e.getBoundingClientRect().left)));
    assert.ok(lefts.length >= 3 && new Set(lefts).size === 1, 'member names line up on the left edge, got ' + lefts.join(','));
    await page.waitForTimeout(450);
    await shot(page, '12-overview-mobile-final');
});

await scenario('glass look: frosted panels, backdrop, readable text, receipt stays sticky', DESKTOP, async (page) => {
    await page.waitForSelector('.lyd-health');
    const g = await page.evaluate(() => {
        const cs = (sel) => getComputedStyle(document.querySelector(sel));
        const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const out = { blur: cs('.lyd-block').backdropFilter || cs('.lyd-block').webkitBackdropFilter, orbs: document.querySelectorAll('.lyd-orbs i').length, stage: cs('.lyd').overflow };
        // worst case: text on a glass panel over the BRIGHTEST orb colour behind it (panel alpha .58 over #ffb48a)
        const panel = cs('.lyd-block').backgroundColor.match(/[\d.]+/g).map(Number); const a = panel[3];
        const mix = (bg) => `rgb(${bg.map((c, i) => Math.round(c * (1 - a) + 255 * a)).join(',')})`;
        const worst = mix([255, 180, 138]);
        out.inkOnWorst = ratio(cs('.lyd-h').color, worst); out.subOnWorst = ratio(cs('.lyd-sub').color, worst);
        return out;
    });
    assert.notEqual(g.blur, 'none', 'backdrop-filter is applied to panels'); assert.match(g.blur, /blur\(/);
    assert.equal(g.orbs, 3);
    assert.ok(g.inkOnWorst >= 7, 'headings stay readable on the glass over the brightest colour: ' + g.inkOnWorst.toFixed(1));
    assert.ok(g.subOnWorst >= 4.5, 'grey helper text meets 4.5:1 on the glass over the brightest colour: ' + g.subOnWorst.toFixed(1));
    await shot(page, '13-glass-overview-desktop');
    // The real Admin scrolls inside <main class="main"> (overflow-y:auto in a full-height flex shell), not the window.
    // Rebuild that shell around the dashboard so position:sticky is tested where it really runs.
    await page.evaluate(() => {
        const shell = document.createElement('div'); shell.style.cssText = 'display:flex;height:100vh;overflow:hidden';
        const main = document.createElement('main'); main.className = 'main'; shell.appendChild(main);
        document.body.appendChild(shell); main.appendChild(document.getElementById('tab-loyalty')); document.body.style.overflow = 'hidden';
    });
    await page.click('#lyd-tab-rules');
    await page.waitForTimeout(350); // let the tab fade-in finish
    await page.evaluate(() => { document.querySelector('main.main').scrollTop = 420; });
    await page.waitForTimeout(150);
    const info = await page.evaluate(() => ({ scrolled: document.querySelector('main.main').scrollTop, top: document.querySelector('.lyd-bill').getBoundingClientRect().top, bar: document.getElementById('lyd-savebar').getBoundingClientRect().bottom, vh: innerHeight }));
    assert.ok(info.scrolled > 100, 'the real scroller scrolled: ' + info.scrolled);
    assert.ok(info.top >= 0 && info.top < 40, 'receipt stays pinned near the top while scrolling, top=' + info.top);
    assert.ok(info.bar <= info.vh && info.bar > info.vh - 80, 'save bar stays pinned to the bottom of the screen, bottom=' + info.bar + ' of ' + info.vh);
});

await scenario('program health: plain checks with buttons that take you to the fix', DESKTOP, async (page) => {
    await page.waitForSelector('.lyd-health');
    const t = await page.$eval('.lyd-health', e => e.innerText.replace(/\s+/g, ' '));
    assert.match(t, /Everything looks sensible/); assert.match(t, /Earning is on/); assert.match(t, /2 rewards on offer/); assert.match(t, /Points expire/); assert.match(t, /At most 10% of one bill/);
    assert.equal(await page.$$eval('.lyd-health-act', b => b.length), 0, 'nothing to fix, no buttons');
}, undefined);

await scenario('program health: flagged items offer a fix and the fix works', DESKTOP, async (page) => {
    await page.waitForSelector('.lyd-health');
    const t = await page.$eval('.lyd-health', e => e.innerText.replace(/\s+/g, ' '));
    assert.match(t, /4 things are worth a look/); assert.match(t, /Earning is paused/); assert.match(t, /No rewards to spend points on/); assert.match(t, /Points never expire/); assert.match(t, /Points can pay a whole bill/);
    await shot(page, '14-health-attention-desktop');
    // jump to the fix
    await page.click('.lyd-health-row:has-text("No rewards") .lyd-health-act');
    assert.equal(await page.getAttribute('#lyd-tab-rewards', 'aria-selected'), 'true');
    await page.click('#lyd-tab-overview');
    await page.click('.lyd-health-row:has-text("never expire") .lyd-health-act');
    assert.equal(await page.getAttribute('#lyd-tab-rules', 'aria-selected'), 'true');
    await page.click('#lyd-tab-overview');
    // turn earning back on straight from the health row
    await page.click('.lyd-health-row:has-text("Earning is paused") .lyd-health-act');
    await page.waitForFunction(() => document.getElementById('lyd-earn-state')?.textContent === 'Earning is on');
    assert.equal(await page.evaluate(() => window.__writes.at(-1).value.earnEnabled), true);
}, (db) => { const c = db.businesses.b.outlets.pizza.loyalty.config; c.earnEnabled = false; c.expiryDays = 0; c.maxRedeemPercentOfOrder = 0; c.rewards = []; return db; });

await scenario('quick picks: one tap sets the earn rate, updates the example and unsaved state', DESKTOP, async (page) => {
    await page.click('#lyd-tab-rules');
    const pressed = () => page.$$eval('.lyd-chip[aria-pressed="true"]', c => c.map(e => e.textContent.trim()));
    assert.deepEqual(await pressed(), ['2% back'], 'matches the current rate (\u20b950 per point, \u20b91 per point)');
    assert.match(await page.textContent('#lyd-back-note'), /about 2% back/);
    await page.click('.lyd-chip[data-pct="4"]');
    assert.equal(await page.inputValue('#loyalty-earn-rate'), '25');
    assert.deepEqual(await pressed(), ['4% back']);
    assert.match(await page.textContent('#lyd-back-note'), /about 4% back/);
    assert.match(await page.$eval('#lyd-bill', e => e.innerText.replace(/\s+/g, ' ')), /Bronze member earns 20 points/);
    assert.match(await page.$eval('#lyd-savebar-msg', e => e.textContent), /unsaved/);
    assert.equal(await page.evaluate(() => window.__writes.length), 0, 'a quick pick only edits the draft; nothing is saved');
    await page.fill('#loyalty-redeem-value', '0.75');
    assert.deepEqual(await pressed(), [], '\u20b925 per point at \u20b90.75 a point is 3% back, which matches no chip');
    await page.click('.lyd-chip[data-pct="2"]');
    assert.equal(await page.inputValue('#loyalty-earn-rate'), '37.5', '2% back at \u20b90.75 per point = \u20b937.5 per point');
    await page.fill('#loyalty-redeem-value', '');
    assert.equal(await page.$$eval('.lyd-chip:disabled', c => c.length), 3, 'chips disabled without a point value');
    await shot(page, '15-quick-picks-desktop');
});

await browser.close();
server.close();
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nloyalty-dashboard browser ALL PASSED');
