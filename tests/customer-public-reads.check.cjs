/* Guard: the ANONYMOUS customer (QR diner / webview / app before sign-in) must
 * keep read access to exactly the nodes the customer app reads, and must keep
 * it OUT of every node that carries PII, money or tenant data.
 *
 * Why this guard exists
 * ---------------------
 * On 2026-11-18 a rules change flipped `tables`, `dineinSettings`, `discounts`,
 * `settings/Store` and `settings/Delivery/slabs` from `.read: "true"` to an
 * admin-only expression (`auth != null && admins[auth.uid]...`). It was NOT
 * deployed (the live rules still answer 200 for anonymous reads — verified
 * against foodhubbie-10-default-rtdb), but the repo carried the regression and
 * a single `firebase deploy --only database` would have shipped it.
 *
 * The blast radius was silent and severe:
 *   - `tables`            → QR token lookup fails → every dine-in scan dies.
 *   - `dineinSettings`    → the read sits in a try/catch, so the app falls back
 *     to a hard-coded 5% GST. An outlet charging 18% would be UNDER-charged at
 *     the table. A money bug, not an error message.
 *   - `settings/Delivery/slabs` → delivery fee silently 0 → under-charge.
 *   - `discounts`         → coupon validation dies → promo codes stop working.
 *
 * The rule expression alone is not enough to review by eye, because an
 * "admin-only" expression and an "admin OR anonymous" expression look similar
 * in a diff. So this guard is a CONTRACT, checked from both sides:
 *   1. the rules must allow an anonymous read for every path the customer
 *      client actually reads, and
 *   2. the customer client must still read those paths (so the list cannot rot
 *      into checking nodes nobody uses), and
 *   3. the PII/money/tenant nodes must stay closed.
 *
 * It also self-tests: the same analyser is re-run against a deliberately
 * broken copy of the rules and MUST report failures — otherwise the guard
 * would pass vacuously.
 *
 * Static only — no Firebase, no network.
 * `npm run test:customer-reads`  (RULES_FILE overrides the rules under test).
 */
const fs = require('fs');
const path = require('path');

const RULES_FILE = process.env.RULES_FILE || path.join(__dirname, '..', 'database.rules.json');
const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, label) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label); }
};

/** Walk a dotted path through the rules tree and return the `.read` expression. */
function readExpr(node, dotted) {
    let cur = node;
    for (const part of dotted.split('.')) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = cur[part];
    }
    return cur && typeof cur === 'object' ? cur['.read'] : undefined;
}

/**
 * Does this expression let an ANONYMOUS caller (auth == null) read the node?
 * `auth != null && ...` does NOT. Only a bare `true`, or `true` OR'd in, does.
 */
function allowsAnonymous(expr) {
    if (expr === undefined || expr === null) return false;
    const e = String(expr).trim();
    if (e === 'true') return true;
    return /(^|\|\|)\s*true\s*(\|\||$)/.test(e);
}

const clientFile = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ---------------------------------------------------------------------------
// The contract.
// ---------------------------------------------------------------------------
const PUBLIC_PATHS = [
    {
        path: 'tables',
        usedBy: ['menu/js/session.js', /outletRef\('tables'\)/],
        why: 'QR token lookup — validateToken() reads the whole tables node',
    },
    {
        path: 'dineinSettings',
        usedBy: ['menu/js/app.js', /outletRef\('dineinSettings'\)/],
        why: 'TAX RATE — a denied read silently falls back to 5% GST (under-charge)',
    },
    {
        path: 'settings.Delivery.slabs',
        usedBy: ['menu/js/app-checkout.js', /outletRef\('settings\/Delivery\/slabs'\)/],
        why: 'DELIVERY FEE — a denied read silently falls back to ₹0 (under-charge)',
    },
    {
        path: 'settings.Store',
        usedBy: ['menu/js/app-checkout.js', /outletRef\('settings\/Store'\)/],
        why: 'store identity + brand for the customer header',
    },
    {
        path: 'settings.Store.storeName',
        usedBy: ['menu/js/app.js', /outletRef\('settings\/Store\/storeName'\)/],
        why: 'brand shown to the customer',
    },
    {
        path: 'discounts',
        usedBy: ['menu/js/discount.js', /outletRef\('discounts'\)/],
        why: 'coupon validation in checkout + the promo page',
    },
    {
        path: 'dishes',
        usedBy: ['menu/js/app.js', /outletRef\('dishes'\)/],
        why: 'the menu itself',
    },
    {
        path: 'categories',
        usedBy: ['menu/js/app.js', /outletRef\('categories'\)/],
        why: 'the menu itself',
    },
    {
        path: 'combos',
        usedBy: ['menu/js/app.js', /outletRef\('combos'\)/],
        why: 'the menu itself',
    },
];

