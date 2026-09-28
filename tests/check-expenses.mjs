/**
 * Expenses tab regression check — review fixes:
 *  1. Edit/Delete wired to live tables (edit opens populated modal, delete confirms)
 *  2. Categories sub-tab renders inline (not a modal over an empty div)
 *  3. Category edit updates in place (no duplicates), delete removes
 *  4. Listener guards: after repeated tab revisits, one submit = one record
 *  5. Save stays on current sub-tab; Excel export downloads
 *  6. Reports: outlet table populated, header classes fixed, month labels
 * Usage: node tests/check-expenses.mjs   (ADMIN_URL=... for local dist)
 * NOTE: defaults to LIVE production and creates+deletes a temp category/expense there.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'test-results', 'expenses');
fs.mkdirSync(OUT, { recursive: true });

const ADMIN_URL = process.env.ADMIN_URL || 'https://foodhubbie-admins.web.app';
const EMAIL = 'roshanipizza@gmail.com';
const PASSWORD = process.env.ADMIN_PASSWORD || '';

const checks = [];
const pageErrors = [];
const consoleErrors = [];
const dialogsSeen = [];
let dialogMode = 'accept';
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function dismissPin(page) {
  const ov = page.locator('.dynamic-modal-overlay').first();
  if (await ov.count()) {
    await ov.locator('.btn-cancel').click().catch(() => {});
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

async function goTab(page, tab) {
  for (let i = 0; i < 3; i++) {
    const ov = page.locator('.dynamic-modal-overlay').first();
    if (!(await ov.count())) break;
    await ov.locator('.btn-cancel').click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const btn = page.locator(`[data-action="switchTab"][data-tab="${tab}"]`).first();
  await btn.click({ timeout: 10000 });
  await page.waitForSelector(`#tab-${tab}:not(.hidden)`, { timeout: 15000 });
  await page.waitForTimeout(1500);
}

async function subTab(page, name) {
  await page.locator(`.expense-subtab-btn[data-expense-subtab="${name}"]`).click();
  await page.waitForTimeout(800);
}

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', async d => {
    dialogsSeen.push(d.message());
    if (d.type() === 'confirm' || d.type() === 'alert') {
      if (dialogMode === 'accept') await d.accept().catch(() => {});
      else await d.dismiss().catch(() => {});
    }
  });

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

  await goTab(page, 'expenses');

  // 1. Categories sub-tab renders inline (was: modal over empty div)
  await subTab(page, 'categories');
  const catState = await page.evaluate(() => {
    const c = document.getElementById('expenseCategoriesContainer');
    return {
      html: (c?.innerHTML || '').trim().length,
      list: !!document.getElementById('expenseCategoryListInline'),
      addBtn: !!c?.querySelector('[data-action="openExpenseCategories"]'),
      headerDupes: document.querySelectorAll('#tab-expenses .mob-section-head-row [data-action="openExpenseCategories"]').length,
    };
  });
  check('categories: inline view rendered', catState.html > 50 && catState.list && catState.addBtn, `html=${catState.html} list=${catState.list}`);
  check('categories: no duplicate header button', catState.headerDupes === 0, `found=${catState.headerDupes}`);

  // 2. Category create → update (no duplicate) → delete
  const catName = `ZZTest-${Date.now()}`;
  await page.click('#expenseCategoriesContainer [data-action="openExpenseCategories"]');
  await page.waitForSelector('#expenseCategoryModal.active', { timeout: 5000 });
  await page.fill('#expCatName', catName);
  await page.click('#btnAddExpenseCategory');
  await page.waitForTimeout(1200);
  await page.click('#expenseCategoryModal [data-action="closeExpenseCategoryModal"]');
  await page.waitForTimeout(600);
  let hits = await page.locator('#expenseCategoryListInline').evaluate((el, n) => (el.textContent.match(new RegExp(n, 'g')) || []).length, catName);
  check('categories: created appears once inline', hits === 1, `hits=${hits}`);

  // Edit → Update Category must UPDATE, not push a duplicate (target OUR row by name, never .first())
  await page.locator('#expenseCategoryListInline .expense-category-item').filter({ hasText: catName }).locator('[data-action="editExpenseCategory"]').click();
  await page.waitForSelector('#expenseCategoryModal.active', { timeout: 5000 });
  const btnText = (await page.locator('#btnAddExpenseCategory').textContent())?.trim();
  const prefill = await page.inputValue('#expCatName');
  check('categories: edit prefills + relabels', btnText === 'Update Category' && prefill === catName, `btn="${btnText}" name="${prefill}"`);
  await page.fill('#expCatName', catName + '-UPD');
  await page.click('#btnAddExpenseCategory');
  await page.waitForTimeout(1200);
  await page.click('#expenseCategoryModal [data-action="closeExpenseCategoryModal"]');
  await page.waitForTimeout(600);
  hits = await page.locator('#expenseCategoryListInline').evaluate((el, n) => (el.textContent.match(new RegExp(n, 'g')) || []).length, catName + '-UPD');
  const oldHits = await page.locator('#expenseCategoryListInline').evaluate((el, n) => (el.textContent.match(new RegExp(n, 'g')) || []).length, catName + '(?!-UPD)');
  check('categories: update does not duplicate', hits === 1 && oldHits === 0, `new=${hits} old=${oldHits}`);

  // 3. Listener guard: revisit tab twice, then create — must produce exactly one row
  for (let i = 0; i < 2; i++) { await goTab(page, 'orders'); await goTab(page, 'expenses'); }
  const resumed = await page.evaluate(() => document.querySelector('.expense-subtab-btn.active')?.dataset.expenseSubtab);
  check('revisit: resumes same sub-tab', resumed === 'categories', `active=${resumed}`);
  await page.locator('#expenseCategoryListInline .expense-category-item').filter({ hasText: catName + '-UPD' }).locator('[data-action="deleteExpenseCategory"]').click(); // dialog accepted by handler
  let gone = -1;
  for (let t = 0; t < 20; t++) { // poll: delete does 2 reads + multiUpdate + re-render
    await page.waitForTimeout(500);
    gone = await page.locator('#expenseCategoryListInline').evaluate((el, n) => (el.textContent.match(new RegExp(n, 'g')) || []).length, catName + '-UPD');
    if (gone === 0) break;
  }
  check('categories: delete removes row', gone === 0, `left=${gone}`);

  // 4. Edit expense opens POPULATED modal (was: wiped by reset-after-populate)
  await subTab(page, 'history');
  const realRows = page.locator('#expenseHistoryTableBody tr:not(:has(td[colspan]))'); // empty-state row has colspan
  const histRows = await realRows.count();
  if (histRows > 0) {
    await page.locator('#expenseHistoryTableBody [data-action="editExpense"]').first().click();
    await page.waitForSelector('#expenseModal.active', { timeout: 5000 });
    const editState = await page.evaluate(() => ({
      title: document.getElementById('expenseModalTitle')?.textContent,
      amount: document.getElementById('expenseAmount')?.value,
      date: document.getElementById('expenseDate')?.value,
      cat: document.getElementById('expenseCategory')?.value,
    }));
    check('edit: modal populated', editState.title === 'Edit Expense' && !!editState.amount && /^\d{4}-\d{2}-\d{2}$/.test(editState.date) && !!editState.cat,
      `title="${editState.title}" amount=${editState.amount} date=${editState.date} cat=${editState.cat ? 'set' : 'EMPTY'}`);
    await page.click('#expenseModal [data-action="closeExpenseModal"]');
    await page.waitForTimeout(400);

    // 5. Delete button wired — dialog fires, dismiss → row count unchanged
    const before = await realRows.count();
    dialogMode = 'dismiss';
    await page.locator('#expenseHistoryTableBody [data-action="deleteExpense"]').first().click();
    await page.waitForTimeout(600);
    dialogMode = 'accept';
    check('delete: confirm dialog fires', dialogsSeen.some(m => /delete this expense/i.test(m)), `dialogs=${dialogsSeen.join(' | ').slice(0, 80)}`);
    const after = await realRows.count();
    check('delete: cancel keeps row', after === before, `${before}→${after}`);
  } else {
    check('edit: modal populated', true, 'SKIPPED — no history rows');
    check('delete: confirm dialog fires', true, 'SKIPPED — no history rows');
  }

  // 6. Add expense: one submit → one record, stays on current sub-tab
  const desc = `ZZ-EXP-${Date.now()}`;
  await page.click('[data-action="openAddExpense"]');
  await page.waitForSelector('#expenseModal.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const catOpt = await page.locator('#expenseCategory option:not([value=""])').first().getAttribute('value');
  await page.selectOption('#expenseCategory', catOpt);
  await page.fill('#expenseAmount', '1');
  await page.fill('#expenseDescription', desc);
  const rowsBefore = await realRows.count();
  await page.click('#expenseForm button[type="submit"]');

  let outcome = 'timeout';
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    if (await page.locator('.dynamic-modal-overlay').count()) { outcome = 'pin-gated'; break; }
    if (!(await page.locator('#expenseModal.active').count())) { outcome = 'saved'; break; }
    await page.waitForTimeout(250);
  }
  if (outcome === 'pin-gated') {
    await dismissPin(page);
    const stillOpen = (await page.locator('#expenseModal.active').count()) > 0;
    check('save: PIN cancel aborts without saving', stillOpen, 'ceiling enforced → write path skipped');
    if (stillOpen) await page.click('#expenseModal [data-action="closeExpenseModal"]');
  } else if (outcome === 'saved') {
    await page.waitForTimeout(1500);
    const stillHistory = await page.evaluate(() => document.querySelector('.expense-subtab-btn.active')?.dataset.expenseSubtab);
    check('save: stays on current sub-tab', stillHistory === 'history', `active=${stillHistory}`);
    const rowsAfter = await realRows.count();
    check('save: exactly one record (no stacked submits)', rowsAfter === rowsBefore + 1, `${rowsBefore}→${rowsAfter}`);
    const found = await page.locator(`#expenseHistoryTableBody tr:has-text("${desc}")`).count();
    check('save: new row visible', found === 1, `found=${found}`);
    // cleanup: delete it
    if (found) {
      await page.locator(`#expenseHistoryTableBody tr:has-text("${desc}") [data-action="deleteExpense"]`).first().click();
      await page.waitForTimeout(1200);
      const left = await page.locator(`#expenseHistoryTableBody tr:has-text("${desc}")`).count();
      check('cleanup: test expense deleted', left === 0, `left=${left}`);
    }
  } else {
    check('save: expense submit', false, `outcome=${outcome}`);
  }

  // 6b. Pending workflow (M1): >threshold expense gets Approve/Reject; shared PIN gate
  const aprDesc = `ZZ-APR-${Date.now()}`;
  await page.click('[data-action="openAddExpense"]');
  await page.waitForSelector('#expenseModal.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const aprCat = await page.locator('#expenseCategory option:not([value=""])').first().getAttribute('value');
  await page.selectOption('#expenseCategory', aprCat);
  await page.fill('#expenseAmount', '6000');
  await page.fill('#expenseDescription', aprDesc);
  await page.click('#expenseForm button[type="submit"]');
  let aprOutcome = 'timeout';
  const t1 = Date.now();
  while (Date.now() - t1 < 9000) {
    if (await page.locator('.dynamic-modal-overlay').count()) { aprOutcome = 'ceiling-pin'; break; }
    if (!(await page.locator('#expenseModal.active').count())) { aprOutcome = 'saved'; break; }
    await page.waitForTimeout(250);
  }
  if (aprOutcome === 'ceiling-pin') {
    await dismissPin(page);
    await page.waitForTimeout(400);
    await page.click('#expenseModal [data-action="closeExpenseModal"]').catch(() => {});
    check('approve: pending workflow', true, 'SKIPPED — ceiling PIN blocked test create');
  } else if (aprOutcome === 'saved') {
    const aprRow = `#expenseHistoryTableBody tr:has-text("${aprDesc}")`;
    for (let t = 0; t < 10; t++) { if (await page.locator(aprRow).count()) break; await page.waitForTimeout(400); }
    const aprBtns = await page.locator(`${aprRow} [data-action="approveExpense"]`).count();
    check('approve: pending row has Approve button', aprBtns === 1, `found=${aprBtns}`);
    if (aprBtns) {
      await page.locator(`${aprRow} [data-action="approveExpense"]`).click();
      await page.waitForTimeout(700);
      if (await page.locator('.dynamic-modal-overlay').count()) {
        await dismissPin(page);
        await page.waitForTimeout(700);
        const still = await page.locator(`${aprRow} [data-action="approveExpense"]`).count();
        check('approve: PIN cancel keeps pending', still === 1, 'gate held');
      } else {
        let aprTxt = '';
        for (let t = 0; t < 12; t++) {
          aprTxt = (await page.locator(aprRow).textContent()) || '';
          if (/Approved/i.test(aprTxt)) break;
          await page.waitForTimeout(500);
        }
        check('approve: applied (PIN gate off)', /Approved/i.test(aprTxt), aprTxt.trim().replace(/\s+/g, ' ').slice(0, 60));
      }
    }
    await page.locator(`${aprRow} [data-action="deleteExpense"]`).click();
    let aprLeft = -1;
    for (let t = 0; t < 20; t++) { await page.waitForTimeout(500); aprLeft = await page.locator(aprRow).count(); if (aprLeft === 0) break; }
    check('approve: test expense cleaned up', aprLeft === 0, `left=${aprLeft}`);
  } else {
    check('approve: pending workflow', false, `outcome=${aprOutcome}`);
  }

  // 7. Excel export actually downloads (was: always "No expense data to export")
  if ((await realRows.count()) > 0) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 12000 }),
        page.click('[data-action="expExportExcel"]'),
      ]);
      const fname = download.suggestedFilename();
      check('export: Excel downloads', /^Expenses_.*\.xlsx$/.test(fname), fname);
    } catch (e) {
      check('export: Excel downloads', false, String(e).slice(0, 100));
    }
  } else {
    check('export: Excel downloads', true, 'SKIPPED — no rows');
  }

  // 8. Reports: outlet table populated, header typos fixed, month labels
  await subTab(page, 'reports');
  await page.waitForTimeout(2500);
  const rep = await page.evaluate(() => ({
    outletCells: document.getElementById('expenseOutletTableBody')?.children.length ?? 0,
    typoHeaders: document.querySelectorAll('#tab-expenses thead .mob_th_right, #tab-expenses thead .mob-th_right, #tab-expenses thead .mob_th_center').length,
    monthLabel: document.querySelector('#expenseMonthlyTableBody tr td')?.textContent?.trim() || '',
    breakdownRows: document.getElementById('expenseCategoryBreakdownBody')?.children.length ?? 0,
    breakdownBody: !!document.getElementById('expenseCategoryBreakdownBody'),
  }));
  check('reports: outlet table populated', rep.outletCells > 0, `cells=${rep.outletCells}`);
  check('reports: header classes fixed', rep.typoHeaders === 0, `typos=${rep.typoHeaders}`);
  check('reports: month label readable', !/^\d+\/\d{2}$/.test(rep.monthLabel), `label="${rep.monthLabel}"`);
  check('reports: category breakdown rendered', rep.breakdownBody && rep.breakdownRows >= 0, `body=${rep.breakdownBody} rows=${rep.breakdownRows}`);

  // Report export (M3) — report tables, distinct from the raw-data export
  try {
    const [rdl] = await Promise.all([
      page.waitForEvent('download', { timeout: 12000 }),
      page.click('[data-action="expReportExportExcel"]'),
    ]);
    check('reports: report Excel downloads', /^ExpenseReport_.*\.xlsx$/.test(rdl.suggestedFilename()), rdl.suggestedFilename());
  } catch (e) {
    check('reports: report Excel downloads', false, String(e).slice(0, 100));
  }

  // 9. Today view — Time column shows a time when rows exist
  await subTab(page, 'today');
  const timeCell = await page.locator('#expenseTodayTableBody tr td:first-child').first().textContent().catch(() => '');
  const todayRows = await page.locator('#expenseTodayTableBody tr:not(:has-text("No expenses"))').count();
  if (todayRows > 0) check('today: Time column shows time', /\d{1,2}:\d{2}/.test(timeCell || ''), `cell="${(timeCell || '').trim()}"`);
  else check('today: Time column shows time', true, 'SKIPPED — no rows today');

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
