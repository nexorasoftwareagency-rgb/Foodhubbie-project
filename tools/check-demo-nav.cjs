/**
 * Check: the public demo must (a) mirror the live sidebar exactly and (b) stay
 * data-isolated from production.
 *
 * Run: node tools/check-demo-nav.cjs   (wired to `npm run check:demo-nav`)
 *
 * Why this exists: the demo is a static replica of the dashboard shell. If a new
 * module ships in Admin/index.html, the demo silently starts hiding a module —
 * which violates the "preserve every module" requirement. This check fails the
 * build until the demo nav (and its page) is updated.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// --- 1. live sidebar ---------------------------------------------------------

const html = read('Admin/index.html');
const navStart = html.indexOf('<nav class="sidebar"');
const navEnd = html.indexOf('</nav>', navStart);
if (navStart === -1 || navEnd === -1) {
    console.error('FATAL: could not locate the sidebar in Admin/index.html');
    process.exit(1);
}
const sidebarFull = html.slice(navStart, navEnd);
// The footer profile chip re-uses data-tab="settings" — stop before it.
const footerIdx = sidebarFull.indexOf('<div class="sidebar-footer">');
const sidebar = footerIdx === -1 ? sidebarFull : sidebarFull.slice(0, footerIdx);

const liveTabs = [...new Set(
    [...sidebar.matchAll(/data-tab="([a-zA-Z0-9-]+)"/g)].map(m => m[1]),
)];
if (!liveTabs.length) {
    console.error('FATAL: no data-tab entries found in the live sidebar');
    process.exit(1);
}
const liveInstall = /data-action="installPWA"/.test(sidebar);
const liveLogout = /data-action="userLogout"/.test(sidebar);

// --- 2. demo nav config ------------------------------------------------------

const navSrc = read('Admin/js/demo/nav-config.js');
const groupsIdx = navSrc.indexOf('export const NAV_GROUPS');
const demoOnlyIdx = navSrc.indexOf('export const DEMO_ONLY_PAGES');
if (groupsIdx === -1 || demoOnlyIdx === -1) {
    console.error('FATAL: could not locate NAV_GROUPS / DEMO_ONLY_PAGES in Admin/js/demo/nav-config.js');
    process.exit(1);
}
const navGroupsSrc = navSrc.slice(groupsIdx, demoOnlyIdx);
const demoTabs = [...navGroupsSrc.matchAll(/\btab:\s*'([^']+)'/g)].map(m => m[1]);

const demoContentTabs = demoTabs.filter(t => t !== 'install' && t !== 'logout');

console.log('Demo nav sync');
const missing = liveTabs.filter(t => !demoContentTabs.includes(t));
const extra = demoContentTabs.filter(t => !liveTabs.includes(t));
if (missing.length) fail(`modules in the live sidebar but missing from the demo: ${missing.join(', ')}`);
else ok(`all ${liveTabs.length} live sidebar modules present in the demo`);

if (extra.length) fail(`demo invents sidebar modules that do not exist live: ${extra.join(', ')}`);
else ok('demo adds no phantom sidebar modules');

const orderMismatch = liveTabs.findIndex((t, i) => demoContentTabs[i] !== t);
if (orderMismatch === -1) ok('sidebar order matches the live product');
else fail(`sidebar order drifts at index ${orderMismatch}: live "${liveTabs[orderMismatch]}" vs demo "${demoContentTabs[orderMismatch]}"`);

if (demoTabs.includes('install') === liveInstall) ok('Download App entry present');
else fail('Download App entry does not match the live sidebar');
if (demoTabs.includes('logout') === liveLogout) ok('Logout entry present');
else fail('Logout entry does not match the live sidebar');

// --- 3. every visible tab must have a destination ---------------------------

const mainSrc = read('Admin/js/demo/main.js');
const routeBlock = mainSrc.slice(mainSrc.indexOf('const ROUTES = {'), mainSrc.indexOf('const VALID'));
const routed = [...routeBlock.matchAll(/^\s{4}'?([a-zA-Z0-9_-]+)'?:/gm)].map(m => m[1]);
const unrouted = demoTabs.filter(t => t !== 'logout' && !routed.includes(t));
if (unrouted.length) fail(`sidebar entries with no demo destination: ${unrouted.join(', ')}`);
else ok(`every sidebar entry resolves to a page (${routed.length} routes)`);

// --- 4. data isolation -------------------------------------------------------

console.log('Demo data isolation');
const demoDir = path.join(root, 'Admin/js/demo');
const demoFiles = fs.readdirSync(demoDir).filter(f => f.endsWith('.js'));

const forbidden = [
    { re: /from\s+['"][^'"]*firebase[^'"]*['"]/i, why: 'imports a Firebase module' },
    { re: /\binitializeApp\b/, why: 'initialises a Firebase app' },
    { re: /\bfirebase\.(database|auth|firestore|app)\b/, why: 'uses the Firebase SDK' },
    { re: /\bXMLHttpRequest\b/, why: 'opens a raw XHR' },
    { re: /\bfetch\s*\(/, why: 'performs a network request' },
    { re: /bot-control-api|localhost:3001|\/api\/bot\//, why: 'calls the bot-control API' },
    { re: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, why: 'persists data in the browser' },
];
let violated = 0;
for (const file of demoFiles) {
    const src = fs.readFileSync(path.join(demoDir, file), 'utf8');
    for (const rule of forbidden) {
        if (rule.re.test(src)) { fail(`${file} ${rule.why}`); violated++; }
    }
}
if (!violated) ok(`${demoFiles.length} demo modules have no Firebase/network/storage access`);

const demoHtml = read('Admin/demo.html');
if (/firebase/i.test(demoHtml)) fail('Admin/demo.html references firebase');
else ok('Admin/demo.html loads no Firebase SDK');

if (/(gstatic\.com\/firebasejs|firebase-app\.js|firebase-database)/.test(demoHtml)) fail('demo.html loads the Firebase CDN bundle');
else ok('no Firebase CDN bundle in the demo shell');

// --- 5. exact restriction copy ----------------------------------------------

console.log('Restriction copy');
const restrictSrc = read('Admin/js/demo/restrict.js');
const required = {
    title: 'Demo Mode — Access Restricted',
    message: "You don't have access to this feature because you are using the FoodHubbie Demo Admin Dashboard. This feature is available only to authorized administrators in the live application.",
    button: 'Got it',
};
for (const [key, text] of Object.entries(required)) {
    if (!restrictSrc.includes(text)) fail(`restriction ${key} text is not the exact spec wording`);
    else ok(`restriction ${key} matches spec`);
}

// --- 6. hosting route --------------------------------------------------------

console.log('Hosting route');
const firebaseJson = JSON.parse(read('firebase.json'));
const admin = (firebaseJson.hosting || []).find(h => h.target === 'admin');
const rewrites = (admin && admin.rewrites) || [];
const demoIdx = rewrites.findIndex(r => r.source === '/demo' && r.destination === '/demo.html');
const catchAllIdx = rewrites.findIndex(r => r.source === '**');
if (demoIdx === -1) fail('/demo rewrite to /demo.html is missing');
else if (catchAllIdx !== -1 && demoIdx > catchAllIdx) fail('/demo rewrite must come before the catch-all rewrite');
else ok('/demo rewrites to /demo.html ahead of the SPA catch-all');

// Without this, "/demo/" falls through to the catch-all and shows the live login.
const trailing = ((admin && admin.redirects) || []).find(r => r.source === '/demo/' && r.destination === '/demo');
if (!trailing) fail('/demo/ does not redirect to /demo (it would fall through to the live login page)');
else ok('/demo/ redirects to /demo');

const demoHeaders = ((admin && admin.headers) || []).find(h => h.regex === '^/(demo|demo\\.html)$');
if (!demoHeaders) {
    fail('demo-scoped headers are missing (expected the regex ^/(demo|demo\\.html)$)');
} else {
    // Firebase applies header rules in order and the LAST match wins
    // (firebase-tools #8917 / #9467) — so the demo block must be last, or the
    // broad admin CSP silently replaces the stricter demo one.
    const adminHeaders = admin.headers;
    if (adminHeaders[adminHeaders.length - 1] !== demoHeaders) {
        fail('demo headers must be the LAST matching block (Firebase: last match wins)');
    } else {
        ok('demo headers are the last matching block (wins the Firebase merge)');
    }

    const csp = (demoHeaders.headers.find(h => h.key === 'Content-Security-Policy') || {}).value || '';
    if (!csp) fail('demo CSP is missing');
    else if (/firebaseio|firebasedatabase|identitytoolkit|firebaseapp/.test(csp)) fail('demo CSP still allows production Firebase origins');
    else ok('demo CSP allows no production data origins');
    if (!/connect-src 'self'/.test(csp)) fail("demo CSP must restrict connect-src to 'self'");
    else ok('demo CSP restricts connect-src');
}

// --- 6b. marketing-site mirror (www.foodhubbie.in/demo) -----------------------

console.log('Marketing-site mirror');
const websiteAdmin = (firebaseJson.hosting || []).find(h => h.target === 'website');
const wRewrites = (websiteAdmin && websiteAdmin.rewrites) || [];
if (!wRewrites.some(r => r.source === '/demo' && r.destination === '/demo/index.html')) {
    fail('website target does not rewrite /demo → /demo/index.html');
} else ok('/demo is rewritten on the website target');

const wHeaders = (websiteAdmin && websiteAdmin.headers) || [];
const wDemo = wHeaders.find(h => (h.regex || '').includes('^/demo'));
if (!wDemo) {
    fail('website target has no demo-scoped headers (the marketing CSP would apply)');
} else if (wHeaders[wHeaders.length - 1] !== wDemo) {
    fail('website demo headers must be the LAST matching block (Firebase: last match wins)');
} else {
    const wCsp = (wDemo.headers.find(h => h.key === 'Content-Security-Policy') || {}).value || '';
    if (/firebaseio|firebasedatabase|identitytoolkit|firebaseapp/.test(wCsp)) fail('website demo CSP allows production Firebase origins');
    else if (!/connect-src 'self'/.test(wCsp)) fail("website demo CSP must restrict connect-src to 'self'");
    else ok('website demo CSP is demo-scoped and Firebase-free');
}

const mirror = path.join(root, 'website/demo');
if (!fs.existsSync(path.join(mirror, 'index.html'))) {
    fail('website/demo/ mirror is missing — run `npm run build:demo-site`');
} else {
    const mirrorHtml = fs.readFileSync(path.join(mirror, 'index.html'), 'utf8');
    if (/firebase/i.test(mirrorHtml)) fail('website/demo/index.html references firebase');
    else if (!mirrorHtml.includes('/demo/js/demo/main.js')) fail('website/demo/index.html does not load /demo/js/demo/main.js');
    else ok('mirrored shell is self-contained under /demo');

    if (!mirrorHtml.includes('<link rel="canonical" href="https://foodhubbie.in/demo">')) fail('mirrored shell lost the canonical URL');
    else if (/noindex/i.test(mirrorHtml)) fail('mirrored shell carries a noindex directive');
    else ok('mirrored shell is indexable at the canonical URL');

    // Drift guard: the mirror must be a byte copy of the current build output.
    const dist = path.join(root, 'Admin/dist');
    const files = [];
    const collect = (rel) => {
        const from = path.join(dist, rel);
        if (!fs.existsSync(from)) { fail(`Admin/dist/${rel} is missing — run \`npm run build:admin\` first`); return; }
        if (fs.statSync(from).isDirectory()) {
            for (const entry of fs.readdirSync(from)) collect(path.join(rel, entry));
        } else {
            files.push(rel);
        }
    };
    ['style.css', path.join('js', 'demo'), 'shared'].forEach(collect);

    let drift = 0;
    for (const rel of files) {
        const mirrorPath = path.join(mirror, rel);
        if (!fs.existsSync(mirrorPath) || !fs.readFileSync(path.join(dist, rel)).equals(fs.readFileSync(mirrorPath))) {
            fail(`website/demo/${rel} is stale — run \`npm run build:demo-site\``);
            drift++;
        }
    }
    if (!drift) ok(`mirror is byte-identical to Admin/dist (${files.length} files, no drift)`);
}

// --- 6c. indexability (www.foodhubbie.in/demo is a public marketing page) -----

console.log('Discoverability');
const sitemap = fs.readFileSync(path.join(root, 'website/sitemap.xml'), 'utf8');
if (!/<loc>https:\/\/foodhubbie\.in\/demo<\/loc>/.test(sitemap)) fail('/demo is missing from website/sitemap.xml');
else ok('/demo is listed in the sitemap');

const robots = fs.readFileSync(path.join(root, 'website/robots.txt'), 'utf8');
if (/^\s*Disallow:\s*\/demo/m.test(robots)) fail('website/robots.txt disallows /demo');
else ok('website/robots.txt does not disallow /demo');

const shellHtml = read('Admin/demo.html');
if (/noindex/i.test(shellHtml)) fail('Admin/demo.html asks search engines not to index it');
else ok('demo shell carries no noindex directive');
if (!/<link rel="canonical" href="https:\/\/foodhubbie\.in\/demo">/.test(shellHtml)) fail('demo shell has no canonical https://foodhubbie.in/demo');
else ok('demo shell declares the canonical marketing URL');
if (!/<meta name="robots" content="index, ?follow">/.test(shellHtml)) fail('demo shell does not allow indexing');
else ok('demo shell is explicitly indexable');

// Every marketing page carries the "Live demo" CTA in the shared nav.
const sitePages = fs.readdirSync(path.join(root, 'website')).filter(f => f.endsWith('.html'));
const withNav = sitePages.filter(f => /class="nav-cta"/.test(fs.readFileSync(path.join(root, 'website', f), 'utf8')));
const noCta = withNav.filter(f => !/class="link nav-demo" href="\/demo"/.test(fs.readFileSync(path.join(root, 'website', f), 'utf8')));
if (!withNav.length) fail('no marketing page exposes the nav CTA — nav markup moved?');
else if (noCta.length) fail(`marketing pages missing the Live demo nav link: ${noCta.join(', ')}`);
else ok(`Live demo nav link present on all ${withNav.length} marketing pages`);

// --- 7. production auth untouched -------------------------------------------

console.log('Production auth');
const authSrc = read('Admin/js/auth.js');
if (/demo/i.test(authSrc) && /bypass|skipAuth|demoMode/i.test(authSrc)) fail('Admin/js/auth.js contains a demo auth bypass');
else ok('Admin/js/auth.js has no demo bypass');

const rules = read('database.rules.json');
if (/demo/i.test(rules)) fail('database.rules.json contains demo-specific rules');
else ok('database.rules.json is unchanged by the demo');

if (process.exitCode) {
    console.error('\ncheck-demo-nav FAILED');
} else {
    console.log('\ncheck-demo-nav OK');
}
