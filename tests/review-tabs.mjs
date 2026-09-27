/**
 * Review script: Discount Ceiling-PIN, Analytics, POS Control, Settings sub-tabs.
 * Usage: node tests/review-tabs.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'test-results', 'review');
fs.mkdirSync(OUT, { recursive: true });

const ADMIN_URL = process.env.ADMIN_URL || 'https://foodhubbie-admins.web.app';
const EMAIL = 'roshanipizza@gmail.com';
const PASSWORD = 'REDACTED-PASSWORD-ROTATE-ME';

const log = (...a) => console.log('[Review]', ...a);

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log('shot:', name);
}

async function safeText(page, selector) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return null;
  try { return (await el.textContent({ timeout: 3000 }))?.trim() || null; } catch { return null; }
}

async function safeValue(page, selector) {
  const el = page.locator(selector).first();
  if (!(await el.count())) return null;
  try { return await el.inputValue({ timeout: 3000 }); } catch { return null; }
}

async function login(page) {
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginEmail', { timeout: 30000 });
  await page.fill('#loginEmail', EMAIL);
  await page.fill('#loginPassword', PASSWORD);
  await page.click('#loginBtn');
  await page.waitForSelector('.layout:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(2500);
  // Clear SW + caches so stale JS can't mask/cause results
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    }
    if ('caches' in window) {
      for (const k of await caches.keys()) await caches.delete(k);
    }
  });
  log('logged in');
}

async function dismissModals(page) {
  // Close any blocking dynamic modal (PIN prompt, confirm, etc.)
  for (let i = 0; i < 3; i++) {
    const ov = page.locator('.dynamic-modal-overlay').first();
    if (!(await ov.count())) return true;
    const cancel = ov.locator('.btn-cancel');
    if (await cancel.count()) {
      await cancel.click().catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(400);
  }
  return !(await page.locator('.dynamic-modal-overlay').count());
}

async function goTab(page, tab) {
  await dismissModals(page);
  const btn = page.locator(`[data-action="switchTab"][data-tab="${tab}"]`).first();
  await btn.click({ timeout: 10000 });
  await page.waitForSelector(`#tab-${tab}:not(.hidden)`, { timeout: 15000 });
  await page.waitForTimeout(2000);
  await dismissModals(page);
}

// ── 1. Discount Ceiling – PIN ──────────────────────────────────
async function reviewDiscountPin(page) {
  log('=== Discount Ceiling - PIN ===');
  await goTab(page, 'settings');

  // Features sub-tab holds the ceiling + manager PIN gate
  const feat = page.locator('[data-subtab="features"]');
  if (await feat.count()) {
    await feat.click();
    await page.waitForTimeout(800);
  }
  await shot(page, '01-settings-features-ceiling');

  const report = {
    featureToggle: {
      exists: await page.locator('#featureDiscountApproval').count(),
      checked: await page.locator('#featureDiscountApproval').isChecked().catch(() => null),
      statusText: await safeText(page, '#featureDiscountStatus'),
    },
    ceilingPct: {
      exists: await page.locator('#settingDiscCeilingPct').count(),
      value: await safeValue(page, '#settingDiscCeilingPct'),
      disabled: await page.locator('#settingDiscCeilingPct').isDisabled().catch(() => null),
    },
    managerPin: {
      exists: await page.locator('#settingManagerPin').count(),
      placeholder: await page.locator('#settingManagerPin').getAttribute('placeholder').catch(() => null),
      disabled: await page.locator('#settingManagerPin').isDisabled().catch(() => null),
    },
  };

  // Console errors captured? (skip — collected globally)
  log('features report:', JSON.stringify(report, null, 2));
  return report;
}

// ── 2. Analytics tab ───────────────────────────────────────────
async function reviewAnalytics(page) {
  log('=== Analytics tab ===');
  await goTab(page, 'reports');
  await shot(page, '02-analytics-tab');

  const report = {
    visible: await page.locator('#tab-reports').isVisible().catch(() => false),
    heading: await safeText(page, '#tab-reports h2'),
    dateInputs: await page.locator('#tab-reports input[type="date"]').count(),
    genBtn: await page.locator('#tab-reports [id*="Generate"], #tab-reports button:has-text("Generate")').count(),
    chartCanvas: await page.locator('#tab-reports canvas').count(),
    emptyState: await safeText(page, '#tab-reports .empty-state, #tab-reports .text-muted'),
    // console errors seen on this tab are appended later
  };
  log('analytics report:', JSON.stringify(report, null, 2));
  return report;
}

// ── 3. Control tab (POS) ───────────────────────────────────────
async function reviewControl(page) {
  log('=== POS Control tab ===');
  await dismissModals(page);
  const btn = page.locator('[data-action="switchTab"][data-tab="walkin"]').first();
  await btn.click({ timeout: 10000 });
  await page.waitForSelector('#tab-walkin:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Shift Sign-In PIN modal auto-opens on POS entry — record it before dismissing
  const modalOverlay = page.locator('.dynamic-modal-overlay').first();
  const modalInfo = {
    appeared: await modalOverlay.count() > 0,
    title: await safeText(page, '.dynamic-modal-overlay .dynamic-modal-title'),
    message: await safeText(page, '.dynamic-modal-overlay .dynamic-modal-text'),
    placeholder: await page.locator('.dynamic-modal-overlay .dynamic-modal-input').getAttribute('placeholder').catch(() => null),
  };
  if (modalInfo.appeared) await shot(page, '03a-pos-shift-signin-modal');
  await dismissModals(page);
  await page.waitForTimeout(1500);
  await shot(page, '03-pos-control-tab');

  const report = {
    shiftSignInModal: modalInfo,
    visible: await page.locator('#tab-walkin').isVisible().catch(() => false),
    heading: await safeText(page, '#tab-walkin h2'),
    cartArea: await page.locator('#tab-walkin [id*="cart"], #tab-walkin .cart').count(),
    menuGrid: await page.locator('#tab-walkin .dish-card, #tab-walkin [id*="posMenu"], #tab-walkin [class*="menu-grid"]').count(),
    settleBtn: await page.locator('#tab-walkin button:has-text("Settle"), #tab-walkin button:has-text("Pay")').count(),
    payNowBtn: await page.locator('#tab-walkin button:has-text("PAY")').count(),
  };
  log('control report:', JSON.stringify(report, null, 2));
  return report;
}

// ── 3b. Expenses tab (regression: _updateTabCounts ghost call) ─
async function reviewExpenses(page) {
  log('=== Expenses tab ===');
  const nav = page.locator('#nav-expenses');
  if (!(await nav.count()) || !(await nav.isVisible().catch(() => false))) {
    log('expenses nav hidden (feature off) — skipped');
    return { skipped: true };
  }
  await goTab(page, 'expenses');
  await shot(page, '03b-expenses-tab');
  const report = {
    todayTotal: await safeText(page, '#expenseTodayTotal'),
    subtabBtns: await page.locator('.expense-subtab-btn').count(),
    loadErrorToast: await page.locator('text=Failed to load expenses').count(),
    xlsxLoaded: await page.evaluate(() => typeof window.XLSX !== 'undefined'),
  };
  // Export buttons must fit inside the CARD (regression: clipped header)
  const card = await page.locator('#tab-expenses .mob-table-card').first().boundingBox().catch(() => null);
  report.card = card ? { x: Math.round(card.x), right: Math.round(card.x + card.width) } : null;
  for (const [name, sel] of [['excel', '[data-action="expExportExcel"]'], ['pdf', '[data-action="expExportPDF"]']]) {
    const box = await page.locator(sel).first().boundingBox().catch(() => null);
    report[name] = box
      ? { x: Math.round(box.x), right: Math.round(box.x + box.width), y: Math.round(box.y), insideCard: !!card && (box.x + box.width) <= (card.x + card.width) + 1 }
      : null;
  }
  log('expenses report:', JSON.stringify(report));
  return report;
}

// ── 4. Settings + sub-tabs ─────────────────────────────────────
const SUBTABS = [
  'general', 'tax-services', 'whatsapp-bot', 'marketing', 'delivery-fee',
  'receipt-dev', 'qr-menu-offer', 'features', 'staff-management', 'security-audit',
];

async function reviewSettings(page) {
  log('=== Settings sub-tabs ===');
  await goTab(page, 'settings');
  const report = [];

  for (const st of SUBTABS) {
    const btn = page.locator(`[data-subtab="${st}"]`);
    if (!(await btn.count())) {
      report.push({ subtab: st, found: false });
      log('MISSING subtab:', st);
      continue;
    }
    await btn.click();
    await page.waitForTimeout(700);
    await dismissModals(page);

    const section = page.locator(`[data-settings-section="${st}"]`).first();
    const visible = await section.count() ? await section.isVisible().catch(() => false) : false;
    await shot(page, `04-settings-${st}`);

    const entry = {
      subtab: st,
      found: true,
      sectionVisible: visible,
      inputs: await page.locator(`[data-settings-section="${st}"] input, [data-settings-section="${st}"] select, [data-settings-section="${st}"] textarea`).count(),
      buttons: await page.locator(`[data-settings-section="${st}"] button`).count(),
      // dynamic content containers
      lists: await page.locator(`[data-settings-section="${st}"] tbody, [data-settings-section="${st}"] [class*="list"], [data-settings-section="${st}"] table`).count(),
    };
    report.push(entry);
    log('subtab:', st, JSON.stringify(entry));
  }
  return report;
}

// ── main ───────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text() + ' @ ' + m.location().url); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('requestfailed', r => consoleErrors.push('REQFAIL ' + r.url() + ' ' + (r.failure() || {}).errorText));

  const results = { timestamp: new Date().toISOString() };

  try {
    await login(page);
    // BEFORE any Settings visit: feature-gated nav must already reflect boot-time flags
    results.expensesNavAtBoot = await page.locator('#nav-expenses').isVisible().catch(() => false);
    log('expenses nav at boot:', results.expensesNavAtBoot);
    results.discountPin = await reviewDiscountPin(page);
    results.analytics = await reviewAnalytics(page);
    results.control = await reviewControl(page);
    results.expenses = await reviewExpenses(page);
    results.settingsSubtabs = await reviewSettings(page);
  } catch (e) {
    results.fatal = String(e);
    log('FATAL:', e);
    await shot(page, 'fatal');
  }

  results.pageErrors = pageErrors;
  results.consoleErrors = consoleErrors.slice(0, 40);

  const outFile = path.join(OUT, 'report.json');
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  log('written:', outFile);

  await browser.close();
  if (results.fatal) process.exit(1);
})();
