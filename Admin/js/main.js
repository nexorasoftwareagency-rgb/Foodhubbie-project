import { previewImage, showToast, showConfirm, logAudit, getISTDateString } from './utils.js';
import { escapeHtml } from '../../shared/dom/escape.js';
import { state } from './state.js';
import { auth, db, serverTimestamp, ref, push, set } from './firebase.js';
import { switchOutlet, openOutletInNewTab } from './branding.js';
import { switchTab, toggleSidebar, toggleMobileCart, loadLucide } from './ui.js';
import { initGestures } from './gestures.js';
import { initAuth, userLogout } from './auth.js';
import { installPWA, completeSiteRefresh } from './pwa.js';
import { logger } from './utils/logger.js';

// Side-effect imports
import './firebase.js';
import './branding.js';

const _modCache = {};
function useMod(name) {
    if (!_modCache[name]) _modCache[name] = import(`./features/${name}.js`);
    return _modCache[name];
}

document.addEventListener('DOMContentLoaded', async () => {
    logger.info('SYSTEM', '🚀 DOM Content Loaded. Initializing Admin ERP...', { version: '5.2.0', time: new Date().toISOString() });
    console.log(
        '%c FOODHUBBIE %c v5.2.0 %c\n' +
        '%cAll user actions, button clicks, and module activity are logged here.\n' +
        'Use the topbar "terminal" button to open the Activity Log panel,\n' +
        'or inspect with: %c__adminLogger',
        'background:#6366f1;color:#fff;font-weight:700;padding:4px 8px;border-radius:4px 0 0 4px;',
        'background:#1e293b;color:#fff;padding:4px 8px;border-radius:0 4px 4px 0;',
        'color:#94a3b8;',
        'color:#cbd5e1;',
        'color:#8b5cf6;font-family:monospace;'
    );
    initGestures();
    // ponytail: WCAG 2.5.3 — strip title from sidebar li so accessible name matches visible <span> text
    document.querySelectorAll('.sidebar-nav li[title]').forEach(li => li.removeAttribute('title'));

    document.querySelectorAll('form').forEach(form => {
        form.addEventListener('submit', e => e.preventDefault());
    });

    window.hideLoader = () => {
        const loader = document.getElementById('initial-loader');
        if (loader) {
            loader.classList.add('fade-out');
            setTimeout(() => {
                loader.style.display = 'none';
            }, 600);
        }
    };

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    
    const fromVal = getISTDateString(yesterday);
    const toVal = getISTDateString(today);
    
    const fromInput = document.getElementById('orderFrom');
    const toInput = document.getElementById('orderTo');
    const rFrom = document.getElementById('reportFrom');
    const rTo = document.getElementById('reportTo');

    if (fromInput && toInput && !fromInput.value && !toInput.value) {
        fromInput.value = fromVal;
        toInput.value = toVal;
    }
    if (rFrom && rTo && !rFrom.value && !rTo.value) {
        rFrom.value = fromVal;
        rTo.value = toVal;
    }

    // Close open status dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.status-dropdown.open').forEach(openDd => {
            if (!openDd.contains(e.target)) {
                openDd.classList.remove('open');
                const sb = openDd.closest('.dw-body');
                if (sb) sb.style.overflowY = '';
                if (openDd._dropdownReposition) {
                    window.removeEventListener('resize', openDd._dropdownReposition);
                    openDd._dropdownReposition = null;
                }
            }
        });
    });

    // Click handler registered BEFORE awaits — ensures clicks work even if Firebase hangs
    document.addEventListener('click', async (e) => {
        try {
            const el = e.target.closest('[data-action], [data-tab]');
            if (!el) return;

            if (window.innerWidth <= 1024) {
                const sidebar = document.getElementById('sidebarNav');
                if (sidebar && sidebar.classList.contains('active')) {
                    const isToggleBtn = el.getAttribute('data-action') === 'toggleSidebar' || el.closest('#mobileHamburger');
                    if (!isToggleBtn) {
                        import('./ui.js').then(u => u.closeSidebar());
                    }
                }
            }

            const action = el.getAttribute('data-action');
            const tab = el.getAttribute('data-tab');
            const id = el.getAttribute('data-id');
            const val = el.getAttribute('data-val');
            const name = el.getAttribute('data-name');
            const price = el.getAttribute('data-price');
            const tag = el.getAttribute('data-tag');

            const elLabel = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.id || el.className.split(' ')[0] || 'unknown';
            const ctx = { tag: el.tagName, id: el.id || null, action, tab, dataId: id, dataVal: val, dataName: name, text: elLabel };
            logger.action('CLICK', `→ ${action || 'switchTab:' + tab} (${elLabel})`, ctx);

            if (tab) {
                logger.nav('TAB', `Switching to tab: ${tab}`);
                switchTab(tab);
                return;
            }

            if (!action) return;

            switch (action) {

                case 'closeOrderDrawer': logger.info('ORDERS', 'Closing order drawer'); (await useMod('orders')).closeOrderDrawer(); break;
                case 'chatOnWhatsapp': {
                    const phone = el.getAttribute('data-phone');
                    logger.info('CHAT', `Opening WhatsApp chat: ${phone}`);
                    if (phone) window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}`, '_blank');
                    break;
                }
                case 'printReceiptById': logger.info('PRINT', `Print receipt: ${id}`); (await useMod('orders')).closeOrderDrawer(); (await useMod('printing')).printReceiptById(id); break;
                case 'printKotById': logger.info('PRINT', `Print KOT: ${id}`); (await useMod('printing')).printKotById(id); break;
                case 'closeReceiptPreview': logger.info('PRINT', 'Close receipt preview'); (await useMod('printing')).closeReceiptPreview(); break;
                case 'printReceiptFromPreview': logger.info('PRINT', 'Print from preview'); (await useMod('printing')).printReceiptFromPreview(); break;
                case 'updateStatus': { const v = val || (el.tagName === 'SELECT' ? el.value : null); logger.info('ORDERS', `Update status: ${id} → ${v}`); (await useMod('orders')).updateStatus(id, v); break; }
                case 'toggleStatus': {
                    const dd = el.closest('.status-dropdown');
                    if (!dd) break;
                    const wasOpen = dd.classList.contains('open');

                    // Close every other open dropdown first
                    document.querySelectorAll('.status-dropdown.open').forEach(openDd => {
                        if (openDd !== dd) {
                            openDd.classList.remove('open');
                            const osb = openDd.closest('.dw-body');
                            if (osb) osb.style.overflowY = '';
                            if (openDd._dropdownReposition) {
                                window.removeEventListener('resize', openDd._dropdownReposition);
                                openDd._dropdownReposition = null;
                            }
                        }
                    });

                    dd.classList.toggle('open');
                    const sb = dd.closest('.dw-body');
                    if (wasOpen) {
                        if (sb) sb.style.overflowY = '';
                    } else {
                        if (sb) sb.style.overflowY = 'visible';
                    }

                    if (!wasOpen) {
                        const menu = dd.querySelector('.status-dropdown-menu');
                        if (menu) {
                            menu.style.top = '';
                            menu.style.left = '';
                            menu.style.bottom = '';

                            const positionMenu = () => {
                                const btn = dd.querySelector('.status-dropdown-trigger');
                                if (!btn || !menu.isConnected) return;

                                // Measure relative to the drawer's containing box, not the viewport
                                const containingEl = dd.closest('.drawer-content') || document.body;
                                const containerRect = containingEl.getBoundingClientRect();
                                const r = btn.getBoundingClientRect();

                                const isBody = containingEl === document.body;
                                const availW = isBody ? window.innerWidth : containerRect.width;
                                const availH = isBody ? window.innerHeight : containerRect.height;

                                let left = r.left - containerRect.left;
                                let top = r.bottom - containerRect.top + 4;

                                menu.style.left = left + 'px';
                                menu.style.top = top + 'px';
                                menu.style.bottom = '';

                                const mr = menu.getBoundingClientRect();
                                const menuW = mr.width;
                                const menuH = mr.height;

                                if (left + menuW > availW) left = Math.max(4, availW - menuW - 4);
                                if (left < 4) left = 4;

                                if (top + menuH > availH) {
                                    const flippedTop = (r.top - containerRect.top) - menuH - 4;
                                    top = flippedTop >= 4 ? flippedTop : Math.max(4, availH - menuH - 4);
                                }
                                if (top < 4) top = 4;

                                menu.style.left = left + 'px';
                                menu.style.top = top + 'px';
                            };

                            requestAnimationFrame(positionMenu);

                            dd._dropdownReposition = positionMenu;
                            window.addEventListener('resize', dd._dropdownReposition);
                        }
                    } else if (dd._dropdownReposition) {
                        window.removeEventListener('resize', dd._dropdownReposition);
                        dd._dropdownReposition = null;
                    }
                    break;
                }
                case 'pickStatus': { const dd = el.closest('.status-dropdown'); if (dd) { if (dd._dropdownReposition) { window.removeEventListener('resize', dd._dropdownReposition); dd._dropdownReposition = null; } dd.classList.remove('open'); const sb = dd.closest('.dw-body'); if (sb) sb.style.overflowY = ''; } logger.info('ORDERS', `Status picked: ${id} → ${val}`); (await useMod('orders')).updateStatus(id, val); break; }
                case 'assignRider': logger.info('ORDERS', `Assign rider: ${id} → ${val}`); (await useMod('orders')).assignRider(id, val); break;
                case 'openOrderDrawer': logger.info('ORDERS', `Open order drawer: ${id}`); (await useMod('orders')).openOrderDrawer(id); break;
                case 'viewOrderFromDiscountUsage': {
                    logger.info('DISCOUNT', `View order from discount usage: ${id}`);
                    (await useMod('discountsReports')).closeDiscountsReports?.();
                    (await useMod('orders')).openOrderDrawer(id);
                    break;
                }
                case 'markAsPaid': logger.info('ORDERS', `Mark paid: ${id}`); (await useMod('orders')).markAsPaid(id); break;
                case 'deleteCategory': logger.info('CATALOG', `Delete category: ${id}`); (await useMod('catalog')).deleteCategory(id); break;
                case 'removeParent': logger.info('UI', 'Remove parent element'); el.parentElement.remove(); break;
                case 'removeGrandparent': logger.info('UI', 'Remove grandparent element'); el.parentElement.parentElement.remove(); break;
                case 'editRider': logger.info('RIDERS', `Edit rider: ${id}`); (await useMod('riders')).editRider(id); break;
                case 'resetRiderPassword': logger.info('RIDERS', `Reset rider password: ${el.getAttribute('data-email')}`); (await useMod('riders')).resetRiderPassword(el.getAttribute('data-email')); break;
                case 'deleteRider': logger.info('RIDERS', `Delete rider: ${id}`); (await useMod('riders')).deleteRider(id); break;
                case 'settleRider': logger.info('RIDERS', `Settle rider wallet: ${id} (${name})`); (await useMod('riders')).settleRiderWallet(id, name); break;
                case 'saveSettings': logger.info('SETTINGS', 'Save store settings'); (await useMod('settings')).saveStoreSettings(); break;
                case 'saveDeliveredOrder': logger.info('ORDERS', `Save delivered order: ${id} = ${val}`); (await useMod('orders')).saveDeliveredOrder(id, val); break;
                case 'openPOSSelectionModal': logger.info('POS', `Open selection modal: ${id}`); (await useMod('pos')).openPOSSelectionModal(id); break;
                case 'hidePOSSelectionModal': logger.info('POS', 'Hide selection modal'); (await useMod('pos')).hidePOSSelectionModal(); break;
                case 'addToWalkinCartFromModal': logger.info('POS', 'Add to cart from modal'); (await useMod('pos')).addToWalkinCartFromModal(); break;
                case 'adjustPOSModalQty': logger.info('POS', `Adjust modal qty: ${val}`); (await useMod('pos')).adjustPOSModalQty(parseInt(val, 10)); break;
                case 'openCartAddonPicker': logger.info('POS', `Open cart addon picker: ${id}`); (await useMod('pos')).openCartAddonPicker(id); break;
                case 'walkinQtyChange': logger.info('POS', `Cart qty change: ${id} (${val})`); (await useMod('pos')).walkinQtyChange(id, parseInt(val, 10)); break;
                case 'walkinRemoveItem': logger.info('POS', `Remove from cart: ${id}`); (await useMod('pos')).removeFromWalkinCart(id); break;
                case 'filterWalkinByCategory': logger.info('POS', `Filter by category: ${val}`); (await useMod('pos')).filterWalkinByCategory(val, el); break;
                case 'selectPOSSize': logger.info('POS', `Select size: ${name} (₹${price})`); (await useMod('pos')).selectPOSSize(name, parseFloat(price), el); break;
                case 'togglePOSAddon': logger.info('POS', `Toggle addon: ${name} (₹${price})`); (await useMod('pos')).togglePOSAddon(name, parseFloat(price), el); break;
                case 'triggerClick': {
                    logger.info('UI', `Trigger click: ${val}`);
                    const target = document.getElementById(val);
                    if (target) target.click();
                    break;
                }
                case 'markDelivered': logger.info('ORDERS', `Mark delivered: ${id}`); (await useMod('orders')).updateStatus(id, 'Delivered'); break;
                case 'editDish': logger.info('CATALOG', `Edit dish: ${id}`); (await useMod('catalog')).editDish(id); break;
                case 'deleteDish': logger.info('CATALOG', `Delete dish: ${id}`); (await useMod('catalog')).deleteDish(id); break;
                case 'editCategory': logger.info('CATALOG', `Edit category: ${id}`); (await useMod('catalog')).editCategory(id); break;
                case 'adjustStock': logger.info('INVENTORY', `Adjust stock: ${id} (${val})`); (await useMod('inventory')).adjustStock(id, parseInt(val, 10)); break;
                case 'editInventoryItem': logger.info('INVENTORY', `Edit item: ${id}`); (await useMod('inventory')).editInventoryItem(id); break;
                case 'deleteInventoryItem': logger.info('INVENTORY', `Delete item: ${id}`); (await useMod('inventory')).deleteInventoryItem(id); break;
                case 'viewStockHistory': {
                    logger.info('INVENTORY', `View stock history: ${id}`);
                    const extras = await useMod('inventory-extras');
                    extras.viewStockHistory(id, el.getAttribute('data-name'));
                    break;
                }
                case 'exportInventoryCSV': logger.info('INVENTORY', 'Export CSV'); (await useMod('inventory-extras')).exportInventoryCSV(); break;
                case 'triggerInventoryImport': logger.info('INVENTORY', 'Trigger CSV import'); (await useMod('inventory-extras')).triggerInventoryImport(); break;
                case 'showRiderModal':
                case 'showAddRiderModal': logger.info('RIDERS', 'Open add rider modal'); (await useMod('riders')).showRiderModal(); break;
                case 'closeModal':
                case 'hideReauthModal':
                case 'hideInventoryModal': {
                    const modal = el.closest('.modal');
                    logger.info('MODAL', `Close modal: ${modal?.id || 'unknown'}`);
                    if (modal) {
                        modal.classList.add('hidden');
                        modal.classList.remove('active', 'flex');
                    }
                    break;
                }
                case 'completeSiteRefresh': logger.warn('SYSTEM', 'Nuclear refresh triggered'); completeSiteRefresh(); break;
                case 'toggleNotificationSheet': logger.info('NOTIF', 'Toggle notification sheet'); (await useMod('notifications')).toggleNotificationSheet(); break;
                case 'toggleSidebar': logger.info('UI', 'Toggle sidebar'); toggleSidebar(); break;
                case 'toggleMobileCart': {
                    logger.info('POS', 'Toggle mobile cart');
                    toggleMobileCart(true);
                    break;
                }
                case 'openOutletInNewTab': logger.info('OUTLET', 'Open outlet in new tab'); openOutletInNewTab(); break;

                case 'userLogout': logger.warn('AUTH', 'User logout'); userLogout(); break;
                case 'installPWA': logger.info('PWA', 'Install PWA'); installPWA(); break;
                case 'removeRow': logger.info('UI', 'Remove row'); el.closest('tr').remove(); break;
                case 'addFeeSlab': logger.info('SETTINGS', 'Add delivery fee slab'); (await useMod('settings')).addFeeSlab(); break;
                case 'migrateAddons': logger.warn('CATALOG', 'Migrate addons to categories'); (await useMod('catalog')).migrateAddonsToCategories(); break;
                case 'runImageMigration': logger.warn('CATALOG', 'Run image migration'); (await useMod('catalog')).runImageMigration(); break;
                case 'clearWalkinCart': logger.info('POS', 'Clear walkin cart'); (await useMod('pos')).clearWalkinCart(); break;
                case 'submitWalkinSale': logger.info('POS', 'Submit walkin sale'); (await useMod('pos')).submitWalkinSale(); break;
                case 'addCategory': logger.info('CATALOG', 'Add category'); (await useMod('catalog')).addCategory(); break;

                case 'openPromotionsGuide': {
                    logger.info('PROMO', 'Open promotions guide');
                    const { renderPromotionsGuide } = await useMod('promotions-guide');
                    renderPromotionsGuide(document.getElementById('promotionsGuideBody'));
                    document.getElementById('promotionsGuideModal')?.classList.add('active');
                    break;
                }
                case 'closePromotionsGuide': logger.info('PROMO', 'Close promotions guide'); document.getElementById('promotionsGuideModal')?.classList.remove('active'); break;
                case 'openPageGuide': {
                    logger.info('HELP', 'Open page guide');
                    const { renderPageGuide } = await useMod('page-guide');
                    renderPageGuide(document.getElementById('pageGuideBody'));
                    document.getElementById('pageGuideModal')?.classList.add('active');
                    break;
                }
                case 'closePageGuide': logger.info('HELP', 'Close page guide'); document.getElementById('pageGuideModal')?.classList.remove('active'); break;
                case 'openActivityLog': renderActivityLog(); document.getElementById('activityLogModal')?.classList.add('active'); break;
                case 'closeActivityLog': document.getElementById('activityLogModal')?.classList.remove('active'); break;
                case 'clearActivityLog': logger.clear(); renderActivityLog(); break;
                case 'copyActivityLog': {
                    const text = logger.history().map(e => `[${e.ts}] ${e.level.toUpperCase()} ${e.category}: ${e.message}`).join('\n');
                    navigator.clipboard?.writeText(text).then(() => showToast('Logs copied to clipboard', 'success'));
                    break;
                }
                case 'pickPromoTemplate': {
                    logger.info('PROMO', 'Open template picker');
                    const { renderTemplatePicker } = await useMod('promotions-templates');
                    renderTemplatePicker(document.getElementById('promoTemplatePickerBody'));
                    document.getElementById('promoTemplatePickerModal')?.classList.add('active');
                    break;
                }
                case 'closePromoTemplatePicker': logger.info('PROMO', 'Close template picker'); document.getElementById('promoTemplatePickerModal')?.classList.remove('active'); break;
                case 'newDiscount': logger.info('DISCOUNT', 'New discount'); window.__discounts?.openEditor(null); break;
                case 'editDiscount': logger.info('DISCOUNT', `Edit discount: ${el.dataset.id}`); window.__discounts?.openEditor(el.dataset.id); break;
                case 'closeDiscountEditor': logger.info('DISCOUNT', 'Close editor'); window.__discounts?.closeEditor(); break;
                case 'saveDiscount': logger.info('DISCOUNT', 'Save discount'); window.__discounts?.save(); break;
                case 'deleteDiscount': logger.info('DISCOUNT', `Delete discount: ${el.dataset.id}`); window.__discounts?.remove(el.dataset.id); break;
                case 'viewDiscountUsage': logger.info('DISCOUNT', `View discount usage: ${el.dataset.id}`); (await useMod('discountsReports')).openDiscountUsageDirect?.(el.dataset.id); break;
                case 'openDiscountsReports': logger.info('DISCOUNT', 'Open discount reports'); (await useMod('discountsReports')).openDiscountsReports?.(); break;
                case 'closeDiscountsReports': logger.info('DISCOUNT', 'Close discount reports'); (await useMod('discountsReports')).closeDiscountsReports?.(); break;
                case 'setDiscountReportRange': logger.info('DISCOUNT', 'Set report range'); (await useMod('discountsReports')).setDiscountReportRange?.(el); break;
                case 'refreshDiscountsReport': logger.info('DISCOUNT', 'Refresh report'); (await useMod('discountsReports')).refreshDiscountsReport?.(); break;
                case 'exportDiscountsReport': logger.info('DISCOUNT', 'Export report'); (await useMod('discountsReports')).exportDiscountsReport?.(); break;
                case 'viewCodeUses': {
                    const discId = el.getAttribute('data-discount-id');
                    logger.info('DISCOUNT', `View code uses: ${discId}`);
                    await (await useMod('discountsReports')).openCodeUses?.(discId);
                    break;
                }
                case 'closeCodeUsesPanel':
                    logger.info('DISCOUNT', 'Close code uses panel');
                    (await useMod('discountsReports')).closeCodeUsesPanel?.();
                    break;
                case 'generateCouponCode': {
                    logger.info('DISCOUNT', 'Generate coupon code');
                    const prefix = (document.getElementById('discCouponPrefix')?.value || '').trim().toUpperCase();
                    const code = (await useMod('discountsReports')).generateCouponCode?.(prefix);
                    const input = document.getElementById('discCouponCode');
                    if (input && code) input.value = code;
                    break;
                }
                case 'addSizeField': logger.info('CATALOG', 'Add size field'); (await useMod('catalog')).addSizeField(); break;
                case 'addDishAddonField': logger.info('CATALOG', 'Add dish addon field'); (await useMod('catalog')).addDishAddonField(); break;
                case 'addCategoryAddonField': logger.info('CATALOG', 'Add category addon field'); (await useMod('catalog')).addCategoryAddonField(); break;
                case 'addCategoryEditAddon': logger.info('CATALOG', 'Add category edit addon field'); (await useMod('catalog')).addCategoryEditAddonField(); break;
                case 'saveCategory': logger.info('CATALOG', 'Save category'); (await useMod('catalog')).saveCategoryEdits(); break;
                case 'hideCategoryModal': logger.info('CATALOG', 'Hide category modal'); (await useMod('catalog')).hideCategoryModal(); break;
                case 'saveRiderAccount': logger.info('RIDERS', 'Save rider account'); (await useMod('riders')).saveRiderAccount(); break;
                case 'applyWalkinDiscount': {
                    const amt = el.getAttribute('data-amount');
                    const pct = el.getAttribute('data-pct');
                    logger.info('POS', `Apply discount: ${amt ? '₹' + amt : pct + '%'}`);
                    const p = await useMod('pos');
                    if (amt) p.setDiscount(parseFloat(amt));
                    else if (pct) p.setDiscountPct(parseFloat(pct));
                    break;
                }
                case 'applyWalkinCoupon': {
                    const couponVal = document.getElementById('walkinCouponCode')?.value;
                    logger.info('POS', `Apply coupon: ${couponVal}`);
                    (await useMod('pos')).applyWalkinCoupon();
                    break;
                }
                case 'clearWalkinCoupon': {
                    logger.info('POS', 'Clear coupon');
                    (await useMod('pos')).clearWalkinCoupon();
                    break;
                }
                case 'loadMoreOrders': logger.info('ORDERS', 'Load more orders'); (await useMod('orders')).loadMoreOrders(); break;
                case 'selectWalkinPayment': {
                    const method = el.getAttribute('data-method');
                    logger.info('POS', `Select payment: ${method}`);
                    (await useMod('pos')).selectWalkinPayment(method, el);
                    break;
                }
                case 'previewPromo':
                    (await useMod('promotions'))._preview?.();
                    break;
                case 'sendTestPromo':
                    (await useMod('promotions'))._sendTest?.();
                    break;
                case 'openTableDrawerByOrder': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Open table drawer by order'); window.__tables?.openDrawerByOrder?.(el.getAttribute('data-order-id') || id); break;
                case 'openTableDrawer': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Open table drawer'); window.__tables?.openDrawer?.(id); break;
                case 'editTable': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Edit table'); window.__tables?.openEditor?.(id); break;
                case 'deleteTable': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Delete table'); window.__tables?.delete?.(id); break;
                case 'enableTable': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Enable table'); window.__tables?.setTableEnabled?.(id, true); break;
                case 'disableTable': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Disable table'); window.__tables?.setTableEnabled?.(id, false); break;
                case 'requestBillForTable': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Request bill'); window.__tables?.requestBill?.(id); break;
                case 'requestBillForGroup': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Request bill for group'); window.__tables?.requestBillForGroup?.(id, el.getAttribute('data-group-id')); break;
                case 'makePaymentForGroup': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Mark group paid'); window.__tables?.makePaymentForGroup?.(id, el.getAttribute('data-group-id')); break;
                case 'makePaymentForTable': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Make payment'); window.__tables?.makePaymentForTable?.(id); break;
                case 'closeExpiredSession': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Close expired session'); window.__tables?.closeExpiredSession?.(id); break;
                case 'printTableKOT': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Print KOT'); window.__tables?.printKOT?.(id); break;
                case 'printSessionBill': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Print session bill'); window.__tables?.printSessionBill?.(id); break;
                case 'printBillForGroup': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Print bill for group'); window.__tables?.printBillForGroup?.(id, el.getAttribute('data-group-id')); break;
                case 'advanceTableOrder': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Advance order'); window.__tables?.advanceOrder?.(id, el.getAttribute('data-next')); break;
                case 'jumpToOrderInOrdersTab': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Jump to order'); window.__tables?.jumpToOrder?.(id); break;
                case 'openTableQr': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Open table QR'); window.__tables?.openQr?.(id); break;
                case 'closeSessionForTable': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Close session'); window.__tables?.closeSession?.(id); break;
                case 'cancelSessionForTable': if (e.target.closest('#tab-tables')) break; logger.info('TABLES', 'Cancel session'); window.__tables?.cancelSession?.(id); break;
                default:
                    logger.warn('CLICK', `Unhandled action: ${action}`, { el: el.outerHTML.slice(0, 200) });
            }
        } catch (err) {
            logger.error('CLICK', `Click handler error: ${err.message}`, err);
            showToast("An error occurred: " + err.message, "error");
        }
    });

    initAuth();
    (await useMod('rider-analytics')).initRiderAnalytics();
    (await useMod('inventory')).initInventory();

    await loadLucide();
    const overlay = document.getElementById('authOverlay');
    const layout = document.querySelector('.layout');
    if (overlay) window.lucide.createIcons({ root: overlay });
    if (layout) window.lucide.createIcons({ root: layout });

    let _staticListenersBound = false;
    const setupStaticListeners = () => {
        if (_staticListenersBound) return;
        _staticListenersBound = true;
        document.addEventListener('error', (e) => {
            if (e.target.tagName === 'IMG') {
                e.target.src = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'150\' height=\'150\' viewBox=\'0 0 150 150\'%3E%3Crect width=\'100%25\' height=\'100%25\' fill=\'%23eee\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' dominant-baseline=\'middle\' text-anchor=\'middle\' font-family=\'sans-serif\' font-size=\'12\' fill=\'%23999\'%3ENo Image%3C/text%3E%3C/svg%3E';
            }
        }, true);

        const bindClickTo = (btnId, targetId) => {
            const btn = document.getElementById(btnId);
            if (btn) btn.addEventListener('click', () => {
                const target = document.getElementById(targetId);
                if (target) target.click();
            });
        };

        document.addEventListener('click', (e) => {
            if (e.target.closest('.close-btn, .cancel-dish-btn, .btn-hide-modal')) {
                const modal = e.target.closest('.modal');
                if (modal) {
                    modal.classList.remove('active', 'flex');
                    modal.classList.add('hidden');
                }
            }
        });

        const orderOverlay = document.getElementById('orderDrawerOverlay');
        if (orderOverlay) {
            orderOverlay.addEventListener('click', () => {
                useMod('orders').then(o => o.closeOrderDrawer());
            });
        }

        document.querySelectorAll('.btn-show-dish-modal').forEach(btn => {
            btn.addEventListener('click', async () => {
                (await useMod('catalog')).showDishModal();
            });
        });
        document.getElementById('btnMigrateDishAddons')?.addEventListener('click', async () => {
            (await useMod('catalog')).migrateAddonsToCategories();
        });
        bindClickTo('btnChangeCatPhoto', 'catFile');

        document.getElementById('catFile')?.addEventListener('change', (e) => {
            previewImage(e.target, 'catPreview');
        });

        bindClickTo('btnUploadRiderPhoto', 'riderPhotoInput');
        document.getElementById('riderPhotoInput')?.addEventListener('change', (e) => {
            previewImage(e.target, 'riderProfilePreview');
        });

        document.getElementById('riderSearchInput')?.addEventListener('input', async (e) => {
            (await useMod('riders')).renderRiders(e.target.value);
        });

        bindClickTo('btnUploadAadhar', 'aadharPhotoInput');
        document.getElementById('aadharPhotoInput')?.addEventListener('change', (e) => {
            previewImage(e.target, 'aadharPreview');
        });

        document.getElementById('btnClearAllNotif')?.addEventListener('click', async () => {
            (await useMod('notifications')).clearAllNotifications();
        });
        document.getElementById('btnClearNotificationsBottom')?.addEventListener('click', async () => {
            (await useMod('notifications')).clearAllNotifications();
        });
        document.getElementById('btnClearLostSales')?.addEventListener('click', async () => {
            (await useMod('lost-sales')).clearLostSales();
        });
        document.getElementById('btnEnableNotif')?.addEventListener('click', async () => {
            (await useMod('notifications')).requestNotificationPermission();
        });
        document.getElementById('btnTestNotif')?.addEventListener('click', async () => {
            (await useMod('notifications')).testNotification();
        });

        // Login is handled by auth.js initAuth()

        document.getElementById('btnSaveSettings')?.addEventListener('click', async () => {
            (await useMod('settings')).saveStoreSettings();
        });
        document.getElementById('btnQuickToggleOutlet')?.addEventListener('click', async () => {
            (await useMod('settings')).quickUpdateOutletStatus();
        });
        document.getElementById('btnAddFeeSlab')?.addEventListener('click', async () => {
            (await useMod('settings')).addFeeSlab();
        });
        document.getElementById('btnMigrateAddons')?.addEventListener('click', async () => {
            (await useMod('catalog')).migrateAddonsToCategories();
        });
        document.getElementById('btnRunImageMigration')?.addEventListener('click', async () => {
            (await useMod('catalog')).runImageMigration();
        });

        document.getElementById('btnShowPOSSelection')?.addEventListener('click', async () => {
            (await useMod('pos')).openPOSSelectionModal();
        });
        document.getElementById('btnPosPrintLast')?.addEventListener('click', async () => {
            (await useMod('printing')).reprintLastPosReceipt();
        });

        document.getElementById('btnPosQtyDec')?.addEventListener('click', async () => {
            (await useMod('pos')).adjustPOSModalQty(-1);
        });
        document.getElementById('btnPosQtyInc')?.addEventListener('click', async () => {
            (await useMod('pos')).adjustPOSModalQty(1);
        });

        bindClickTo('btnUpdateDishPhoto', 'dishFile');
        document.getElementById('dishFile')?.addEventListener('change', (e) => {
            previewImage(e.target, 'dishPreview');
        });
        document.getElementById('saveDishBtn')?.addEventListener('click', async () => {
            (await useMod('catalog')).saveDish();
        });

        bindClickTo('btnChangeCatEditPhoto', 'catEditFile');
        document.getElementById('catEditFile')?.addEventListener('change', (e) => {
            previewImage(e.target, 'catEditPreview');
        });
        document.getElementById('btnSaveCategory')?.addEventListener('click', async () => {
            (await useMod('catalog')).saveCategoryEdits();
        });
        document.getElementById('btnAddCatEditAddon')?.addEventListener('click', async () => {
            (await useMod('catalog')).addCategoryEditAddonField();
        });

        const setupPassToggle = (btnId, inputId) => {
            const btn = document.getElementById(btnId);
            const input = document.getElementById(inputId);
            if (btn && input) {
                btn.addEventListener('click', async () => {
                    const isPass = input.type === 'password';
                    input.type = isPass ? 'text' : 'password';
                    btn.innerHTML = isPass ? '<i data-lucide="eye-off" class="icon-16"></i>' : '<i data-lucide="eye" class="icon-16"></i>';
                    await loadLucide();
                    window.lucide.createIcons({ root: btn });
                });
            }
        };

        setupPassToggle('btnToggleWifiPass', 'settingWifiPass');
        setupPassToggle('btnToggleRiderPass', 'riderPass');

        const reportOutletFilter = document.getElementById('reportOutletFilter');
        if (reportOutletFilter) {
            reportOutletFilter.addEventListener('change', async (e) => {
                const r = await useMod('analytics');
                if (r.setOutletFilter) r.setOutletFilter(e.target.value);
            });
        }

        document.getElementById('btnDownloadExcel')?.addEventListener('click', async () => {
            const r = await useMod('analytics');
            r.downloadExcel?.();
        });
        document.getElementById('btnDownloadPDF')?.addEventListener('click', async () => {
            const r = await useMod('analytics');
            r.downloadPDF?.();
        });
    };
    setupStaticListeners();

    document.addEventListener('change', async (e) => {
        try {
            const el = e.target;
            const action = el.getAttribute('data-action');
            if (!action) return;
            const id = el.getAttribute('data-id');
            const val = el.value;

            logger.action('CHANGE', `→ ${action} (id=${id || '-'}, val=${val})`);

            switch (action) {
                case 'updateStatus': (await useMod('orders')).updateStatus(id, val); break;
                case 'assignRider': (await useMod('orders')).assignRider(id, val); break;
                case 'toggleDish': (await useMod('catalog')).toggleDishAvailable(id, el.checked); break;
                case 'togglePOSAddon':
                    (await useMod('pos')).togglePOSAddon(el.getAttribute('data-name'), parseFloat(el.getAttribute('data-price')), el);
                    break;
                case 'previewImage':
                    previewImage(el, el.getAttribute('data-preview-id'));
                    break;
                case 'switchOutlet': switchOutlet(val); break;
            }
        } catch (err) {
            logger.error('CHANGE', `Change handler error: ${err.message}`, err);
        }
    });

    document.addEventListener('input', async (e) => {
        const el = e.target;
        if (!el.id) return;
        const val = el.value;
        if (el.id === 'walkinDishSearch') {
            (await useMod('pos')).applyWalkinFilters();
        } else if (el.id === 'orderSearch') {
            (await useMod('orders')).filterOrders(val);
        } else if (el.id === 'customerSearch') {
            (await useMod('customers')).filterCustomers(val);
        } else if (el.id === 'menuSearch') {
            (await useMod('catalog')).filterMenu(val);
        } else if (el.id === 'categorySearch') {
            (await useMod('catalog')).filterCategories(val);
        } else if (el.id === 'inventorySearch') {
            (await useMod('inventory')).setInventorySearch(val);
        }
    });

    document.getElementById('inventoryImportInput')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) {
            logger.info('INVENTORY', `Import file selected: ${file.name} (${file.size} bytes)`);
            (await useMod('inventory-extras')).handleInventoryImportFile(file);
            e.target.value = '';
        }
    });
    
    const triggerOrderRender = () => {
        logger.info('ORDERS', 'Date range changed, reloading orders');
        useMod('orders').then(o => {
            o.initRealtimeListeners();
            if (state.currentActiveTab === 'orders') o.loadOrdersPage(true);
        });
    };
    document.getElementById('orderFrom')?.addEventListener('change', triggerOrderRender);
    document.getElementById('orderTo')?.addEventListener('change', triggerOrderRender);

    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
            logger.info('KEYBOARD', 'Escape pressed');
            const activeModal = document.querySelector('.modal.active:not(.hidden)');
            if (activeModal) {
                activeModal.classList.add('hidden');
                activeModal.classList.remove('active', 'flex');
                logger.info('MODAL', `Closed via Escape: ${activeModal.id || 'unknown'}`);
                return;
            }

            if (window.innerWidth <= 1024) {
                import('./ui.js').then(u => u.closeSidebar());
            }

            await Promise.all([
                useMod('orders').then(o => o.closeOrderDrawer()),
                useMod('notifications').then(n => n.toggleNotificationSheet(false)),
                useMod('pos').then(p => p.hidePOSSelectionModal())
            ]);
        }
    });

    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (!form || form === document.body) return;
        logger.info('FORM', `Form submit: id=${form.id || '(none)'} class=${form.className?.slice(0, 50) || '-'}`);
    });

    document.addEventListener('focusin', (e) => {
        const el = e.target;
        if (el.id && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
            logger.data('INPUT', `Focus: #${el.id} (${el.type || el.tagName.toLowerCase()})`);
        }
    });

    // Live activity log streaming into the modal
    const logContainer = () => document.getElementById('activityLogEntries');
    const logCount = () => document.getElementById('activityLogCount');
    const appendLogEntry = (entry) => {
        const c = logContainer();
        if (!c) return;
        const colors = { info:'#3b82f6', success:'#10b981', warn:'#f59e0b', error:'#ef4444', action:'#8b5cf6', nav:'#06b6d4', data:'#64748b', firebase:'#f97316' };
        const row = document.createElement('div');
        row.style.cssText = 'padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.04); display:flex; gap:8px; align-items:flex-start;';
        row.innerHTML = `<span style="color:#64748b; min-width:80px; flex-shrink:0;">${entry.ts}</span><span style="color:${colors[entry.level] || '#94a3b8'}; font-weight:700; min-width:90px; flex-shrink:0;">${entry.level.toUpperCase()}</span><span style="color:#cbd5e1; min-width:90px; flex-shrink:0;">${entry.category}</span><span style="color:#e2e8f0; flex:1; word-break:break-word;">${escapeHtml(entry.message)}</span>`;
        c.appendChild(row);
        const body = document.getElementById('activityLogBody');
        if (body) body.scrollTop = body.scrollHeight;
        if (logCount()) logCount().textContent = `${c.children.length} entries`;
    };
    window.addEventListener('admin:log', (e) => appendLogEntry(e.detail));
    document.getElementById('activityLogFilter')?.addEventListener('change', renderActivityLog);

    function renderActivityLog() {
        const c = logContainer();
        if (!c) return;
        const filter = document.getElementById('activityLogFilter')?.value || '';
        c.innerHTML = '';
        const entries = logger.history();
        const filtered = filter ? entries.filter(e => {
            if (filter === 'WARN') return e.level === 'warn';
            if (filter === 'ERROR') return e.level === 'error';
            if (filter === 'SUCCESS') return e.level === 'success';
            return e.category === filter || e.level === filter.toLowerCase();
        }) : entries;
        filtered.forEach(appendLogEntry);
        if (logCount()) logCount().textContent = `${filtered.length} of ${entries.length} entries`;
    }

    // bfcache: no beforeunload listener — use pagehide instead
    window.addEventListener('pagehide', () => {
        // cleanup handled by visibilitychange in individual modules
    });

    logAudit('SYSTEM_INIT', { 
        agent: 'Antigravity',
        version: '5.2.0',
        timestamp: new Date().toISOString()
    });

    // Bot status on the dashboard widget
    window.addEventListener('botStatusChange', (e) => {
        const el = document.getElementById('promoKillWidgetBotStatus');
        if (!el) return;
        const { online, lastSeen } = e.detail;
        if (online) {
            el.innerHTML = '🟢 Bot online';
            el.className = 'text-success';
        } else {
            const ago = lastSeen ? Math.floor((Date.now() - lastSeen) / 1000 / 60) : '?';
            el.innerHTML = `🔴 Bot offline${lastSeen ? ` — ${ago}m ago` : ''}`;
            el.className = 'text-danger';
        }
    });
    // Seed from global if bot-status.js loaded first
    if (window._botOnline !== undefined) {
        const el = document.getElementById('promoKillWidgetBotStatus');
        if (el) {
            el.innerHTML = window._botOnline ? '🟢 Bot online' : '🔴 Bot offline';
            el.className = window._botOnline ? 'text-success' : 'text-danger';
        }
    }
});

console.log("\uD83D\uDE80 FoodHubbie ERP Modules Loaded");
