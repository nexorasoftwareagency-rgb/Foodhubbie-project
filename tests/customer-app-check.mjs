/**
 * Customer APP tab guard (static).
 *
 * Covers all 4 sub-tabs across P0-P5 enhancements:
 *   - Push Notifications (P0/P1: search, drafts, templates, keyboard, undo)
 *   - Promo Page Offers (P2: search/filter/sort, bulk toolbar, quick edit, preview)
 *   - App Visibility (P3: search/filter/sort, stock badges, featured, bulk toolbar)
 *   - App Settings (P4: validation, dirty tracking, debounce save, new sections)
 *   - Cross-cutting (P5: audit trail, role gating, keyboard shortcuts)
 *
 * Two classes of bugs this guard catches:
 *   1. a DOM id the module looks up is missing from Admin/index.html
 *   2. a JS function/constant/CSS literal is missing (PurgeCSS strips non-literals)
 *
 * Run: node tests/customer-app-check.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'Admin/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'Admin/js/features/customer-app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'Admin/style.css'), 'utf8');
const uiJs = fs.readFileSync(path.join(root, 'Admin/js/ui.js'), 'utf8');
const appNotifJs = fs.readFileSync(path.join(root, 'Admin/js/features/app-notifications.js'), 'utf8');

let failed = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); } };

const KNOWN_DUPES = new Set([
    'receiptPreviewModal', 'receiptPreviewContainer',
    // P2 bulk toolbar ids shared with combos tab
    'btnBulkEnable', 'btnBulkDisable', 'btnBulkDelete', 'btnBulkCancel',
    // P2/P3 quick edit cancel (header + footer in same modal)
    'btnQuickEditCancel',
    // P2/P3 preview close (header + footer in same modal)
    'btnPreviewClose', 'btnVisPreviewClose',
]);

// =====================================================================
// STRUCTURAL: HTML integrity
// =====================================================================

t('no duplicate DOM ids in Admin/index.html', () => {
    const counts = new Map();
    for (const m of html.matchAll(/\sid="([^"]+)"/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    const dupes = [...counts].filter(([id, n]) => n > 1 && !KNOWN_DUPES.has(id)).map(([id, n]) => `${id} x${n}`);
    assert.deepEqual(dupes, [], 'duplicate ids: ' + dupes.join(', '));
});

t('every tab pane shares one parent (nothing swallows the panes below it)', () => {
    const src = html.replace(/<!--[\s\S]*?-->/g, '');
    const stack = [];
    const panes = [];
    const re = /<(div|section)\b[^>]*>|<\/(div|section)>/gi;
    let m;
    while ((m = re.exec(src))) {
        if (m[1]) {
            const attrs = m[0];
            const id = attrs.match(/\bid="(tab-[a-z-]+|caPane[a-z]+)"/);
            if (id) panes.push({ id: id[1], depth: stack.length, parent: stack[stack.length - 1] || '(root)' });
            stack.push(m[1].toLowerCase());
        } else {
            stack.pop();
        }
    }
    assert.equal(stack.length, 0, 'unbalanced <div>/<section> in Admin/index.html');
    assert.ok(panes.length >= 10, 'expected every pane, saw ' + panes.length);
    const parents = new Set(panes.map(p => p.parent + '@' + p.depth));
    assert.equal(parents.size, 1, 'panes split across parents: ' + panes.filter(p => p.parent + '@' + p.depth !== [...parents][0]).map(p => `${p.id}=${p.parent}@${p.depth}`).join(', '));
});

// =====================================================================
// PANE 1: Push Notifications (P0/P1)
// =====================================================================

t('P1: subscriber search/filter elements exist', () => {
    for (const id of ['pushSubSearch', 'pushSubFilterCount', 'pushSubsSection']) {
        assert.ok(html.includes(`id="${id}"`), `missing id: ${id}`);
    }
    // filter radios
    for (const val of ['all', 'offers', 'no-offers', 'recent']) {
        assert.ok(html.includes(`value="${val}"`) && html.includes('name="pushSubFilter"'), `missing filter radio: ${val}`);
    }
});

t('P1: draft auto-save/restore functions exist', () => {
    assert.ok(appNotifJs.includes('function _saveDraft'), '_saveDraft must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _loadDraft'), '_loadDraft must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _clearDraft'), '_clearDraft must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('fh:pushDraft:'), 'draft storage key must be outlet-scoped');
    assert.ok(appNotifJs.includes('localStorage.setItem'), 'draft must write to localStorage');
    assert.ok(appNotifJs.includes('localStorage.getItem'), 'draft must read from localStorage');
});

t('P1: templates library functions exist', () => {
    assert.ok(appNotifJs.includes('function _loadTemplates'), '_loadTemplates must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _saveTemplates'), '_saveTemplates must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _insertTemplate'), '_insertTemplate must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _saveTemplate'), '_saveTemplate must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _deleteTemplate'), '_deleteTemplate must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _openTemplatesModal'), '_openTemplatesModal must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('fh:pushTemplates:'), 'template storage key must be outlet-scoped');
});

t('P1: keyboard shortcuts wired', () => {
    assert.ok(appNotifJs.includes('function _wireKeyboard'), '_wireKeyboard must exist in app-notifications.js');
    assert.ok(/Ctrl\+Enter/.test(appNotifJs) || /e\.ctrlKey\s*&&\s*e\.key\s*===\s*['"]Enter['"]/.test(appNotifJs), 'Ctrl+Enter must send');
    assert.ok(/Ctrl\+\.\*/.test(appNotifJs) || /e\.ctrlKey\s*&&\s*e\.key\s*===\s*['"]\.['"]/.test(appNotifJs), 'Ctrl+. must toggle test mode');
    assert.ok(/Escape/.test(appNotifJs) || /e\.key\s*===\s*['"]Escape['"]/.test(appNotifJs), 'Escape must clear composer');
});

t('P1: after a send, a 5-second flag action exists (no fake recall)', () => {
    // The old "Mark as recalled" wrote `recalled: true` to notifyLog, which the
    // server owns and the rules make READ-ONLY for the client - so the button
    // promised a recall the platform cannot perform. It now writes an audit
    // entry and says a delivered push cannot be pulled back.
    assert.ok(appNotifJs.includes('function _scheduleUndo'), '_scheduleUndo must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _flagSendError'), '_flagSendError must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('5000'), 'the flag window must be 5 seconds');
    assert.ok(!appNotifJs.includes('recalled: true'), 'no fake recall flag may be written');
    assert.ok(/logChange\(\s*'recall'/.test(appNotifJs), 'the flag writes an audit entry');
    assert.ok(appNotifJs.includes('cannot be pulled back'), 'the copy must be honest about what can be undone');
});

t('P1: initPushUI calls draft/template/keyboard setup', () => {
    assert.ok(appNotifJs.includes('async function initPushUI\(\)'), 'initPushUI must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('_loadDraft\(\)'), 'initPushUI must call _loadDraft');
    assert.ok(appNotifJs.includes('_loadTemplates\(\)'), 'initPushUI must call _loadTemplates');
    assert.ok(appNotifJs.includes('_wireKeyboard\(\)'), 'initPushUI must call _wireKeyboard');
});

t('P1: QR code functions exist', () => {
    assert.ok(appNotifJs.includes('function _renderQrCode'), '_renderQrCode must exist');
    assert.ok(appNotifJs.includes('function _downloadQr'), '_downloadQr must exist');
    assert.ok(html.includes('id="pushQrCanvas"'), 'QR canvas markup');
    assert.ok(html.includes('id="btnDownloadQr"'), 'QR download button markup');
    assert.ok(html.includes('id="pushEmptyQrCode"'), 'QR wrapper markup');
    assert.ok(html.includes('qrcodejs'), 'QRCode library script loaded');
    assert.ok(appNotifJs.includes('btnDownloadQr'), 'QR download button id exists in app-notifications.js');
});

// =====================================================================
// PANE 2: Promo Page Offers (P2)
// =====================================================================

t('P2: search/filter/sort elements exist', () => {
    for (const id of ['promoOffersSearch', 'promoOffersMatchCount', 'promoOffersList']) {
        assert.ok(html.includes(`id="${id}"`), `missing id: ${id}`);
    }
    for (const val of ['all', 'on-page', 'off-page', 'valid', 'expired', 'disabled', 'archived']) {
        assert.ok(html.includes(`value="${val}"`) && html.includes('name="promoOffersFilter"'), `missing filter radio: ${val}`);
    }
    for (const val of ['updated', 'name', 'value', 'expiry', 'usage']) {
        assert.ok(html.includes(`value="${val}"`) && html.includes('name="promoOffersSort"'), `missing sort radio: ${val}`);
    }
});

t('P2: filter/sort/select state variables exist', () => {
    assert.ok(js.includes('let _offersSearchQuery'), '_offersSearchQuery state');
    assert.ok(js.includes('let _offersFilter'), '_offersFilter state');
    assert.ok(js.includes('let _offersSort'), '_offersSort state');
    assert.ok(js.includes('let _selectedOffers'), '_selectedOffers state');
    assert.ok(js.includes('let _allOffersCache'), '_allOffersCache state');
});

t('P2: filter/process functions exist', () => {
    assert.ok(js.includes('function _processOffers'), '_processOffers must exist in customer-app.js');
    assert.ok(appNotifJs.includes('function _filterSubs'), '_filterSubs must exist in app-notifications.js');
});

t('P2: bulk selection functions exist', () => {
    assert.ok(js.includes('function _toggleSelectOffer'), '_toggleSelectOffer must exist');
    assert.ok(js.includes('function _toggleSelectAll'), '_toggleSelectAll must exist');
    assert.ok(js.includes('function _clearSelection'), '_clearSelection must exist');
    assert.ok(js.includes('function _updateBulkToolbar'), '_updateBulkToolbar must exist');
});

// --- Audit round 4 (2026-11-16): the Promo Offers pane must not save a
// broken offer, must not lie about what it can undo, and must show the
// customer exactly what the customer app shows.

t('C1: the quick-edit form is validated before anything is written', () => {
    assert.ok(js.includes('function _validateQuickEdit'), '_validateQuickEdit must exist');
    const body = js.slice(js.indexOf('async function _saveQuickEdit()'), js.indexOf('/** Archive a single offer. */'));
    assert.ok(body, 'the save function exists');
    const iValidate = body.indexOf('_validateQuickEdit()');
    const iPayload = body.indexOf('const updates = {');
    const iWrite = body.indexOf("update(Outlet.ref(`discounts/${_quickEditId}`)");
    assert.ok(iValidate > 0, 'the save validates');
    assert.ok(iPayload > iValidate, 'validation must run BEFORE the update payload is built');
    assert.ok(iWrite > iValidate, 'validation must run BEFORE the database write');
});

t('C1: the validation covers name, code shape, duplicate code, value, cap and dates', () => {
    const v = js.match(/function _validateQuickEdit\(\) \{[\s\S]*?\n\}/);
    assert.ok(v, '_validateQuickEdit body found');
    const body = v[0];
    assert.ok(/if \(!name\)/.test(body), 'name is required');
    assert.ok(/\/\^\[A-Za-z0-9_-\]\{3,24\}\$/.test(body), 'the code shape is checked');
    assert.ok(/toLowerCase\(\) === code\.toLowerCase\(\)/.test(body), 'the duplicate code is checked');
    assert.ok(/value <= 0/.test(body), 'the value must be more than 0');
    assert.ok(/value > 100/.test(body), 'a percent discount cannot exceed 100');
    assert.ok(/cap > value/.test(body), 'the cap cannot exceed the discount value');
    assert.ok(/new Date\(endsAt\)\.getTime\(\) <= new Date\(startsAt\)\.getTime\(\)/.test(body), 'end must be after start');
    assert.ok(/discountAllowsChannel\(\{ channel \}, 'website'\)/.test(body), 'the promo page needs a website channel');
});

t('C1: a validation failure is shown in the form and nothing is written', () => {
    assert.ok(html.includes('id="qeError"'), 'the inline error element exists');
    assert.ok(css.includes('.ca-form-error'), 'the inline error has a style');
    assert.ok(/problem\.message/.test(js), 'the message is shown');
    assert.ok(/field\.focus\(\)|\.focus\(\)/.test(js), 'the offending field is focused');
    // The error must be cleared when the panel opens again.
    assert.ok(/errEl\.textContent = ''/.test(js), 'the error is cleared');
});

t('C4: a failed promo-page toggle rolls the right checkbox back', () => {
    // The switch carries data-pp-id; the old rollback looked for data-id and
    // therefore never found it - the checkbox stayed in the wrong state.
    assert.ok(/input\[data-pp-id="\$\{id\}"\]/.test(js), 'the rollback must target data-pp-id');
    assert.ok(!/input\[data-id="\$\{id\}"\]/.test(js), 'the old data-id lookup must be gone');
});

t('C5: a duplicated offer gets a free coupon code and no inherited usage', () => {
    assert.ok(js.includes('function _uniqueOfferCode'), '_uniqueOfferCode must exist');
    assert.ok(/couponCode: _uniqueOfferCode\(offer\.couponCode\)/.test(js), 'the duplicate uses the free code');
    assert.ok(/delete dupe\.stats;/.test(js), 'the duplicate must not inherit the redemption count');
    assert.ok(!/couponCode: \(offer\.couponCode \|\| ''\) \+ '-COPY'/.test(js), 'the old fixed -COPY code must be gone');
});

t('C6: the Promo Page preview applies the website channel rule', () => {
    const preview = js.match(/function _openPreviewModal\(\) \{[\s\S]*?\n\}/);
    assert.ok(preview, 'the preview function exists');
    assert.ok(/discountAllowsChannel\(d, 'website'\)/.test(preview[0]), 'the preview must filter on the website channel');
});

t('C6: the preview is reachable - a button opens it', () => {
    // The preview modal was built (and its close buttons were wired) but
    // NOTHING ever opened it, so the channel fix was unreachable.
    assert.ok(html.includes('id="btnPromoPreview"'), 'the Preview Page button exists');
    assert.ok(/btnPromoPreview'\)\?\.addEventListener\('click', _openPreviewModal\)/.test(js), 'the button opens the preview');
    // The customer app applies the same three filters - keep the preview honest.
    const customer = fs.readFileSync(path.join(root, 'menu/js/customer.js'), 'utf8');
    assert.ok(/couponStatus\(d, now\) === 'valid'/.test(customer), 'the customer app filters by status');
    assert.ok(/discountAllowsChannel\(d, 'website'\)/.test(customer), 'the customer app filters by channel');
    assert.ok(/d\.promoPage === true/.test(customer), 'the customer app filters by the promo-page flag');
});

t('C7: an offer at its global limit is not reported as valid', () => {
    const rules = fs.readFileSync(path.join(root, 'shared/discount-rules.js'), 'utf8');
    assert.ok(/return 'limit_reached';/.test(rules), 'couponStatus must report limit_reached');
    assert.ok(/limit_reached: 'This coupon has reached its redemption limit'/.test(rules), 'the customer-facing reason exists');
    assert.ok(/globalLimit && \(d\.stats\?\.usedCount \|\| 0\) >= d\.globalLimit/.test(rules), 'the limit gate mirrors the evaluator');
    assert.ok(js.includes("limit_reached: 'Limit reached'"), 'the Admin label exists');
    assert.ok(css.includes('.promo-offer__status.limit_reached'), 'the status badge has a style');
});

t('P2: bulk action functions exist', () => {
    assert.ok(js.includes('function _bulkSetPromoPage'), '_bulkSetPromoPage must exist');
    assert.ok(js.includes('function _bulkSetEnabled'), '_bulkSetEnabled must exist');
    assert.ok(js.includes('function _bulkArchive'), '_bulkArchive must exist');
    assert.ok(js.includes('function _bulkDelete'), '_bulkDelete must exist');
});

t('P2: quick edit functions exist', () => {
    assert.ok(js.includes('function _openQuickEdit'), '_openQuickEdit must exist');
    assert.ok(js.includes('function _closeQuickEdit'), '_closeQuickEdit must exist');
    assert.ok(js.includes('function _saveQuickEdit'), '_saveQuickEdit must exist');
    assert.ok(html.includes('id="quickEditPanel"'), 'quick edit panel markup');
    assert.ok(html.includes('id="quickEditForm"'), 'quick edit form markup');
});

t('P2: per-offer lifecycle functions exist', () => {
    assert.ok(js.includes('function _archiveOffer'), '_archiveOffer must exist');
    assert.ok(js.includes('function _restoreOffer'), '_restoreOffer must exist');
    assert.ok(js.includes('function _deleteOffer'), '_deleteOffer must exist');
    assert.ok(js.includes('function _duplicateOffer'), '_duplicateOffer must exist');
});

t('P2: preview modal functions exist', () => {
    assert.ok(js.includes('function _openPreviewModal'), '_openPreviewModal must exist');
    assert.ok(js.includes('function _closePreview'), '_closePreview must exist');
    assert.ok(html.includes('id="promoPreviewModal"'), 'preview modal markup');
    assert.ok(html.includes('id="promoPreviewList"'), 'preview list markup');
});

t('P2: bulk toolbar markup exists', () => {
    assert.ok(html.includes('id="bulkToolbar"'), 'bulk toolbar markup');
    assert.ok(html.includes('id="bulkSelectCount"'), 'bulk count markup');
    assert.ok(html.includes('id="btnBulkShowOnPage"'), 'bulk show on page button');
    assert.ok(html.includes('id="btnBulkHideFromPage"'), 'bulk hide from page button');
    assert.ok(html.includes('id="btnBulkEnable"'), 'bulk enable button');
    assert.ok(html.includes('id="btnBulkDisable"'), 'bulk disable button');
    assert.ok(html.includes('id="btnBulkArchive"'), 'bulk archive button');
    assert.ok(html.includes('id="btnBulkDelete"'), 'bulk delete button');
    assert.ok(html.includes('id="btnBulkSelectAll"'), 'bulk select all button');
    assert.ok(html.includes('id="btnBulkCancel"'), 'bulk cancel button');
});

// =====================================================================
// PANE 3: App Visibility (P3)
// =====================================================================

t('P3: visibility search/filter/sort elements exist', () => {
    // `visFilterCount` was a copy-paste stray that lived inside the PROMO
    // PREVIEW modal and was read by nothing; the visibility pane's own match
    // counter is `visMatchCount`.
    for (const id of ['visSearch', 'visMatchCount']) {
        assert.ok(html.includes(`id="${id}"`), `missing id: ${id}`);
    }
    assert.ok(!html.includes('id="visFilterCount"'), 'the stray visFilterCount must stay gone');
    for (const val of ['all', 'visible', 'hidden', 'out-of-stock', 'availability-unset']) {
        assert.ok(html.includes(`value="${val}"`) && html.includes('name="visFilter"'), `missing filter radio: ${val}`);
    }
    // "Low Stock" was fiction: `stock` is a BOOLEAN flag, so `stock > 0` was
    // true for every available dish (21 of 22 in the demo).
    assert.ok(!html.includes('value="low-stock"'), 'the fictional low-stock filter must stay gone');
    assert.ok(!html.includes('visLowStockCount'), 'the fictional low-stock stat card must stay gone');
    assert.ok(html.includes('id="visUnsetCount"'), 'the honest "availability not set" counter');
    for (const val of ['name', 'price', 'stock', 'sortOrder']) {
        assert.ok(html.includes(`value="${val}"`) && html.includes('name="visSort"'), `missing sort radio: ${val}`);
    }
    for (const val of ['all', 'dish', 'category']) {
        assert.ok(html.includes(`value="${val}"`) && html.includes('name="visFilterType"'), `missing filter type radio: ${val}`);
    }
});

t('P3: visibility state variables exist', () => {
    assert.ok(js.includes('let _visSearchQuery'), '_visSearchQuery state');
    assert.ok(js.includes('let _visFilter'), '_visFilter state');
    assert.ok(js.includes('let _visSort'), '_visSort state');
    assert.ok(js.includes('let _visFilterType'), '_visFilterType state');
    assert.ok(js.includes('let _selectedVis'), '_selectedVis state');
    assert.ok(js.includes('let _allDishesCache'), '_allDishesCache state');
    assert.ok(js.includes('let _allCategoriesCache'), '_allCategoriesCache state');
    assert.ok(js.includes('let _featuredDishIds'), '_featuredDishIds state');
});

t('P3: visibility process/render functions exist', () => {
    assert.ok(js.includes('function _processVisibilityItems'), '_processVisibilityItems must exist');
    assert.ok(js.includes('function _renderVisibilityLists'), '_renderVisibilityLists must exist');
});

t('P3: visibility bulk functions exist', () => {
    assert.ok(js.includes('function _toggleSelectOffer'), '_toggleSelectOffer (shared with offers)');
    assert.ok(js.includes('function _toggleSelectAll'), '_toggleSelectAll (shared with offers)');
    assert.ok(js.includes('function _clearSelection'), '_clearSelection (shared with offers)');
    assert.ok(js.includes('function _bulkVisSetVisible'), '_bulkVisSetVisible must exist');
    assert.ok(js.includes('function _bulkVisSetFeatured'), '_bulkVisSetFeatured must exist');
    assert.ok(js.includes('function _bulkVisHideOutOfStock'), '_bulkVisHideOutOfStock must exist');
    assert.ok(js.includes('function _bulkVisShowAll'), '_bulkVisShowAll must exist');
});

t('P3: featured/max-6 enforcement exists', () => {
    assert.ok(/Maximum 6 featured dishes allowed/.test(js), 'max 6 featured must be enforced');
    assert.ok(/featured === true/.test(js), 'featured flag must be checked');
});

t('P3: stock indicator functions exist', () => {
    assert.ok(/isDishOOS/.test(js), 'stock indicator logic must exist');
    assert.ok(/vis-row__badge--in-stock|vis-row__badge--unset|vis-row__badge--out-of-stock/.test(css), 'stock badge styles must exist');
});

// =====================================================================
// V2 / V3: visibility model + honest labels (Customer APP audit)
// =====================================================================

t('V-ROOT: the visibility pane reads and writes the REAL dish/category nodes', () => {
    // The pane pointed at `menu/dishes` / `menu/categories`, but every dish
    // lives at `dishes` / `categories` (Admin > Catalog and the customer app
    // both use those), so the pane was EMPTY for every tenant and any write
    // landed on a phantom node.
    assert.ok(!/Outlet\.ref\(['"`]menu\//.test(js), 'no RTDB ref may point at the phantom menu/ node');
    assert.ok(!/safe\(['"`]menu\//.test(js), 'no overview read may point at the phantom menu/ node');
    assert.ok(js.includes("get(Outlet.ref('dishes'))"), 'dishes must be read from the real node');
    assert.ok(js.includes("get(Outlet.ref('categories'))"), 'categories must be read from the real node');
    assert.ok(/`dishes\/\$\{/.test(js), 'dish writes must target dishes/{id}');
    assert.ok(/`categories\/\$\{/.test(js), 'category writes must target categories/{id}');
    // The catalog (the writer of the same data) uses the same paths.
    const catalog = fs.readFileSync(path.join(root, 'Admin/js/features/catalog.js'), 'utf8');
    assert.ok(catalog.includes("Outlet.ref('dishes')"), 'catalog reads dishes at the outlet root');
});

t('V2: one availability helper, and the customer app is the authority', () => {
    assert.ok(/export function isDishOOS\(d\)/.test(js), 'isDishOOS helper');
    assert.ok(/export function isDishAvailabilityUnset\(d\)/.test(js), 'isDishAvailabilityUnset helper');
    assert.ok(/export function dishStockLabel\(d\)/.test(js), 'dishStockLabel helper');
    // The customer app shows a dish unless `stock === false`.
    const app = fs.readFileSync(path.join(root, 'menu/js/app.js'), 'utf8');
    assert.ok(app.includes('d.stock !== false'), 'the customer app rule (d.stock !== false) must stay');
    assert.ok(/function isDishOOS\(d\) \{ return !!d && d\.stock === false; \}/.test(js), 'isDishOOS must match the app rule');
    // The old comparisons never matched a boolean.
    assert.ok(!/stock === 0/.test(js), 'no `stock === 0` comparison may survive (stock is a boolean)');
    assert.ok(!/lowStockThreshold/.test(js), 'the fictional low-stock threshold must stay gone');
    assert.ok(!/isLowStock/.test(js), 'the fictional isLowStock flag must stay gone');
});

t('V2: every availability consumer uses the helper', () => {
    // stats, row badge, filters, bulk hide, overview stat card + quick controls
    const uses = (js.match(/isDishOOS\(/g) || []).length;
    assert.ok(uses >= 6, `isDishOOS must be used by every consumer (found ${uses})`);
    assert.ok(js.includes('availabilityUnset'), 'the row badge carries the availability state');
    assert.ok(js.includes("d.availabilityUnset ? 'unset'"), 'the unset badge class');
    assert.ok(css.includes('.vis-row__badge--unset'), 'the unset badge style');
});

t('V3: the banner and the Live/Saved labels are honest', () => {
    // The app DOES honour `visible` (dish + category) - only `featured` is
    // saved-only. The old banner claimed the opposite.
    const banner = html.match(/id="caVisBanner"[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(banner, 'the visibility banner exists');
    assert.ok(/Out of stock/.test(banner[0]), 'the banner names the out-of-stock rule');
    assert.ok(/switch it off here/i.test(banner[0]), 'the banner says hide/show IS applied');
    assert.ok(/Featured/.test(banner[0]), 'the banner mentions Featured');
    assert.ok(/does not highlight/i.test(banner[0]), 'the banner says Featured is not applied yet');
    const status = fs.readFileSync(path.join(root, 'Admin/js/features/customer-app-status.js'), 'utf8');
    assert.ok(/dishVisible:\s*\{[^}]*live: true/.test(status), 'hide/show dishes is LIVE');
    assert.ok(/categoryVisible:\s*\{[^}]*live: true/.test(status), 'hide/show categories is LIVE');
    assert.ok(/featured:\s*\{[^}]*live: false/.test(status), 'featured is still saved-only');
});

t('B3: the Overview stat card and the Quick Controls agree on the dish counts', () => {
    // Both used different rules (`stock !== false` vs `stock === 0`), so the
    // Overview said "0 out of stock" while the stat card said "1".
    assert.ok(/dishLive = dishList\.filter\(\(d\) => !isDishOOS\(d\)\)/.test(js), 'overview live count uses the helper');
    assert.ok(/oosCount = dishList\.filter\(\(d\) => isDishOOS\(d\)\)\.length/.test(js), 'overview oos count uses the helper');
    assert.ok((js.match(/oosCount = .*isDishOOS\(d\)/g) || []).length >= 2, 'both overview functions use the same rule');
});

t('B2: the Quick Control buttons are gated by the ROLE, not disabled for everyone', () => {
    // They used a hard-coded `canEdit: false`, which disabled the two bulk
    // actions (hide/show all coupons, hide OOS) for every role.
    assert.ok(!/canEdit: false/.test(js), 'no hard-coded canEdit:false may survive');
    assert.ok(/const canEdit = canEditTab\(CA_TAB_ID\)/.test(js), 'the role gate is computed');
    assert.ok((js.match(/\n\s+canEdit,\s*\n/g) || []).length >= 2, 'the mutating quick controls use the role flag');
});

t('Activity: the list is paginated instead of reading 100 rows with no way back', () => {
    const audit = fs.readFileSync(path.join(root, 'Admin/js/features/audit-trail.js'), 'utf8');
    assert.ok(/export async function loadAuditLogPage\(/.test(audit), 'loadAuditLogPage exists');
    assert.ok(/endAt\(beforeKey\)/.test(audit), 'the page uses a key cursor');
    assert.ok(js.includes('loadAuditLogPage(ACT_PAGE_SIZE)'), 'the activity tab reads one page');
    assert.ok(js.includes('loadAuditLogPage(ACT_PAGE_SIZE, _actCursor)'), 'older pages use the cursor');
    assert.ok(!/loadAuditLog\(100\)/.test(js), 'the old 100-row read must stay gone');
    assert.ok(html.includes('id="btnActivityOlder"'), 'the "load older" control exists');
    assert.ok(html.includes('id="caActivityPager"'), 'the pager exists');
    assert.ok(html.includes('id="caActivityCount"'), 'the pager shows how many rows are on screen');
});

t('Activity: an audit entry with an undefined leaf can still be written', () => {
    // RTDB rejects `undefined` inside a value. A dish with no `visible` field
    // yet produces `{ visible: undefined }`, which silently dropped the whole
    // audit entry ("Failed to write audit entry").
    const audit = fs.readFileSync(path.join(root, 'Admin/js/features/audit-trail.js'), 'utf8');
    assert.ok(/_cleanForRtdb/.test(audit), 'the audit payload is sanitised');
    assert.ok(/oldValue: _cleanForRtdb\(oldValue\)/.test(audit), 'oldValue is sanitised');
    assert.ok(/newValue: _cleanForRtdb\(newValue\)/.test(audit), 'newValue is sanitised');
});

t('P3: preview modal functions exist', () => {
    assert.ok(js.includes('function _openVisPreview'), '_openVisPreview must exist');
    assert.ok(js.includes('function _closeVisPreview'), '_closeVisPreview must exist');
    assert.ok(html.includes('id="visPreviewModal"'), 'visibility preview modal markup');
    assert.ok(html.includes('id="visPreviewList"'), 'visibility preview list markup');
});

// =====================================================================
// App Visibility preview: REACHABLE and HONEST (follow-up batch)
// =====================================================================

t('VP1: the visibility preview is reachable - a button opens it', () => {
    // The modal existed and its close buttons were wired, but NOTHING ever
    // opened it: `_openVisPreview` had no caller, so the whole preview was
    // unreachable (the same class as finding C6 on the Promo Page).
    assert.ok(html.includes('id="btnVisibilityPreview"'), 'the App preview button must exist in the Visibility pane header');
    assert.ok(/btnVisibilityPreview'\)\?\.addEventListener\('click', _openVisPreview\)/.test(js), 'the button opens the preview');
    // The button must live in the Visibility pane, not somewhere else.
    const pane = html.slice(html.indexOf('id="caPaneVisibility"'), html.indexOf('id="caPaneSettings"'));
    assert.ok(pane.includes('id="btnVisibilityPreview"'), 'the preview button belongs to the Visibility pane');
});

t('VP2: the preview shows what the CUSTOMER app shows (one shared rule)', () => {
    // The old preview showed only `featured === true` dishes (the app does
    // not even highlight those), ignored the out-of-stock rule and counted
    // dishes per category by `categoryId` - a menu that does not exist.
    const preview = js.match(/function _openVisPreview\(\) \{[\s\S]*?\n\}/);
    assert.ok(preview, 'the preview function exists');
    assert.ok(/customerVisibleMenu\(/.test(preview[0]), 'the preview uses the shared customer-visible rule');
    assert.ok(!/featured === true/.test(preview[0]), 'the preview must not filter on the saved-only `featured` flag');
    assert.ok(/export function customerVisibleMenu\(/.test(js), 'the shared rule is exported');
    // The rule must mirror menu/js/app.js (the authority).
    const app = fs.readFileSync(path.join(root, 'menu/js/app.js'), 'utf8');
    assert.ok(app.includes('d.stock !== false'), 'the app keeps a dish unless stock === false');
    assert.ok(app.includes('d.visible !== false'), 'the app keeps a dish unless visible === false');
    assert.ok(app.includes('hiddenCatKeys'), 'the app hides the dishes of a hidden category');
    const rule = js.match(/export function customerVisibleMenu\([\s\S]*?\n\}/);
    assert.ok(rule, 'the shared rule body found');
    assert.ok(/d\.stock !== false/.test(rule[0]), 'the shared rule applies the stock rule');
    assert.ok(/d\.visible !== false/.test(rule[0]), 'the shared rule applies the visible rule');
    assert.ok(/hiddenCatKeys\.has\(d\.category\)/.test(rule[0]), 'the shared rule hides the dishes of a hidden category');
    assert.ok(/c\.visible !== false/.test(rule[0]), 'the shared rule applies the category rule');
});

t('VP3: the preview says what is NOT shown (honest counts)', () => {
    const preview = js.match(/function _openVisPreview\(\) \{[\s\S]*?\n\}/);
    assert.ok(preview, 'the preview function exists');
    assert.ok(/vis-prev__summary/.test(preview[0]), 'the preview has a summary line');
    assert.ok(/vis-prev__note/.test(preview[0]), 'the preview lists what is not shown');
    assert.ok(/isDishOOS\(d\)/.test(preview[0]), 'the out-of-stock count uses the helper');
    // Per-category counts must match the app: a dish carries its category NAME.
    assert.ok(/d\.category === c\.name/.test(preview[0]), 'the per-category count matches the customer app grouping');
    // And the CSS for those classes must exist (PurgeCSS strips unknown ones).
    for (const cls of ['.vis-prev__summary', '.vis-prev__note', '.vis-prev__section', '.vis-prev__row', '.vis-prev__name', '.vis-prev__meta', '.vis-prev__empty']) {
        assert.ok(css.includes(cls), `missing style: ${cls}`);
    }
});

t('VP4: both previews go through the shared modal stack (Escape closes them)', () => {
    assert.ok(/_openModal\('visPreviewModal'\)/.test(js), 'the visibility preview opens through the modal stack');
    assert.ok(/_closeModal\('visPreviewModal'\)/.test(js), 'the visibility preview closes through the modal stack');
    assert.ok(/_openModal\('promoPreviewModal'\)/.test(js), 'the promo preview opens through the modal stack');
    assert.ok(/_closeModal\('promoPreviewModal'\)/.test(js), 'the promo preview closes through the modal stack');
    assert.ok(/e\.key === 'Escape'[\s\S]{0,200}_closeAllModals\(\)/.test(js), 'Escape closes every open modal');
    assert.ok(/function _closeAllModals\(\)/.test(js), 'the modal stack has a close-all');
    // The preview modal must be a real dialog for screen readers.
    const modal = html.match(/id="visPreviewModal"[\s\S]*?>/);
    assert.ok(modal, 'the preview modal exists');
    assert.ok(/role="dialog"/.test(modal[0]), 'the preview modal is a dialog');
    assert.ok(/aria-modal="true"/.test(modal[0]), 'the preview modal is modal');
});

t('VP5: the unreachable audit-log modal stays gone', () => {
    // Activity (with pagination) is the audit log now. The old modal had no
    // opener at all - it was unreachable dead markup.
    assert.ok(!html.includes('auditLogModal'), 'the unreachable audit modal markup must stay deleted');
    assert.ok(!html.includes('auditLogList'), 'the unreachable audit list must stay deleted');
    assert.ok(!js.includes('_openAuditLog'), 'the unreachable opener must stay deleted');
    assert.ok(!css.includes('.audit-log-modal'), 'the dead audit modal style must stay deleted');
});

t('VP6: no orphaned `_` helper is left in customer-app.js', () => {
    // A defined-but-never-called function is dead code - and in this module it
    // had already shipped twice (an unreachable preview + three bulk helpers
    // that no button called). This is the generic guard for that class.
    const defs = [...js.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+(_[A-Za-z0-9_]+)/gm)].map(m => m[1]);
    const orphans = defs.filter(fn => js.split(fn).length - 1 < 2);
    assert.deepEqual(orphans, [], 'orphaned functions: ' + orphans.join(', '));
    assert.ok(defs.length > 50, 'the function scan must actually find the module functions (' + defs.length + ')');
});

t('VP7: the category rows count their dishes the way the app groups them', () => {
    // A dish carries `category` (the NAME) and no `categoryId`, so counting by
    // id printed "0 dishes" on every category row.
    assert.ok(!/d\.categoryId === c\.id/.test(js), 'the categoryId count must stay gone');
    assert.ok(/d\.category === c\.name \|\| d\.category === c\.id/.test(js), 'the count matches the app grouping');
});

t('V1: a toggle checkbox has ONE event path (no double write)', () => {
    // A visibility / promo-page checkbox had BOTH a delegated `click`
    // handler AND a per-checkbox `change` listener, so one click wrote the
    // row twice and logged two audit entries. The delegated handler is
    // re-bound on every render (the wrapper is cloned), so the per-checkbox
    // listener was pure duplication.
    assert.ok(!/querySelectorAll\('input\[data-vis-type\]'\)/.test(js), 'no per-checkbox change listener for the visibility toggle');
    assert.ok(!/querySelectorAll\('input\[data-pp-id\]'\)/.test(js), 'no per-checkbox change listener for the promo-page toggle');
    assert.ok(!/addEventListener\('change'[\s\S]{0,120}_toggleVisItem/.test(js), 'no change listener may call _toggleVisItem');
    assert.ok(!/addEventListener\('change'[\s\S]{0,120}_togglePromoPage/.test(js), 'no change listener may call _togglePromoPage');
    // The delegated paths must still exist (one each).
    assert.ok(/e\.target\.matches\('input\[data-vis-type\]'\)/.test(js), 'the delegated visibility toggle stays');
    assert.ok(/e\.target\.matches\('input\[data-pp-id\]'\)/.test(js), 'the delegated promo-page toggle stays');
});

t('VP8: the service worker cache + the stylesheet version are in step', () => {
    // A file the SW serves needs a CACHE_NAME bump in the same commit, and the
    // precached stylesheet URL must match the one index.html asks for.
    const sw = fs.readFileSync(path.join(root, 'Admin/sw.js'), 'utf8');
    assert.ok(/const CACHE_NAME = 'foodhubbie-erp-shell-v5\.12\.59'/.test(sw), 'the SW cache name must be bumped for this batch');
    const htmlCss = html.match(/style\.css\?v=([\d.]+)/);
    const swCss = sw.match(/style\.css\?v=([\d.]+)/);
    assert.ok(htmlCss && swCss, 'both the page and the SW pin a stylesheet version');
    assert.equal(swCss[1], htmlCss[1], 'the precached stylesheet version must match the page');
});

// =====================================================================
// PANE 4: App Settings (P4)
// =====================================================================

t('P4: new settings sections exist in markup', () => {
    for (const id of ['businessHoursGrid', 'caSettingTimezone', 'caSettingGSTRate', 'caSettingTaxOnDeliveryFee', 'caSettingThemeColor', 'caSettingLogoUrl']) {
        assert.ok(html.includes(`id="${id}"`), `missing id: ${id}`);
    }
});

t('P4: settings state variables exist', () => {
    assert.ok(js.includes('let _settingsDirty'), '_settingsDirty state');
    assert.ok(js.includes('let _settingsOriginal'), '_settingsOriginal state');
    assert.ok(js.includes('let _settingsSaveTimer'), '_settingsSaveTimer state');
    assert.ok(js.includes('let _settingsErrors'), '_settingsErrors state');
});

t('P4: validation function exists', () => {
    assert.ok(js.includes('function _validateSettings'), '_validateSettings must exist');
    assert.ok(/Store name is required/.test(js), 'store name required message');
    assert.ok(/valid 10-digit mobile number/.test(js), 'phone validation message');
    assert.ok(/valid URL/.test(js), 'URL validation message');
    assert.ok(/non-negative number/.test(js), 'non-negative number message');
    assert.ok(/between 0 and 28/.test(js), 'GST rate range message');
});

t('P4: error rendering functions exist', () => {
    assert.ok(js.includes('function _renderSettingsErrors'), '_renderSettingsErrors must exist');
    assert.ok(js.includes('function _clearAllSettingsErrors'), '_clearAllSettingsErrors must exist');
    assert.ok(js.includes('.ca-field-error'), 'error style class');
});

t('P4: dirty tracking functions exist', () => {
    assert.ok(js.includes('function _markSettingsDirty'), '_markSettingsDirty must exist');
    assert.ok(js.includes('function _updateSettingsDirtyUI'), '_updateSettingsDirtyUI must exist');
    // Autosave was removed on purpose: settings save only on the Save button (see tests/customer-app.browser.mjs)
    assert.ok(!js.includes('_debounceSaveSettings'), 'settings must not autosave while typing');
});

t('P4: beforeunload warning exists', () => {
    assert.ok(/beforeunload/.test(js), 'beforeunload listener must exist');
    assert.ok(/e\.returnValue = ''/.test(js), 'beforeunload must set returnValue');
});

t('P4: Ctrl+S shortcut exists', () => {
    assert.ok(/Ctrl\+Enter|e\.ctrlKey\s*&&\s*e\.key\s*===\s*['"]s['"]/.test(js), 'Ctrl+S must save settings');
});

t('P4: business hours render/collect functions exist', () => {
    assert.ok(js.includes('function _renderBusinessHours'), '_renderBusinessHours must exist');
    assert.ok(js.includes('function _collectBusinessHours'), '_collectBusinessHours must exist');
    assert.ok(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(js), 'all 7 days must be handled');
});

t('P4: business hours collapse to one compact row per day on a phone', () => {
    // Stacked day cards were 1567px tall on a 390px phone (two screens).
    // The phone layout is one row per day (day | open-close | closed switch).
    assert.ok(js.includes('class="ca-bh-times"'), '_renderBusinessHours must wrap the two time rows');
    assert.ok(js.includes('class="ca-bh-head"'), '_renderBusinessHours must emit the phone column header');
    assert.ok(js.includes('class="ca-bh-closedText"'), 'the Closed word must be its own span (it is screen-reader only on a phone)');
    assert.ok(/grid-template-areas:\s*"day times closed"/.test(css), 'the phone card must be a 3-column row');
    assert.ok(/\.ca-bh-head\s*\{[^}]*display:\s*grid/.test(css), 'the phone column header must be a grid');
});

// =====================================================================
// PANE 4b: Customer App QR card + social links (App Settings)
// =====================================================================

/** The markup between the App Settings pane opening and the next pane. */
function settingsPane() {
    const start = html.indexOf('id="caPaneSettings"');
    const end = html.indexOf('id="caPaneActivity"', start);
    assert.ok(start > 0 && end > start, 'could not slice the App Settings pane out of Admin/index.html');
    return html.slice(start, end);
}

t('QR card markup lives inside the App Settings pane', () => {
    const pane = settingsPane();
    assert.ok(pane.includes('class="ca-qr-card"'), 'the QR card section must sit inside #caPaneSettings');
    assert.ok(!/<div id="qr-generator-placeholder">/.test(html), 'the old placeholder div must be gone');
    assert.ok(!html.includes('qr-generator-card'), 'the old QR generator block must be gone');
    for (const id of ['btnDownloadQR', 'btnPrintQR', 'qrCodeImg', 'qrCardName', 'qrCardLogo', 'qrPhoneDisplay', 'qrWhatsappDisplay', 'qrAddressDisplay', 'qrSocialDisplay', 'qrAppLinkDisplay', 'logoPreview', 'logoPreviewImg', 'themePreviewSwatch', 'themePreviewValue']) {
        assert.ok(pane.includes(`id="${id}"`), `missing id inside the settings pane: ${id}`);
    }
});

t('QR print card is a direct child of body (print isolation)', () => {
    const body = html.slice(html.indexOf('<body'));
    const card = body.indexOf('id="qrPrintCard"');
    assert.ok(card > 0, '#qrPrintCard must exist');
    assert.ok(card > body.indexOf('</main>'), '#qrPrintCard must live outside <main>');
    assert.ok(card < body.indexOf('</body>'), '#qrPrintCard must live before </body>');
    assert.ok(css.includes('body.printing-qr > *:not(#qrPrintCard)'), 'printing must hide everything except the print card');
});

t('QR card functions exist in customer-app.js', () => {
    for (const fn of ['_qrFacts', '_updateBrandPreview', '_renderQrCard', '_qrPrintCardHtml', '_renderQrPrintCard', '_printQrCard', '_composeQrPng', '_downloadQrCard', '_loadCorsImage', '_wrapCanvasText']) {
        assert.ok(js.includes(`function ${fn}`), `${fn} must exist`);
    }
    assert.ok(js.includes("from '../utils/qr.js'"), 'the shared QR helper must be imported');
    assert.ok(!js.includes('function _ensureQrLib'), 'the QR library loader lives in Admin/js/utils/qr.js only');
});

t('the shared QR helper exists and is the only implementation', () => {
    const qr = fs.readFileSync(path.join(root, 'Admin/js/utils/qr.js'), 'utf8');
    assert.ok(qr.includes('export function ensureQrLib'), 'ensureQrLib must be exported');
    assert.ok(qr.includes('export async function qrDataUri'), 'qrDataUri must be exported');
    const tables = fs.readFileSync(path.join(root, 'Admin/js/features/tables.js'), 'utf8');
    assert.ok(tables.includes("from '../utils/qr.js'"), 'tables.js must use the shared QR helper');
    assert.ok(!tables.includes('function _ensureQrLib'), 'tables.js must not carry its own QR loader');
    assert.ok(!/ensureQrLib\s+as/.test(tables), 'tables.js must not import an unused ensureQrLib');
    const sw = fs.readFileSync(path.join(root, 'Admin/sw.js'), 'utf8');
    assert.ok(sw.includes('./js/utils/qr.js'), 'the service worker must precache the QR helper');
});

t('social links are saved, restored and validated', () => {
    for (const id of ['caSettingFacebookPage', 'caSettingInstagramPage']) {
        assert.ok(html.includes(`id="${id}"`), `missing id: ${id}`);
    }
    assert.ok(/facebook:\s*\$\('caSettingFacebookPage'\)/.test(js), 'facebook must be saved to settings/Store');
    assert.ok(/instagram:\s*\$\('caSettingInstagramPage'\)/.test(js), 'instagram must be saved to settings/Store');
    assert.ok(js.includes("caSettingFacebookPage: _settingsOriginal.facebook"), 'facebook must be restored on Discard');
    assert.ok(js.includes("caSettingInstagramPage: _settingsOriginal.instagram"), 'instagram must be restored on Discard');
    assert.ok(js.includes('caSettingFacebookPage') && js.includes('caSettingInstagramPage'), 'both social fields must be validated');
});

t('Customer APP CSS is balanced and the dead badge styles are gone', () => {
    let depth = 0;
    for (const ch of css) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        assert.ok(depth >= 0, 'CSS braces close before they open');
    }
    assert.equal(depth, 0, 'CSS braces are unbalanced');
    for (const dead of ['.ca-field-badge', '.ca-field-wrapper', '.qr-generator-card', '.qr-info-row', '.theme-color-swatch', '.logo-preview']) {
        assert.ok(!css.includes(dead), `dead style must be removed: ${dead}`);
    }
    assert.ok(css.includes('.ca-qr-card'), 'the QR card styles must exist');
    assert.ok(css.includes('.qr-print-sheet'), 'the print sheet styles must exist');
});

t('the legacy app-notifications role id still opens the Customer APP tab', () => {
    // Roles saved before the 2026-11-10 rename still list 'app-notifications'.
    // canAccessTab must honour it, or the tab is invisible until Settings is
    // opened (and the stored roles are rewritten).
    assert.ok(
        /tabId === 'customer-app' && role\.tabs\.includes\('app-notifications'\)/.test(uiJs),
        'canAccessTab must accept the legacy app-notifications id for customer-app'
    );
});

// =====================================================================
// PANE 5: Audit Trail, Role Gating, Keyboard Shortcuts (cross-cutting)
// =====================================================================

t('P5: audit trail module exists and exports functions', () => {
    const auditJs = fs.readFileSync(path.join(root, 'Admin/js/features/audit-trail.js'), 'utf8');
    assert.ok(auditJs.includes('export async function logChange'), 'logChange export');
    assert.ok(auditJs.includes('export async function loadAuditLog'), 'loadAuditLog export');
    assert.ok(auditJs.includes('export async function renderAuditLog'), 'renderAuditLog export');
    assert.ok(auditJs.includes('export async function auditedUpdate'), 'auditedUpdate export');
    assert.ok(auditJs.includes('auditLog'), 'auditLog path reference');
    assert.ok(auditJs.includes('Outlet.ref'), 'audit trail uses Outlet.ref');
});

t('P5: customer-app imports audit trail', () => {
    assert.ok(js.includes("from './audit-trail.js'"), 'customer-app must import audit-trail');
});

t('P5: role gating functions exist in ui.js', () => {
    assert.ok(uiJs.includes('export const canEditTab'), 'canEditTab export');
    assert.ok(uiJs.includes('export const canDeleteTab'), 'canDeleteTab export');
    assert.ok(uiJs.includes('export const roleLabel'), 'roleLabel export');
});

t('P5: role gating logic exists', () => {
    assert.ok(/level >= 2/.test(uiJs), 'owner+ level check for edit/delete');
    assert.ok(/isSupreme/.test(uiJs), 'supreme role check exists');
});

t('P5: role badge markup exists', () => {
    assert.ok(html.includes('id="roleBadge"'), 'role badge markup');
});

t('P5: customer-app calls _applyRoleGating on tab switch', () => {
    assert.ok(js.includes('function _applyRoleGating'), '_applyRoleGating must exist');
    // Gating is keyed on the real tab id ('customer-app'), not on sub-tab names (that made Owner/Manager view-only)
    assert.ok(js.includes("CA_TAB_ID = 'customer-app'"), 'CA_TAB_ID must be the customer-app tab id');
    assert.ok(!/_applyRoleGating\('(notification|offers|visibility|settings)'/.test(js), 'must not gate by sub-tab name');
    assert.ok((js.match(/_applyRoleGating\(CA_TAB_ID\)/g) || []).length >= 4, 'every pane must apply gating');
});

t('P5: _applyRoleGating checks edit/delete permissions', () => {
    assert.ok(js.includes('canEditTab(tabId)'), '_applyRoleGating must call canEditTab');
    assert.ok(js.includes('canDeleteTab(tabId)'), '_applyRoleGating must call canDeleteTab');
});

// =====================================================================
// CSS: P1-P5 style literals (PurgeCSS safety)
// =====================================================================

t('P1-P5: CSS literals exist for dynamic classes', () => {
    // Bulk toolbar
    assert.ok(css.includes('.bulk-toolbar'), '.bulk-toolbar style');
    assert.ok(css.includes('.bulk-toolbar.hidden'), '.bulk-toolbar.hidden style');
    // Promo offer row selected
    assert.ok(css.includes('.promo-offer-row.selected'), '.promo-offer-row.selected style');
    // Visibility row
    assert.ok(css.includes('.vis-row'), '.vis-row style');
    assert.ok(css.includes('.vis-row.selected'), '.vis-row.selected style');
    assert.ok(css.includes('.vis-row__badge'), '.vis-row__badge style');
    assert.ok(css.includes('.vis-row__badge--in-stock'), 'in-stock badge style');
    assert.ok(css.includes('.vis-row__badge--unset'), 'unset badge style');
    assert.ok(css.includes('.vis-row__badge--out-of-stock'), 'out-of-stock badge style');
    assert.ok(css.includes('.vis-row__status'), '.vis-row__status style');
    // Preview panels hidden
    assert.ok(css.includes('.quick-edit-panel.hidden'), '.quick-edit-panel.hidden style');
    assert.ok(css.includes('.promo-preview-modal.hidden'), '.promo-preview-modal.hidden style');
    // Search/filter chips active
    assert.ok(css.includes('.vis-search-filter .chip--radio.active'), 'vis search filter chip active style');
    assert.ok(css.includes('.promo-offers-search-filter .chip--radio.active'), 'promo search filter chip active style');
    // Settings error states
    assert.ok(css.includes('.ca-field-error'), '.ca-field-error style');
    assert.ok(css.includes('.btn-primary.dirty::after'), 'dirty dot style');
});

// =====================================================================
// Rules: auditLog exists in database.rules.json
// =====================================================================

t('database.rules.json: auditLog read rule exists', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
    const find = (node, key) => {
        if (node && typeof node === 'object') {
            if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
            for (const v of Object.values(node)) { const hit = find(v, key); if (hit) return hit; }
        }
        return null;
    };
    const n = find(rules, 'auditLog');
    assert.ok(n, 'auditLog rule must exist in database.rules.json');
});

console.log(failed ? `\n${failed} check(s) failed` : '\ncustomer-app guard ok');
process.exit(failed ? 1 : 0);
