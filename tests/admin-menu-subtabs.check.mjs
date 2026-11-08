// Menu, Categories and Combos share one sidebar entry with three sub-tabs (navigation only; no data/rules changes).
// Uses the real Admin/index.html + style.css with scripts blocked, so this checks markup, wiring and look.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(root, 'Admin/index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'Admin/js/ui.js'), 'utf8');
let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); } };

await t('sidebar has one Menu entry; Categories and Combos entries are gone', async () => {
    assert.equal((html.match(/id="menu-menu"/g) || []).length, 1);
    assert.ok(!/id="menu-categories"/.test(html) && !/id="menu-combos"/.test(html));
    assert.ok(/id="menu-menu-browser"/.test(html), 'Menu Browser stays its own entry');
});
await t('all three pages keep their ids and each carries the same sub-tab bar', async () => {
    for (const tab of ['menu', 'categories', 'combos']) {
        const i = html.indexOf(`<div id="tab-${tab}" class="tab-content hidden">`);
        assert.ok(i > 0, 'page ' + tab);
        const bar = html.slice(i, i + 1400);
        assert.equal((bar.match(/class="mc-subtab[ "]/g) || []).length, 3, tab + ' bar has 3 buttons');
        assert.ok(new RegExp(`class="mc-subtab active"[^>]*data-tab="${tab}"`).test(bar), tab + ' marks itself active');
        for (const x of ['menu', 'categories', 'combos']) assert.ok(bar.includes(`data-action="switchTab" data-tab="${x}"`), `${tab} bar links ${x}`);
    }
});
await t('Menu Bank button sits in the header of all three sub-tabs and main.js binds it by class', async () => {
    for (const tab of ['menu', 'categories', 'combos']) {
        const i = html.indexOf(`<div id="tab-${tab}" class="tab-content hidden">`);
        const next = html.indexOf('class="tab-content hidden"', i + 60);
        const page = html.slice(i, next > 0 ? next : i + 6000);
        assert.equal((page.match(/btn-open-menu-bank/g) || []).length, 1, tab + ' has one Menu Bank button');
        assert.ok(page.indexOf('btn-open-menu-bank') < page.indexOf('class="panel"') + 2500, tab + ': button is in the top header');
    }
    assert.ok(/querySelectorAll\('\.btn-open-menu-bank'\)/.test(fs.readFileSync(path.join(root, 'Admin/js/main.js'), 'utf8')));
});
await t('same permissions: ui.js hides a sub-tab the role cannot open, and the Menu entry opens the first allowed one', async () => {
    assert.ok(/MENU_GROUP = \['menu', 'categories', 'combos'\]/.test(ui));
    assert.ok(/MENU_GROUP\.filter\(canAccessTab\)/.test(ui));
    assert.ok(/navIdFor\(tabId\)/.test(ui) && /navIdFor\(state\.currentActiveTab\)/.test(ui), 'sidebar highlight maps sub-tabs to Menu');
    assert.ok(/'categories', 'combos', 'menu-browser'/.test(ui), 'tab ids/permission list unchanged');
});

const browser = await chromium.launch();
for (const [label, vp] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    await t(`looks right and does not overflow (${label})`, async () => {
        const page = await browser.newPage({ viewport: vp });
        await page.route('**/*', r => {
            const u = new URL(r.request().url());
            if (u.pathname.endsWith('/Admin/style.css')) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(root, 'Admin/style.css')) });
            if (u.pathname.endsWith('/Admin/mobile-overrides.css')) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(root, 'Admin/mobile-overrides.css')) });
            if (u.pathname.endsWith('/Admin/index.html')) return r.fulfill({ contentType: 'text/html', body: html });
            return r.abort();
        });
        await page.goto('http://x.test/Admin/index.html');
        await page.evaluate(() => { for (let n = document.getElementById('tab-menu'); n && n !== document.documentElement; n = n.parentElement) { n.classList.remove('hidden'); if (getComputedStyle(n).display === 'none') n.style.display = 'block'; } document.querySelectorAll('.mc-subtab').forEach(b => b.style.display = ''); });
        const m = await page.evaluate(() => {
            const bar = document.querySelector('#tab-menu .mc-subtabs'), bs = [...bar.querySelectorAll('.mc-subtab')];
            const r = bar.getBoundingClientRect();
            return { shown: r.height > 20, cs: getComputedStyle(bar).display, labels: bs.map(b => b.textContent.trim()), h: bs.map(b => Math.round(b.getBoundingClientRect().height)), activeBg: getComputedStyle(bar.querySelector('.active')).backgroundColor, barRight: r.right, vw: innerWidth, docW: document.documentElement.scrollWidth };
        });
        assert.ok(m.shown && m.cs === 'flex', 'bar visible as a row ' + JSON.stringify(m));
        assert.deepEqual(m.labels, ['Menu', 'Categories', 'Combos']);
        assert.ok(m.activeBg !== 'rgba(0, 0, 0, 0)', 'active sub-tab highlighted');
        assert.ok(m.barRight <= m.vw + 1 && m.docW <= m.vw + 1, `no sideways scroll (${m.docW} vs ${m.vw})`);
        if (label === 'phone') assert.ok(Math.min(...m.h) >= 40, 'tappable height ' + m.h);
        await page.evaluate(() => { const t = document.getElementById('tab-menu'); t.style.cssText += ';position:fixed;inset:0;z-index:2147483000;background:#f1f5f9;padding:16px'; });
        await page.screenshot({ path: process.argv[2] ? path.join(process.argv[2], `menu-subtabs-${label}.png`) : '/dev/null', clip: { x: 0, y: 0, width: vp.width, height: 300 } }).catch(() => {});
        await page.close();
    });
}
await browser.close();
console.log(failed ? failed + ' FAILED' : 'admin-menu-subtabs ALL PASSED');
process.exit(failed ? 1 : 0);
