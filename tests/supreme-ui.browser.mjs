// Supreme Admin dense UI pass: list screens (summary strip, chips with counts, sortable columns, search),
// Agents problems-first, Payments row click, Onboarding filters, Profile tabs, phone layout, view-only role.
// Runs the REAL SupremeAdmin files in headless Chromium against an in-memory Firebase stand-in (no network).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { openSupreme } from './supreme-harness.mjs';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PW || 'playwright')); }

const browser = await chromium.launch();
let n = 0; const ok = (m) => console.log(`ok ${++n} - ${m}`);
const rows = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const nav = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(700); };
const click = async (page, sel) => { await page.click(sel); await page.waitForTimeout(250); };

try {
  // ---------- Restaurants ----------
  let { page, errors } = await openSupreme(browser, { hash: '#restaurants' });
  assert.equal((await page.$$('#restaurant-tbody tr.row-link')).length, 13, '13 active outlets');
  const stats = await rows(page, '#restaurant-stats .stat');
  assert.match(stats[0], /Total outlets 13/); assert.match(stats[2], /Needs attention 2/);
  ok('summary strip counts');
  // Tab counts are real on both tabs (they used to render only for the current one).
  assert.equal((await page.textContent('#tab-count-active')).trim(), '13');
  assert.equal((await page.textContent('#tab-count-disabled')).trim(), '1');
  // The WhatsApp KPI and the Not-connected chip must agree, and clicking the
  // KPI must filter to connected rows (it used to filter to the opposite set).
  const connected = Number((stats[1].match(/WhatsApp connected (\d+)/) || [])[1]);
  assert.ok(connected > 0 && connected < 13, 'seed has a mix: ' + connected);
  const notConn = Number((await page.textContent('#restaurant-chips [data-chip=notconn] .chip-count')).trim());
  assert.equal(connected + notConn, 13, 'KPI + Not connected = total');
  await click(page, '#restaurant-stats [data-action=rl-chip][data-chip=conn]');
  assert.equal((await page.$$('#restaurant-tbody tr.row-link')).length, connected);
  await click(page, '#restaurant-chips [data-chip=all]');
  ok('WhatsApp KPI agrees with its chip and filters to connected rows');
  await click(page, '#restaurant-chips [data-chip=attention]');
  let names = await rows(page, '#restaurant-tbody tr .cell-strong');
  assert.deepEqual(names.sort(), ['Cafe Mocha · MG Road', 'Spice Route · Koramangala']);
  assert.match(await page.textContent('#restaurant-count'), /Showing 2 of 13/);
  ok('Needs attention chip filters to the errored + offline outlets');
  await click(page, '#restaurant-chips [data-chip=all]');
  await click(page, '[data-action=rl-sort][data-key=name]');
  names = await rows(page, '#restaurant-tbody tr .cell-strong');
  assert.equal(names[0], 'Tiffin Express · Malleshwaram', 'second click on Outlet sorts Z→A');
  assert.equal(await page.getAttribute('th.th-sort:first-child', 'aria-sort'), 'descending');
  ok('click header sorts, aria-sort follows');
  // Keyboard: the header/chips are rebuilt on every sort/filter, so focus must be restored.
  await page.focus('[data-action=rl-sort][data-key=name]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.key), 'name');
  await page.focus('#restaurant-chips [data-chip=attention]');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.chip), 'attention');
  await click(page, '#restaurant-chips [data-chip=all]');
  ok('sorting and filtering keep keyboard focus on the control');
  await page.fill('#restaurant-search', 'biryani'); await page.waitForTimeout(300);
  assert.equal((await page.$$('#restaurant-tbody tr.row-link')).length, 3);
  ok('search narrows rows');
  await page.fill('#restaurant-search', 'b3'); await page.waitForTimeout(300);
  assert.equal((await page.$$('#restaurant-tbody tr.row-link')).length, 3);
  await page.fill('#restaurant-search', 'o5'); await page.waitForTimeout(300);
  assert.equal((await page.$$('#restaurant-tbody tr.row-link')).length, 1);
  ok('search finds a tenant by business id / outlet id (what a support hand-off quotes)');
  await page.fill('#restaurant-search', 'biryani'); await page.waitForTimeout(300);
  await click(page, '#restaurant-tbody tr.row-link');
  assert.match(page.url(), /#profile\/b3\//); ok('row click opens profile');
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join('|'));

  // disabled tab + Reactivate (this used to throw: showToast was never imported)
  ({ page, errors } = await openSupreme(browser, { hash: '#restaurants' }));
  await click(page, '[data-action=list-tab][data-tab=disabled]');
  assert.equal((await page.$$('#restaurant-tbody tr.row-disabled')).length, 1);
  await click(page, '[data-action=reactivate-outlet]');
  await click(page, '#confirm-modal [data-confirm=ok]'); await page.waitForTimeout(500);
  assert.match(await page.textContent('#toast-root'), /is active again/);
  assert.deepEqual(errors.filter((e) => /showToast/.test(e)), []);
  ok('Reactivate shows its success message (missing import fixed)');
  await page.context().close();

  // ---------- Agents ----------
  ({ page, errors } = await openSupreme(browser, { hash: '#agents' }));
  const cards = await rows(page, '.fleet-card .fleet-outlet-name');
  assert.equal(cards.length, 13); assert.equal(cards[0], 'Spice Route · Koramangala', 'errored first');
  ok('problems-first default order');
  await click(page, '#fleet-chips [data-chip=down]');
  assert.equal((await page.$$('.fleet-card')).length, 2); ok('Down chip');
  await click(page, '#fleet-select-all');
  assert.match(await page.textContent('#bulk-count'), /2 selected/); ok('select all shown → bulk bar');
  await page.fill('#fleet-search', 'mocha'); await page.waitForTimeout(250);
  assert.equal((await page.$$('.fleet-card')).length, 1); ok('agent search');
  assert.deepEqual(errors, []);
  await page.context().close();

  // ---------- Payments ----------
  ({ page, errors } = await openSupreme(browser, { hash: '#payments' }));
  const first = (await rows(page, '#pay-tbody tr .cell-strong'))[0];
  assert.equal(first, 'Biryani Bazaar · Whitefield', 'largest due first');
  await click(page, '[data-action=pay-plan][data-plan=starter]');
  assert.equal((await page.$$('#pay-tbody tr.row-link')).length, 5, 'starter has 5 outlets');
  assert.equal(await page.$eval('#pay-plan-filter', (e) => e.value), 'starter'); ok('due-by-plan chip filters + syncs the plan select');
  await click(page, '[data-action=pay-plan][data-plan=starter]');
  await click(page, '#pay-status-chips [data-chip=owing]');
  assert.equal((await page.$$('#pay-tbody tr.row-link')).length, 5); ok('Owing chip');
  await click(page, '#pay-tbody tr.row-link');
  assert.match(page.url(), /#payments\/b\d\/o\d+/); ok('row click opens payment record');
  assert.deepEqual(errors, []);
  await page.context().close();

  // ---------- Onboarding ----------
  ({ page, errors } = await openSupreme(browser, { hash: '#onboarding' }));
  assert.equal((await page.$$('#ob-table tbody tr')).length, 3);
  await click(page, '#ob-stats [data-filter=approved]');
  assert.equal((await page.$$('#ob-table tbody tr')).length, 1);
  await click(page, '#ob-stats [data-filter=all]');
  assert.equal((await page.$$('#ob-table tbody tr')).length, 6); ok('onboarding summary tiles filter');
  assert.deepEqual(errors, []);
  await page.context().close();

  // ---------- Profile tabs ----------
  ({ page, errors } = await openSupreme(browser, { hash: '#profile/b1/o2' }));
  assert.equal(await page.$$eval('.pf-pane', (e) => e.every((x) => x.parentElement.id === 'profile-content')), true, 'panes are siblings (markup balanced)');
  assert.equal(await page.$$eval('.pf-pane.active', (e) => e.length), 1);
  await page.evaluate(() => { document.querySelector('[data-pane=access]').dataset.marker = 'same-node'; });
  await click(page, '[data-action=profile-tab][data-tab=access]');
  assert.equal(await page.$eval('[data-pane=access]', (e) => e.dataset.marker), 'same-node', 'switching tabs does not re-render');
  assert.ok(await page.isVisible('#tabpanel-access')); assert.ok(!(await page.isVisible('#tabpanel-overview')));
  assert.match(page.url(), /\/access$/);
  ok('tabs switch panes in place and update the URL');
  await click(page, '[data-action=profile-tab][data-tab=billing]');
  assert.ok(await page.isVisible('#billing-body'));
  await click(page, '[data-action=profile-tab][data-tab=whatsapp]');
  assert.ok(await page.isVisible('#whatsapp-body')); ok('Billing and WhatsApp panes show their content');
  await click(page, '[data-action=profile-tab][data-tab=analytics]');
  assert.ok(await page.$('#pa-root')); ok('Analytics tab still loads');
  await page.context().close();
  ({ page, errors } = await openSupreme(browser, { hash: '#profile/b1/o2/billing' }));
  assert.ok(await page.isVisible('#tabpanel-billing')); ok('deep link opens the right tab');
  assert.deepEqual(errors, []);
  // edit draft survives a data tick
  await click(page, '[data-action=profile-tab][data-tab=overview]');
  await click(page, '[data-action=edit-detail]');
  const inp = await page.$('#tabpanel-overview input[type=text], #tabpanel-overview input:not([type])');
  assert.ok(inp, 'edit form shows'); ok('edit form opens inside Overview');
  // A live data tick must not lose a half-typed edit or jump panes.
  await page.fill('[data-detail=businessName]', 'Half Typed');
  await page.evaluate(() => firebase.database().ref('businesses/b1/outlets/o2/botStatus/updatedAt').set(Date.now()));
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue('[data-detail=businessName]'), 'Half Typed');
  assert.ok(await page.isVisible('#tabpanel-overview'));
  ok('half-typed edit survives a live re-render tick');
  await page.context().close();

  // Header badge: a paired Baileys outlet is "connected" (same rule as the list KPI).
  ({ page, errors } = await openSupreme(browser, { hash: '#profile/b2/o3' }));
  assert.match(await page.textContent('#profile-content .panel-sub'), /WhatsApp connected/);
  assert.doesNotMatch(await page.textContent('#profile-content .panel-sub'), /not connected/);
  ok('profile header says connected for a baileys-online outlet');
  assert.deepEqual(errors, []);
  await page.context().close();

  // ---------- Phone ----------
  for (const h of ['#restaurants', '#agents', '#payments', '#onboarding', '#profile/b1/o2', '#profile/b1/o2/billing', '#profile/b1/o2/whatsapp', '#profile/b1/o2/access']) {
    ({ page, errors } = await openSupreme(browser, { width: 390, height: 844, hash: h }));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `${h}: page scrolls sideways by ${over}px`);
    assert.deepEqual(errors, [], h);
    await page.context().close();
  }
  ({ page } = await openSupreme(browser, { width: 390, height: 844, hash: '#restaurants' }));
  assert.equal(await page.$eval('#restaurant-table .col-sec', (e) => getComputedStyle(e).display), 'none');
  assert.ok((await page.textContent('#restaurant-tbody tr .sub')).includes('·'));
  ok('phone: no sideways page scroll on 8 screens; secondary columns fold into the sub-line');
  await page.context().close();

  // ---------- View-only role ----------
  ({ page, errors } = await openSupreme(browser, { role: 'support', hash: '#restaurants' }));
  assert.equal((await page.$$('[data-action=go-onboard]')).length, 0); ok('view-only: no Add Restaurant');
  await nav(page, '#agents');
  assert.equal((await page.$$('#fleet-select-all')).length, 0);
  assert.equal((await page.$$('.fleet-card-select')).length, 0); ok('view-only: no bulk select on Agents');
  await nav(page, '#onboarding');
  await click(page, '#ob-stats [data-filter=pending]');
  assert.equal((await page.$$('[data-action=ob-approve]')).length, 0); ok('view-only: no Approve/Reject');
  assert.deepEqual(errors, []);
  await page.context().close();
  console.log(`\nAll ${n} Supreme UI checks passed.`);
} finally { await browser.close(); }