const PRIVATE_PATHS = [
    { path: 'orders', why: 'order bodies carry name/phone/address' },
    { path: 'customers', why: 'customer profiles + device bindings' },
    { path: 'tableSessionsContact', why: 'dine-in phone numbers (PII)' },
    { path: 'chats', why: 'WhatsApp message bodies' },
    { path: 'chatMeta', why: 'WhatsApp thread metadata' },
    { path: 'settings.Security', why: 'security settings' },
];

/**
 * Analyse a rules tree.
 * @returns {{publicFails:string[], privateFails:string[], clientFails:string[]}}
 */
function analyse(root) {
    const outlet = root.businesses['$businessId'].outlets['$outletId'];
    const publicFails = [], privateFails = [], clientFails = [];

    for (const p of PUBLIC_PATHS) {
        if (!allowsAnonymous(readExpr(outlet, p.path))) {
            publicFails.push(`${p.path} is not anonymously readable (${p.why})`);
        }
        const [file, re] = p.usedBy;
        if (!re.test(clientFile(file))) {
            clientFails.push(`${p.path} is no longer read by the customer client (${file})`);
        }
    }
    for (const p of PRIVATE_PATHS) {
        if (allowsAnonymous(readExpr(outlet, p.path))) {
            privateFails.push(`${p.path} IS anonymously readable (${p.why})`);
        }
    }
    const sessions = outlet.tableSessions || {};
    if (allowsAnonymous(sessions['.read'])) {
        privateFails.push('tableSessions collection IS anonymously readable');
    }
    if (!sessions.$sessionId || sessions.$sessionId['.read'] !== 'true') {
        publicFails.push('tableSessions/$sessionId must stay public (the diner reads their own bill)');
    }
    if (allowsAnonymous(root.walletBilling && root.walletBilling['.read'])) {
        privateFails.push('walletBilling (server-only money ledger) IS anonymously readable');
    }
    if (allowsAnonymous(root.admins && root.admins['.read'])) {
        privateFails.push('admins IS anonymously readable');
    }
    if (allowsAnonymous(root.businesses && root.businesses['.read'])) {
        privateFails.push('businesses root IS anonymously readable');
    }
    return { publicFails, privateFails, clientFails };
}

// ---------------------------------------------------------------------------
// 1. The real rules.
// ---------------------------------------------------------------------------
const result = analyse(rules.rules);
console.log('\n— anonymous customer MUST be able to read —');
for (const p of PUBLIC_PATHS) {
    ok(!result.publicFails.some(f => f.startsWith(p.path + ' ')), `${p.path} is anonymously readable`);
}
for (const p of PUBLIC_PATHS) {
    ok(!result.clientFails.some(f => f.startsWith(p.path + ' ')), `${p.path} is still read by the customer client`);
}
console.log('\n— must NEVER be anonymously readable —');
for (const p of PRIVATE_PATHS) {
    ok(!result.privateFails.some(f => f.startsWith(p.path + ' ')), `${p.path} is not anonymously readable`);
}
ok(!result.privateFails.some(f => f.startsWith('tableSessions collection')), 'tableSessions collection is not anonymously readable');
ok(!result.publicFails.some(f => f.startsWith('tableSessions/$sessionId')), 'tableSessions/$sessionId stays public');
console.log('\n— platform roots —');
ok(!result.privateFails.some(f => f.startsWith('walletBilling')), 'walletBilling (server-only money ledger) is not anonymously readable');
ok(!result.privateFails.some(f => f.startsWith('admins')), 'admins is not anonymously readable');
ok(!result.privateFails.some(f => f.startsWith('businesses root')), 'businesses root is not anonymously readable');

// ---------------------------------------------------------------------------
// 2. Self-test — the analyser MUST reject the 2026-11-18 broken rules.
//    Without this the guard could pass vacuously (e.g. if the analyser threw
//    on every expression and returned false everywhere).
// ---------------------------------------------------------------------------
console.log('\n— self-test: the analyser must reject the broken rules —');
const broken = JSON.parse(JSON.stringify(rules.rules));
const brokenOutlet = broken.businesses['$businessId'].outlets['$outletId'];
const ADMIN_ONLY = "auth != null && (root.child('admins').child(auth.uid).child('outlet').val() == $outletId)";
for (const p of ['tables', 'dineinSettings', 'discounts']) brokenOutlet[p]['.read'] = ADMIN_ONLY;
brokenOutlet.settings.Delivery.slabs['.read'] = ADMIN_ONLY;
brokenOutlet.settings.Store['.read'] = ADMIN_ONLY;
const brokenResult = analyse(broken);
ok(brokenResult.publicFails.length >= 5,
    `the analyser rejects the 5 admin-only reads (found ${brokenResult.publicFails.length})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
