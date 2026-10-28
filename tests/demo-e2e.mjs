/**
 * Public demo E2E — offline, against Admin/dist served by a throwaway static
 * server. No production origin is contacted: every request the page makes is
 * recorded and asserted against an allowlist (self + Google Fonts + unpkg).
 *
 * Run: npm run test:demo
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'Admin', 'dist');
const PORT = Number(process.env.DEMO_TEST_PORT || 8231);
// The public link is https://www.foodhubbie.in/demo — that host serves the
// MARKETING site target, so the demo is mirrored into website/demo/.
const SITE_ROOT = path.resolve(__dirname, '..', 'website');
const SITE_PORT = Number(process.env.DEMO_SITE_PORT || 8232);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
};

const ALLOWED_HOSTS = new Set([
    'localhost',
    `localhost:${PORT}`,
    `localhost:${SITE_PORT}`,
    '127.0.0.1',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'unpkg.com',
]);

const results = [];
function check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail && !pass ? ` — ${detail}` : ''}`);
}

function serve(root, port, mapPath) {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        let rel = mapPath(decodeURIComponent(url.pathname));
        const file = path.join(root, rel);
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function startServer() {
    return serve(ROOT, PORT, (p) => {
        if (p === '/demo' || p === '/demo/') return '/demo.html';
        if (p === '/') return '/index.html';
        return p;
    });
}

// Mirrors the website target: cleanUrls + the /demo rewrite from firebase.json.
function startSiteServer() {
    return serve(SITE_ROOT, SITE_PORT, (p) => {
        if (p === '/demo') return '/demo/index.html';
        if (p === '/') return '/index.html';
        if (p.endsWith('/') && fs.existsSync(path.join(SITE_ROOT, p, 'index.html'))) return `${p}index.html`;
        if (fs.existsSync(path.join(SITE_ROOT, `${p}.html`))) return `${p}.html`;
        if (fs.existsSync(path.join(SITE_ROOT, p, 'index.html'))) return `${p}/index.html`;
        return p;
    });
}

const RESTRICT_TITLE = 'Demo Mode — Access Restricted';
const RESTRICT_MESSAGE = "You don't have access to this feature because you are using the FoodHubbie Demo Admin Dashboard. This feature is available only to authorized administrators in the live application.";

async function main() {
    if (!fs.existsSync(path.join(ROOT, 'demo.html'))) {
        console.error('Admin/dist/demo.html is missing — run `npm run build:admin` first.');
        process.exit(1);
    }
    const server = await startServer();
    const base = `http://localhost:${PORT}`;
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    const outbound = [];
    const downloads = [];

    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    page.on('request', (req) => {
        const u = req.url();
        if (u.startsWith('data:') || u.startsWith('blob:')) return;
        try {
            const host = new URL(u).host;
            if (!ALLOWED_HOSTS.has(host)) outbound.push(u);
        } catch { outbound.push(u); }
    });

    // ---------------------------------------------------------------- public entry
    console.log('\nPublic access');
    const resp = await page.goto(`${base}/demo`, { waitUntil: 'networkidle' });
    check('/demo responds 200 without a rewrite loop', resp && resp.status() === 200, `status ${resp && resp.status()}`);
    check('no login form is rendered', await page.locator('#loginForm, #loginPassword, [name="password"]').count() === 0);
    check('no auth overlay is present', await page.locator('#authOverlay').count() === 0);
    check('demo banner identifies the environment', /demo mode/i.test(await page.locator('.demo-banner').innerText()));
    check('synthetic outlet is shown', await page.locator('#demoContent').innerText().then(t => /Bella Napoli|synthetic/i.test(t)));

    // --------------------------------------------------------------- module coverage
    console.log('\nModule coverage');
    const sidebarTabs = await page.locator('#demoSidebarNav [data-nav]').evaluateAll(els => els.map(e => e.getAttribute('data-nav')));
    check(`sidebar exposes every module (${sidebarTabs.length})`, sidebarTabs.length >= 26, JSON.stringify(sidebarTabs));

    const modules = await page.evaluate(() => window.__FOODHUBBIE_DEMO__.tabs);
    const failedPages = [];
    for (const tab of modules) {
        await page.evaluate((t) => window.__FOODHUBBIE_DEMO__.go(t), tab);
        await page.waitForTimeout(30);
        const txt = (await page.locator('#demoContent').innerText()).trim();
        const errShown = txt.includes('This demo screen failed to render');
        if (txt.length < 40 || errShown) failedPages.push(`${tab}:${txt.length}${errShown ? ':error' : ''}`);
    }
    check(`all ${modules.length} destinations render content`, failedPages.length === 0, failedPages.join(', '));
    check('topbar title updates per module', (await page.locator('#demoTabTitle').innerText()).length > 3);

    // -------------------------------------------------------------- restricted action
    console.log('\nRestricted action');
    await page.evaluate(() => window.__FOODHUBBIE_DEMO__.go('settings'));
    await page.waitForTimeout(50);
    await page.locator('[data-demo-restricted]').first().click();
    await page.waitForTimeout(80);
    const modal = page.locator('#demoRestrictModal');
    check('restriction modal opens', await modal.evaluate(el => el.classList.contains('is-open')));
    check('title is exact', (await page.locator('#demoRestrictTitle').innerText()) === RESTRICT_TITLE);
    check('message is exact', (await page.locator('#demoRestrictMsg').innerText()) === RESTRICT_MESSAGE);
    check('button label is "Got it"', (await page.locator('#btnRestrictGotIt').innerText()).trim() === 'Got it');
    await page.locator('#btnRestrictGotIt').click();
    check('Got it closes the modal', !(await modal.evaluate(el => el.classList.contains('is-open'))));
    await page.locator('[data-demo-restricted]').first().click();
    await page.keyboard.press('Escape');
    check('Escape closes the modal', !(await modal.evaluate(el => el.classList.contains('is-open'))));

    // --------------------------------------------------------------- safe interactivity
    console.log('\nSafe interactivity');
    await page.evaluate(() => window.__FOODHUBBIE_DEMO__.go('orders'));
    await page.waitForTimeout(50);
    const beforeSearch = await page.locator('.demo-table tbody tr').count();
    await page.fill('#demoOrderSearch', 'Aarav');
    await page.waitForTimeout(120);
    const afterSearch = await page.locator('.demo-table tbody tr').count();
    check('order search filters rows', afterSearch > 0 && afterSearch <= beforeSearch, `${beforeSearch} → ${afterSearch}`);
    await page.fill('#demoOrderSearch', 'zzz-nothing');
    await page.waitForTimeout(120);
    check('empty state appears for no matches', (await page.locator('#demoContent').innerText()).includes('No orders match this filter'));
    await page.fill('#demoOrderSearch', '');
    await page.waitForTimeout(120);

    // POS simulated sale
    await page.evaluate(() => window.__FOODHUBBIE_DEMO__.go('walkin'));
    await page.waitForTimeout(60);
    const ordersBefore = await page.evaluate(() => window.__FOODHUBBIE_DEMO__.data.orders.length);
    await page.locator('[data-pos-add]').first().click();
    await page.waitForTimeout(60);
    const totalText = await page.locator('.demo-totals__row--grand b').innerText();
    await page.locator('#btnPosCheckout').click();
    await page.waitForTimeout(120);
    const ordersAfter = await page.evaluate(() => window.__FOODHUBBIE_DEMO__.data.orders.length);
    check('simulated POS sale adds a demo order', ordersAfter === ordersBefore + 1, `${ordersBefore} → ${ordersAfter} (total ${totalText})`);
    check('POS total is not zero', /\d/.test(totalText));

    // order drawer
    await page.evaluate(() => window.__FOODHUBBIE_DEMO__.go('orders'));
    await page.waitForTimeout(60);
    await page.locator('[data-open-order]').first().click();
    await page.waitForTimeout(80);
    check('order drawer opens with a money breakdown', await page.locator('#demoOrderDrawer .demo-totals').count() === 1);
    await page.locator('#demoOrderDrawer [data-drawer-close]').last().click();
    await page.waitForTimeout(60);

    // reports (real shared/report-catalog.js)
    await page.evaluate(() => window.__FOODHUBBIE_DEMO__.go('reports'));
    await page.waitForTimeout(80);
    const reportRows = await page.locator('.demo-table tbody tr').count();
    check('reports render rows from the shared catalogue', reportRows > 0, `${reportRows} rows`);
    await page.locator('#btnReportCsv').click();
    await page.waitForTimeout(250);
    check('CSV export produces a download', downloads.length > 0, downloads.join(','));

    // reset
    await page.locator('#btnDemoReset').click();
    await page.waitForTimeout(150);
    const ordersAfterReset = await page.evaluate(() => window.__FOODHUBBIE_DEMO__.data.orders.length);
    check('reset restores the seeded dataset', ordersAfterReset === ordersBefore, `${ordersAfter} → ${ordersAfterReset}`);

    // ------------------------------------------------------------- tenant isolation
    console.log('\nTenant isolation');
    await page.goto(`${base}/demo?b=roshani-pizza&o=pizza&business=roshani-cake#/dashboard`, { waitUntil: 'networkidle' });
    const scoped = await page.locator('#demoContent').innerText();
    check('URL tenant parameters cannot select a business', !/roshani-pizza|roshani-cake/i.test(scoped) && /Bella Napoli|synthetic/i.test(scoped));
    check('demo exposes no firebase SDK globals', await page.evaluate(() => typeof window.firebase === 'undefined' && typeof window.firebaseui === 'undefined'));
    const storage = await page.evaluate(() => ({
        local: Object.keys(localStorage).length,
        session: Object.keys(sessionStorage).length,
        cookies: document.cookie,
    }));
    check('demo writes nothing to browser storage', storage.local === 0 && storage.session === 0 && storage.cookies === '', JSON.stringify(storage));
    check('no production origin was contacted', outbound.length === 0, outbound.slice(0, 5).join(', '));

    // -------------------------------------------------------------- mobile + a11y
    console.log('\nResponsive & keyboard');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/demo`, { waitUntil: 'networkidle' });
    const navVisibleBefore = await page.locator('#demoSidebar').evaluate(el => el.getBoundingClientRect().left >= 0);
    await page.locator('#btnDemoMenu').click();
    await page.waitForTimeout(320);
    const navVisibleAfter = await page.locator('#demoSidebar').evaluate(el => el.getBoundingClientRect().left >= 0);
    check('mobile navigation opens as a drawer', !navVisibleBefore && navVisibleAfter, `${navVisibleBefore} → ${navVisibleAfter}`);
    await page.locator('#demoSidebarOverlay').click({ force: true });
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---------------------------------------------------------- production regression
    console.log('\nProduction regression');
    const loginPage = await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    check('live dashboard still serves the login gate', loginPage.status() === 200 && (await page.locator('#loginForm').count()) > 0);
    check('live dashboard never redirects to the demo', !(await page.url()).includes('/demo'));

    // ------------------------------------------------------- marketing site mirror
    console.log('\nMarketing site mirror (www.foodhubbie.in/demo)');
    if (!fs.existsSync(path.join(SITE_ROOT, 'demo', 'index.html'))) {
        check('website/demo/ mirror exists', false, 'run `npm run build:demo-site`');
    } else {
        const site = await startSiteServer();
        const siteBase = `http://localhost:${SITE_PORT}`;
        const sitePage = await context.newPage();
        const siteErrors = [];
        const siteOutbound = [];
        sitePage.on('console', (m) => { if (m.type() === 'error') siteErrors.push(m.text()); });
        sitePage.on('pageerror', (e) => siteErrors.push(`pageerror ${e}`));
        sitePage.on('request', (req) => {
            const u = req.url();
            if (u.startsWith('data:') || u.startsWith('blob:')) return;
            try {
                if (!ALLOWED_HOSTS.has(new URL(u).host)) siteOutbound.push(u);
            } catch { siteOutbound.push(u); }
        });

        const siteResp = await sitePage.goto(`${siteBase}/demo`, { waitUntil: 'networkidle' });
        check('/demo is served by the marketing site target', siteResp && siteResp.status() === 200, `status ${siteResp && siteResp.status()}`);
        check('mirrored demo renders the banner', /demo mode/i.test(await sitePage.locator('.demo-banner').innerText()));
        check('mirrored demo has no login gate', await sitePage.locator('#loginForm').count() === 0);
        const siteModules = await sitePage.evaluate(() => window.__FOODHUBBIE_DEMO__.tabs);
        const siteNavCount = await sitePage.locator('#demoSidebarNav [data-nav]').count();
        check(`mirrored demo keeps every module (${siteNavCount} nav / ${siteModules.length} routes)`, siteNavCount >= 26 && siteModules.length >= 27);

        await sitePage.evaluate(() => window.__FOODHUBBIE_DEMO__.go('settings'));
        await sitePage.waitForTimeout(60);
        await sitePage.locator('[data-demo-restricted]').first().click();
        await sitePage.waitForTimeout(80);
        check('mirrored demo enforces the restriction', (await sitePage.locator('#demoRestrictTitle').innerText()) === RESTRICT_TITLE);
        await sitePage.locator('#btnRestrictGotIt').click();

        check('mirrored demo loads no firebase SDK', await sitePage.evaluate(() => typeof window.firebase === 'undefined'));
        check('mirrored demo contacts no foreign origin', siteOutbound.length === 0, siteOutbound.slice(0, 3).join(', '));
        const siteRealErrors = siteErrors.filter(t => !/favicon|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED.*unpkg|fonts\.googleapis/i.test(t));
        check('mirrored demo logs no console errors', siteRealErrors.length === 0, siteRealErrors.slice(0, 3).join(' | '));

        check('mirrored shell declares the canonical marketing URL',
            await sitePage.evaluate(() => document.querySelector('link[rel="canonical"]')?.href) === 'https://foodhubbie.in/demo');

        const home = await sitePage.goto(`${siteBase}/`, { waitUntil: 'domcontentloaded' });
        check('marketing home page is unchanged', home.status() === 200 && /FoodHubbie/.test(await sitePage.title()));
        check('marketing nav links to the demo', await sitePage.locator('a.nav-demo[href="/demo"]').count() === 1);

        await sitePage.close();
        site.close();
    }

    // ---------------------------------------------------------------- console health
    console.log('\nConsole health');
    const ignorable = (t) => /favicon|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED.*unpkg|fonts\.googleapis/i.test(t);
    const realErrors = consoleErrors.filter(t => !ignorable(t));
    check('no console errors on any page', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
    check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

    await browser.close();
    server.close();

    const failed = results.filter(r => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) {
        console.error(`\nFAILED: ${failed.map(f => f.name).join('; ')}`);
        process.exit(1);
    }
    console.log('demo-e2e OK');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
