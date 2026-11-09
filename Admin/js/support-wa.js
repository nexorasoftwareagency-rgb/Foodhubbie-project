/**
 * FoodHubbie ERP | support-wa.js
 *
 * Single source of truth for the WhatsApp support message text.
 *
 * Every "contact support" button goes through Admin/js/ui.js#supportWaFor(kind, opts)
 * which calls supportWaText(kind, {...}) here. This keeps the wording in one place
 * so it can't drift between the locked screen, locked banner, Costs wallet alert,
 * low-balance alert, and setup checklist.
 *
 * @param {string} kind - 'topup' (the only kind used)
 * @param {Object} opts
 * @param {string} opts.storeName - restaurant store name (from settings/Store.storeName)
 * @param {number} opts.amount - minimum top-up amount in rupees (₹1,000 or ₹1,500 for WhatsApp)
 * @param {string} opts.bid - business id (BUSINESS_ID())
 * @param {string} opts.oid - outlet id (Outlet.current)
 * @param {string} opts.email - applicant/admin email (state.adminData.email)
 * @returns {string} plain-text message body for WhatsApp
 */
export function supportWaText(kind = 'topup', { storeName, amount, bid, oid, email } = {}) {
    const greeting = kind === 'topup'
        ? `Hi FoodHubbie support — I'd like to top up my restaurant's wallet.`
        : `Hi FoodHubbie support — I need help with my restaurant account.`;

    const lines = [
        greeting,
        storeName ? `Restaurant: ${storeName}` : '',
        amount ? `Minimum top-up: ₹${amount.toLocaleString('en-IN')}` : '',
        '',
        'Business ID: ' + bid,
        'Outlet ID: ' + oid,
        'Admin email: ' + email,
    ];

    return lines.filter(Boolean).join('\n');
}
