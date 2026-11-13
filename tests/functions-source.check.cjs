#!/usr/bin/env node
/**
 * Guard: the Functions deploy source must be the code that is actually live.
 *
 *   node tests/functions-source.check.cjs
 *
 * Background (batch 23a): `firebase.json` used `"functions": { "code": "functions" }`.
 * `code` is not a recognised key (the key is `source`), so the CLI silently fell
 * back to the `functions/` directory - a stale plain-JS tree that contains ONE
 * function (`processDishImage`, never deployed). A `firebase deploy --only
 * functions` from the repo root would therefore have DELETED all 11 live
 * functions. The real source is `FIREBASE_SERVER_MIGRATION/functions` (TS,
 * nodejs22), which is what is deployed today.
 *
 * Static checks only - no network, no credentials.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (detail ? ' :: ' + detail : '')); }
};
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const firebaseJson = JSON.parse(read('firebase.json'));
const fnCfg = firebaseJson.functions || {};
const source = String(fnCfg.source || '').replace(/\\/g, '/');

ok(!!fnCfg.source, 'firebase.json functions.source is set (the key the CLI reads)', JSON.stringify(Object.keys(fnCfg)));
ok(!('code' in fnCfg), 'the dead "code" key is gone (it was silently ignored)');
ok(source === 'FIREBASE_SERVER_MIGRATION/functions', 'deploy source is the tree the 11 live functions come from', source);

const pkgPath = path.join(ROOT, source, 'package.json');
ok(fs.existsSync(pkgPath), 'source dir has a package.json', source);
const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
ok(!!(pkg.dependencies && pkg.dependencies['firebase-functions']), 'source depends on firebase-functions', JSON.stringify(pkg.dependencies || {}));
ok(!(pkg.dependencies && pkg.dependencies.sharp), 'source has no sharp (that belongs to the abandoned functions/ tree)');
ok(String((pkg.engines && pkg.engines.node) || '') === '22', 'runs on Node 22 (deployed runtime)', String(pkg.engines && pkg.engines.node));


// The legacy plain-JS tree must exist but must NOT be the deploy source.
const legacy = path.join(ROOT, 'functions', 'index.js');
ok(fs.existsSync(legacy), 'legacy functions/ tree still present (left in place, not deployed)');

// Batch 23a export + wiring.
const entry = read(path.join(source, 'src', 'index.ts'));
ok(/export\s*\{\s*platformHealth\s*\}/.test(entry), 'index.ts exports platformHealth');

const health = read(path.join(source, 'src', 'scheduled', 'platformHealth.ts'));
ok(/schedule:\s*'every 5 minutes'/.test(health), 'platformHealth runs every 5 minutes');
ok(/secrets:\s*\[\s*'FIREBASE_DATABASE_URL'\s*\]/.test(health), 'platformHealth binds FIREBASE_DATABASE_URL');
ok(/status-all/.test(health), 'platformHealth probes api.foodhubbie.in/api/bot/status-all');
ok(/sendEachForMulticast/.test(health), 'platformHealth pushes via FCM multicast');
ok(/fcmTokenInvalidAt/.test(health), 'platformHealth marks dead tokens (same convention as the bot)');
// Never download the whole tree (batch-10 / batch-14 lesson).
ok(!/ref\(\s*'businesses'\s*\)/.test(health), 'platformHealth does not read the businesses tree');
ok(!/ref\(`businesses\/\$\{[^}]+\}\/outlets\/\$\{[^}]+\}\/botStatus`\s*\)\.once/.test(health),
    'platformHealth reads only botStatus leaves, not the node with its history');


// Batch 23c export + wiring: the web/app order finalizer runs in the Functions
// bundle in SHADOW mode (dry run, compare with the bot's own order).
ok(/export\s*\{\s*onWebOrderPlacedShadow,/.test(entry) && /onWebOrderFinalizedShadow/.test(entry),
    'index.ts exports both order-finalizer shadow triggers');
ok(/node scripts\/copy-vendor\.cjs/.test(String(pkg.scripts && pkg.scripts.build)),
    'the build copies the bot modules into lib/vendor before tsc compiles');

const copyVendor = read(path.join(source, 'scripts', 'copy-vendor.cjs'));
for (const rel of [
    'bot/order-finalizer.js', 'bot/utils.js', 'bot/order-pricing.js', 'bot/discount-engine-core.js',
    'shared/money-math.js', 'shared/loyalty-math.js', 'shared/discount-rules.js', 'shared/geo/geo.js',
]) {
    ok(copyVendor.includes(`'${rel}'`), `vendor list ships ${rel}`);
}
ok(/shared\/package\.json': \{ type: 'module' \}/.test(copyVendor),
    'the ESM shared math gets a {type:module} marker (CJS package would fall back to legacy math)');
ok(/function verifyLoad\(\)/.test(copyVendor) && /tax math fell back/.test(copyVendor),
    'the build proves the vendored tree loads with the shared math, not just that bytes were copied');

const shadowTrigger = read(path.join(source, 'src', 'triggers', 'orderFinalizerShadow.ts'));
ok(/onValueCreated\(/.test(shadowTrigger), 'the placed stage triggers on order creation');
ok(/orders\/\{orderId\}\/stockDeducted/.test(shadowTrigger), 'the finalize stage triggers on the stockDeducted flag, not the whole order');
ok(/dryRun: true/.test(shadowTrigger), 'the shadow run is a DRY RUN');
ok(!/dryRun: false/.test(shadowTrigger), 'nothing in the trigger opts out of dry run');
ok(/compareFinalization\(/.test(shadowTrigger), 'the finalize stage compares the stored verdict with the bot order');
ok(/migrationFlags\/orderFinalizerShadow\/enabled/.test(shadowTrigger), 'a kill switch can stop both triggers');
ok(/WEB_SOURCES = \['webview_delivery', 'APP'\]/.test(shadowTrigger), 'only browser-written orders are observed');
ok(/secrets: \['FIREBASE_DATABASE_URL'\]/.test(shadowTrigger), 'both triggers bind FIREBASE_DATABASE_URL');
ok(/require\(path\.join\(VENDOR/.test(shadowTrigger), 'the trigger loads the vendored copy of the bot module (no re-implementation)');

// Batch 23d-1: media endpoints (upload / delete-image) moved off EC2.
// The tenant must come from the VERIFIED token, never the body — otherwise an
// admin could write (or delete) another outlet's images.
ok(/export\s*\{\s*tenantMedia\s*\}/.test(entry), 'index.ts exports tenantMedia');
const media = read(path.join(source, 'src', 'api', 'tenantMedia.ts'));
ok(/\/tenant-api\/upload/.test(media), 'serves POST /tenant-api/upload');
ok(/\/tenant-api\/delete-image/.test(media), 'serves POST /tenant-api/delete-image');
// Batch 23d-2 moved the token→tenant resolution into shared/http/tenant.ts so
// every migrated route shares ONE implementation; these three checks follow it
// there and the media route must still call it (never resolve a tenant itself).
const httpTenant = read(path.join(source, 'src', 'shared', 'http', 'tenant.ts'));
ok(/export async function tenantFromToken/.test(httpTenant) && /verifyIdToken\(token\)/.test(httpTenant),
    'verifies the Firebase ID token (shared/http/tenant.ts)');
ok(/admins\/\$\{decoded\.uid\}/.test(httpTenant), 'resolves the admin row from the verified token uid');
ok(/if \(!row\.outlet\) throw new HttpError\(403/.test(httpTenant), 'refuses an admin without an outlet');
ok(/tenantFromToken\(req\)/.test(media), 'the media route resolves its tenant through the shared helper');
ok(!/body\.(bid|businessId|outlet)\b/.test(media), 'never takes the tenant from the request body');
ok(/mediaPrefix\(bid, oid\)/.test(media) && /startsWith\(mediaPrefix/.test(media),
    'delete is restricted to the caller’s own outlets/{bid}/{oid}/ prefix');
ok(/MAX_BODY_BYTES = 8 \* 1024 \* 1024/.test(media) && /MAX_IMAGE_BYTES = 6 \* 1024 \* 1024/.test(media),
    'keeps the 8 MB body / 6 MB image caps of the control API');
ok(/foodhubbie-10\.firebasestorage\.app/.test(media), 'defaults to the live media bucket');
ok(/resumable: false/.test(media) && /firebaseStorageDownloadTokens/.test(media),
    'stores byte-for-byte with a per-object download token (no re-encode)');
for (const origin of ['https://foodhubbie-admins.web.app', 'https://foodhubbie-supremeadmin.web.app',
    'https://app.foodhubbie.in', 'https://control.foodhubbie.in']) {
    ok(media.includes(`'${origin}'`), `CORS allows ${origin}`);
}
ok(/cors: DASHBOARD_ORIGINS/.test(media), 'wires the allowlist into the function (preflight handled by the runtime)');

// The bucket rules must keep denying every client write — the endpoint is the
// only writer, and it takes the tenant from the token.
const storageRules = read('storage.rules');
ok(/allow read, write: if false/.test(storageRules), 'storage rules still deny all client access by default');

// The dashboard reads config/mediaUrl itself; without a rule the read is denied,
// mediaBase() silently falls back to the control API, and the cutover looks done
// while every upload still goes to the old host.
const dbRules = JSON.parse(read('database.rules.json'));
const mediaUrlRule = dbRules?.rules?.config?.mediaUrl?.['.read'];
ok(!!mediaUrlRule, 'database.rules.json grants read on config/mediaUrl');
ok(/sign_in_provider != 'anonymous'/.test(String(mediaUrlRule || '')),
    'config/mediaUrl is readable by signed-in dashboards but not anonymous users',
    String(mediaUrlRule));

// Deploying the client without the CSP origin is a silent failure: the browser
// refuses the request before it leaves the page (the promo-API bug, batch 2026-11-08).
const hosting = JSON.parse(read('firebase.json')).hosting || [];
const adminHost = hosting.find((h) => h.target === 'admin');
const adminCsp = (adminHost?.headers || [])
    .flatMap((h) => h.headers || [])
    .filter((h) => h.key === 'Content-Security-Policy')
    .map((h) => h.value);
ok(adminCsp.length > 0, 'the admin target still ships a CSP');
ok(adminCsp.every((v) => /connect-src[^;]*https:\/\/us-central1-foodhubbie-10\.cloudfunctions\.net/.test(v)),
    'every admin CSP connect-src allows the media function origin');

// Client wiring: media goes to config/mediaUrl with a fallback to the control
// API, so removing the function cannot break image saving.
const adminFirebase = read('Admin/js/firebase.js');
ok(/config\/mediaUrl/.test(adminFirebase), 'the dashboard reads config/mediaUrl');
ok(/export async function uploadImage/.test(adminFirebase)
    && /await mediaBase\(\)/.test(adminFirebase.slice(adminFirebase.indexOf('export async function uploadImage'))),
    'uploadImage posts to the media base');
ok(/export async function deleteImage/.test(adminFirebase)
    && /await mediaBase\(\)/.test(adminFirebase.slice(adminFirebase.indexOf('export async function deleteImage'))),
    'deleteImage posts to the media base');

const evaluate = read(path.join(source, 'src', 'shared', 'health', 'evaluate.ts'));
ok(!/from 'firebase/.test(evaluate) && !/require\('firebase/.test(evaluate), 'evaluate.ts stays dependency-free (self-check runs it from lib/)');
ok(/STALE_AFTER_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(evaluate), 'stale threshold is 5 minutes');

// The self-check must cover the transition rules, not just the happy path.
const selfCheck = read(path.join(source, 'scripts', 'health-selfcheck.cjs'));
ok(/recovered/.test(selfCheck) && /repeat/.test(selfCheck) && /degraded/.test(selfCheck),
    'self-check covers recovery, hourly repeat and degraded');

// Batch 23d-2: the App Notifications send route moved off EC2. Same rules as
// 23d-1: tenant from the VERIFIED token, contract kept, and a client-side switch
// that degrades to the control API when the function is absent.
ok(/export\s*\{\s*tenantNotify\s*\}/.test(entry), 'index.ts exports tenantNotify');
const notify = read(path.join(source, 'src', 'api', 'tenantNotify.ts'));
ok(/\/tenant-api\/notify/.test(notify), 'serves POST /tenant-api/notify');
ok(/tenantFromToken\(req\)/.test(notify), 'resolves the tenant through the verified-token helper');
ok(!/body\.(bid|businessId|outlet)\b/.test(notify), 'never takes the tenant from the request body');
ok(/sendEachForMulticast/.test(notify), 'sends the FCM multicast');
ok(/pushSubscriptions/.test(notify) && /pushInbox/.test(notify) && /notifyLog/.test(notify),
    'keeps the subscriptions / inbox / send-history contract');
ok(/HISTORY_ROWS = 20/.test(notify), 'keeps the newest 20 history rows per outlet');
ok(/res\.json\(\{ ok: true, sent: successCount, failed: failureCount, total: tokens\.length, inbox: inboxCount \}\)/.test(notify),
    'response carries sent / failed / total / inbox (what the tab renders)');

// The caps must not drift from the bot module they mirror.
const capsSrc = read('bot/notification-caps.js');
const num = (src, re) => (src.match(re) || [])[1];
for (const [type, cap] of [['order', 50], ['loyalty', 5], ['promo', 3]]) {
    ok(new RegExp(`${type}\\s*:\\s*${cap}\\b`).test(capsSrc) && new RegExp(`${type}\\s*:\\s*${cap}\\b`).test(notify),
        `daily cap for ${type} is ${cap} on both sides`);
}
ok(/IST_OFFSET_MS\s*=\s*5\s*\*\s*3600000\s*\+\s*30\s*\*?\s*60000/.test(capsSrc)
    && /IST_OFFSET_MS\s*=\s*5\s*\*\s*3600000\s*\+\s*30\s*\*?\s*60000/.test(notify),
    'IST offset identical to bot/notification-caps.js');
ok(/h\s*>=\s*21\s*\|\|\s*h\s*<\s*9/.test(capsSrc) && /h\s*>=\s*21\s*\|\|\s*h\s*<\s*9/.test(notify),
    'quiet hours (21:00-09:00 IST) identical to bot/notification-caps.js');

// Inbox pruning uses the same module as the bot and the control API.
ok(copyVendor.includes(`'shared/push-inbox.cjs'`), 'vendor list ships shared/push-inbox.cjs');
ok(/vendor\/shared\/push-inbox\.cjs/.test(notify), 'the notify endpoint prunes with the vendored module');

// Client + rules wiring, mirroring the media cutover.
const appNotif = read('Admin/js/features/app-notifications.js');
ok(/config\/notifyUrl/.test(appNotif), 'the dashboard reads config/notifyUrl');
ok(/NOTIFY_URL/.test(appNotif) && /TUNNEL_URL/.test(appNotif)
    && appNotif.indexOf('config/notifyUrl') < appNotif.indexOf('config/tunnelUrl'),
    'notifyUrl wins over tunnelUrl, which stays as the fallback');
const notifyUrlRule = dbRules?.rules?.config?.notifyUrl?.['.read'];
ok(!!notifyUrlRule && /sign_in_provider != 'anonymous'/.test(String(notifyUrlRule)),
    'database.rules.json grants the non-anonymous read on config/notifyUrl',
    String(notifyUrlRule));

// ---- Batch 23d-3: Supreme onboarding group --------------------------------
// Same rules again: contract copied from the control API, identity from the
// VERIFIED token, and a per-route switch that falls back to the old host.
ok(/export\s*\{\s*tenantOnboarding\s*\}/.test(entry), 'index.ts exports tenantOnboarding');
const onboarding = read(path.join(source, 'src', 'api', 'tenantOnboarding.ts'));
ok(/\/api\/admin\/outlet-admin-status/.test(onboarding) && /\/api\/admin\/approve-onboarding/.test(onboarding)
    && /\/api\/admin\/update-password/.test(onboarding), 'serves the three onboarding routes');
ok(/supremeFromToken\(req\)/.test(onboarding), 'every route resolves the Supreme identity from the verified token');
ok(/row\.isSuper !== true && row\.isSupport !== true/.test(httpTenant)
    && /Not a Supreme Admin/.test(httpTenant), 'the Supreme check is isSuper || isSupport (same 403 string)');
ok(/requireSuperRole\(who\)/.test(onboarding) && /View-only account — this action requires full Supreme Admin access\./.test(httpTenant),
    'approve/password are refused for view-only accounts with the control API string');
const statusSection = onboarding.slice(onboarding.indexOf('async function handleStatus'), onboarding.indexOf('async function handleApprove'));
ok(/await supremeFromToken\(req\)/.test(statusSection) && !/requireSuperRole/.test(statusSection),
    'the status check stays readable by view-only accounts');
ok(/bid and oid are required/.test(onboarding), 'status validates bid and oid (400 string kept)');
ok(/reqKey, businessName, outletName, adminEmail are required/.test(onboarding),
    'approve validates the control API body fields (400 string kept)');
ok(/Password must be at least 6 characters/.test(onboarding), 'password length check kept');
ok(/Approval failed —/.test(onboarding) && /Password update failed —/.test(onboarding) && /Status check failed —/.test(onboarding),
    'unexpected failures keep the per-route 500 prefixes');

// The 2026-11-07 credential hardening is the point of this port: adopt the
// signup account, never invent one, never store a password.
ok(/getUser\(authUid\)/.test(onboarding) && /The admin email cannot be changed after the signup account was created\./.test(onboarding),
    'adopts the signup authUid and refuses an email change (422 string)');
ok(/The dashboard account recorded on this request no longer exists/.test(onboarding)
    && /does not match the admin email/.test(onboarding), 'refuses a missing / mismatched signup account');
ok(/No signup account on this request/.test(onboarding), 'legacy requests without a password are refused, not invented');
ok(/Admin email \$\{adminEmail\} already exists/.test(onboarding), 'legacy duplicate-email refusal kept');
// A negative lookahead here is a trap: `password:\s*` can backtrack to zero
// spaces, so `(?!legacyPassword)` then compares against " legacyPassword" and
// passes. Assert the positive instead — the only adminEmail createUser carries
// the replayed legacy password, and the authUid branch creates nothing.
ok(/createUser\(\{\s*email:\s*adminEmail,\s*password:\s*legacyPassword\b/.test(onboarding),
    'the only createUser path replays a legacy password (the authUid path never sets one)');
ok(/adminLogin: \{ email: adminEmail, updatedAt: now \}/.test(onboarding),
    'the new outlet stores the admin EMAIL only (no password on a tenant-readable node)');
ok(/passwordUpdatedAt: Date\.now\(\)/.test(onboarding), 'update-password stores only email + passwordUpdatedAt');
ok(/locked: true/.test(onboarding), 'a new outlet starts locked');
ok(/walletBilling\/\$\{bid\}\/\$\{oid\}`\]: getBillingDefaults\(\)/.test(onboarding),
    'wallet defaults are written to the server-only root (never businesses/{bid}/billing)');
ok(/outletIndex\/\$\{oid\}`\]: \{ bid, name: outletName, createdAt: now \}/.test(onboarding),
    'the outletIndex pointer is written (admins/riders depend on it)');
ok(/onboardingSecrets\/\$\{reqKey\}`\)\.set\(null\)/.test(onboarding) && /adminPassword: null/.test(onboarding),
    'the legacy secret + inline password are burned after the Auth user exists');
// Anchor on the object literal, not a bare word: the file's header comment also
// mentions `locked: true` and would make a bare indexOf() compare the prose.
const tplSpreadAt = onboarding.indexOf('...(tplDefaults || {}),');
const lockedPropAt = onboarding.indexOf('locked: true,');
ok(tplSpreadAt > 0 && lockedPropAt > tplSpreadAt,
    'template defaults are spread BEFORE identity/security fields',
    `tpl@${tplSpreadAt} locked@${lockedPropAt}`);
ok(copyVendor.includes(`'shared/billing-defaults.cjs'`), 'vendor list ships shared/billing-defaults.cjs');
ok(/vendor\/shared\/billing-defaults\.cjs/.test(onboarding), 'onboarding writes the vendored billing defaults');
// The prototype is named in the header comment on purpose (it documents why it
// is NOT this code) and index.ts still exports it for the legacy deployment, so
// pin what matters: this module does not import or re-export it.
ok(!/from\s+['"][^'"]*onboardingApprove/.test(onboarding) && /export const tenantOnboarding = onRequest/.test(onboarding),
    'the older prototype function is not reused');

const supremeCfg = read('SupremeAdmin/js/firebase-config.js');
ok(/config\/adminUrl/.test(supremeCfg), 'Supreme reads config/adminUrl');
ok(/ADMIN_API_URL = url/.test(supremeCfg) && /ADMIN_API_URL = adminUrl/.test(supremeCfg),
    'the admin override falls back to config/tunnelUrl and wins when present');
for (const file of ['SupremeAdmin/js/features/onboarding-requests.js',
    'SupremeAdmin/js/features/restaurant-onboarding.js',
    'SupremeAdmin/js/features/restaurant-profile.js']) {
    const src = read(file);
    ok(!/\$\{TUNNEL_URL\}\/api\/admin\//.test(src), `${file} no longer posts onboarding routes to the control API`);
    ok(/ADMIN_API_URL/.test(src), `${file} uses the admin override`);
}
const adminUrlRule = dbRules?.rules?.config?.adminUrl?.['.read'];
ok(!!adminUrlRule && /sign_in_provider != 'anonymous'/.test(String(adminUrlRule)),
    'database.rules.json grants the non-anonymous read on config/adminUrl',
    String(adminUrlRule));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
