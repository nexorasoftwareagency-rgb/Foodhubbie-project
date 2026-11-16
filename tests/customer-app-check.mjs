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

t('P1: undo after send exists', () => {
    assert.ok(appNotifJs.includes('function _scheduleUndo'), '_scheduleUndo must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('function _undoSend'), '_undoSend must exist in app-notifications.js');
    assert.ok(appNotifJs.includes('5000'), 'undo window must be 5 seconds');
    assert.ok(appNotifJs.includes('recalled: true'), 'undo must mark the history entry as recalled');
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
    for (const id of ['visSearch', 'visFilterCount', 'visMatchCount']) {
        assert.ok(html.includes(`id="${id}"`), `missing id: ${id}`);
    }
    for (const val of ['all', 'visible', 'hidden', 'out-of-stock', 'low-stock']) {
        assert.ok(html.includes(`value="${val}"`) && html.includes('name="visFilter"'), `missing filter radio: ${val}`);
    }
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
    assert.ok(/isOOS|isLowStock|out-of-stock|low-stock/.test(js), 'stock indicator logic must exist');
    assert.ok(/vis-row__badge--in-stock|vis-row__badge--low-stock|vis-row__badge--out-of-stock/.test(css), 'stock badge styles must exist');
});

t('P3: preview modal functions exist', () => {
    assert.ok(js.includes('function _openVisPreview'), '_openVisPreview must exist');
    assert.ok(js.includes('function _closeVisPreview'), '_closeVisPreview must exist');
    assert.ok(html.includes('id="visPreviewModal"'), 'visibility preview modal markup');
    assert.ok(html.includes('id="visPreviewList"'), 'visibility preview list markup');
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
    assert.ok(css.includes('.vis-row__badge--low-stock'), 'low-stock badge style');
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
