/**
 * Keyboard accessibility check: every delegated control tab-reachable,
 * Enter/Space-activatable — Dashboard, all tabs/sub-tabs, POS focus.
 * Usage: node tests/check-keyboard.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'test-results', 'keyboard');
fs.mkdirSync(OUT, { recursive: true });

const ADMIN_URL = process.env.ADMIN_URL || 'https://foodhubbie-admins.web.app';
const EMAIL = 'roshanipizza@gmail.com';
const PASSWORD = process.env.ADMIN_PASSWORD || '';

const TABS = ['dashboard', 'orders', 'live', 'walkin', 'tables', 'promotions', 'discounts',
  'menu', 'categories', 'menu-browser', 'inventory', 'riders', 'customers', 'chat',
  'reports', 'riderAnalytics', 'feedback', 'liveTracker', 'notifications', 'payments',
  'expenses', 'costs', 'settings'];

const checks = [];
const pageErrors = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const ov = page.locator('.dynamic-modal-overlay').first();
    if (!(await ov.count())) return;
    const cancel = ov.locator('.btn-cancel');
    if (await cancel.count()) await cancel.click().catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function goTab(page, tab) {
  await dismissModals(page);
  const btn = page.locator(`[data-action="switchTab"][data-tab="${tab}"]`).first();
  await btn.click({ timeout: 10000 });
  await page.waitForSelector(`#tab-${tab}:not(.hidden)`, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await dismissModals(page);
}

const sweepAudit = () => ({
  missing: [...document.querySelectorAll('[data-action], [data-tab], [data-sort]')]
    .filter(el => !el.hasAttribute('tabindex')
      && !el.matches('button, a[href], input, select, textarea, .sidebar-overlay'))
    .map(el => (el.className && typeof el.className === 'string' ? el.className : el.tagName).slice(0, 60)),
  total: document.querySelectorAll('[data-action], [data-tab], [data-sort]').length,
});

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // Login
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 30000 });
  await page.fill('#loginEmail', EMAIL);
  await page.fill('#loginPassword', PASSWORD);
  await page.click('#loginBtn');
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
  });

  // 1. Sweep audit across every tab/sub-tab
  for (const tab of TABS) {
    try {
      await goTab(page, tab);
      const a = await page.evaluate(sweepAudit);
      check(`sweep: ${tab}`, a.missing.length === 0,
        a.missing.length ? `${a.missing.length}/${a.total} missing tabindex: ${a.missing.slice(0, 3).join(' | ')}` : `${a.total} controls`);
    } catch (e) {
      check(`sweep: ${tab}`, false, `tab failed: ${String(e).slice(0, 120)}`);
    }
  }

  // 2. Dashboard — rows + priority cards + kill widget reachability
  await goTab(page, 'dashboard');
  const pc = page.locator('.priority-card-v4[tabindex]').first();
  if (await pc.count()) {
    await pc.focus();
    check('dashboard: priority card focusable', await pc.evaluate(el => document.activeElement === el));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    check('dashboard: priority card Enter opens drawer', (await page.locator('#orderDrawer.active').count()) > 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    check('dashboard: Escape closes drawer', (await page.locator('#orderDrawer.active').count()) === 0);
  } else {
    check('dashboard: priority cards', true, 'SKIPPED — none rendered');
  }

  const kw = page.locator('#promoKillWidgetToggle');
  if (await kw.count()) {
    await kw.focus();
    check('dashboard: kill-widget toggle focusable', await kw.evaluate(el => document.activeElement === el));
  }

  // 3. Order rows — keyboard activation (use whichever tab has visible rows)
  let rowTab = null;
  // default window is yesterday→today; widen it or the check is data-dependent (0 rows some days)
  await page.evaluate(() => {
    const el = document.getElementById('orderFrom');
    if (el) { el.value = '2026-01-01'; el.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(1500);
  for (const t of ['orders', 'dashboard']) {
    await goTab(page, t);
    if (await page.locator(`#tab-${t} tr.premium-row-v4[tabindex]:visible`).count()) { rowTab = t; break; }
  }
  if (rowTab) {
    const row = page.locator(`#tab-${rowTab} tr.premium-row-v4[tabindex]:visible`).first();
    await row.focus();
    check(`rows(${rowTab}): row focusable`, await row.evaluate(el => document.activeElement === el));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    check(`rows(${rowTab}): Enter opens drawer`, (await page.locator('#orderDrawer.active').count()) > 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    check(`rows(${rowTab}): Escape closes drawer`, (await page.locator('#orderDrawer.active').count()) === 0);
  } else {
    check('rows: keyboard activation', false, 'no visible tr.premium-row-v4 in orders or dashboard');
  }

  // 4. POS (walkin) — nav switch by keyboard, category tabs, dish → modal focus lifecycle
  const navWalkin = page.locator('.nav-btn[data-tab="walkin"], .nav-item[data-tab="walkin"]').first();
  await navWalkin.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tab-walkin:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(1500);
  check('POS: nav button Enter switches tab', true);

  const cat = page.locator('#walkinCategoryTabs .category-tab:not(.active)').first();
  if (await cat.count()) {
    const target = (await cat.textContent())?.trim();
    await cat.focus();
    check('POS: category tab focusable', await cat.evaluate(el => document.activeElement === el));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    const active = (await page.locator('#walkinCategoryTabs .category-tab.active').first().textContent())?.trim();
    check('POS: category tab Enter activates', active === target, `active=${active} target=${target}`);
  } else {
    check('POS: category tabs', true, 'SKIPPED — only one category');
  }

  const dish = page.locator('.pos-dish-btn-v4:not([data-out-of-stock])').first();
  if (await dish.count()) {
    await dish.focus();
    check('POS: dish button focusable', await dish.evaluate(el => document.activeElement === el));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const modalOpen = await page.evaluate(() => {
      const m = document.getElementById('posSelectionModal');
      return m && !m.classList.contains('hidden');
    });
    check('POS: dish Enter opens selection modal', !!modalOpen);
    if (modalOpen) {
      check('POS: focus moved into modal', await page.evaluate(() =>
        document.getElementById('posSelectionModal').contains(document.activeElement)));
      const miss = await page.evaluate(() => [...document.querySelectorAll('#posSelectionModal [data-action]')]
        .filter(el => !el.hasAttribute('tabindex') && !el.matches('button, input, select')).length);
      check('POS: modal controls focusable', miss === 0, miss ? `${miss} missing tabindex` : 'all swept');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      const closed = await page.evaluate(() => document.getElementById('posSelectionModal')?.classList.contains('hidden'));
      check('POS: Escape closes modal', !!closed);
      const restored = await page.evaluate(() => document.activeElement?.classList.contains('pos-dish-btn-v4'));
      const ae = await page.evaluate(() => document.activeElement?.tagName + '.' + String(document.activeElement?.className).slice(0, 50));
      check('POS: focus restored to dish', !!restored, `activeElement=${ae}`);
    }
  } else {
    check('POS: dish buttons', false, 'no .pos-dish-btn-v4 found');
  }

  // 5. Expenses — sortable th keyboard activation (visible table, assert change)
  await goTab(page, 'expenses');
  const th = page.locator('th[data-sort]:visible').first();
  if (await th.count()) {
    await th.focus();
    check('expenses: th focusable', await th.evaluate(el => document.activeElement === el));
    const before = await th.evaluate(el => el.className);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    const after = await th.evaluate(el => el.className);
    check('expenses: th Enter sorts', after !== before, `before="${before}" after="${after}"`);
  } else {
    check('expenses: sortable headers', false, 'no visible th[data-sort]');
  }

  await page.screenshot({ path: path.join(OUT, 'final.png'), fullPage: false });
  await browser.close();

  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join('; ').slice(0, 200));
  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join('; ').slice(0, 200));

  const failed = checks.filter(c => !c.ok);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ checks, pageErrors, consoleErrors }, null, 2));
  console.log(`\n=== ${checks.length - failed.length}/${checks.length} passed ===`);
  if (failed.length) failed.forEach(f => console.log(`  FAIL: ${f.name} — ${f.detail}`));
  process.exit(failed.length ? 1 : 0);
};

run().catch(e => { console.error('FATAL', e); process.exit(2); });
