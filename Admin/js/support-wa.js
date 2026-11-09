/**
 * FoodHubbie ERP | SUPPORT HAND-OFF TEXT  (Admin/js/support-wa.js)
 *
 * Every "contact support" button prefills WhatsApp. Supreme Admin finds a tenant
 * by its business id + outlet id (that pair is the profile URL), and the admin
 * email says who is asking — a store name alone is ambiguous (two outlets can
 * share one, and the name is editable).
 *
 * Pure: no imports beyond the published minimum, so the wallet guard can run it
 * for real (tests/admin-wallet-checklist.check.mjs).
 */
import { MIN_TOPUP } from '../../shared/cost-math.js';

/**
 * @param {'topup'|'connect'} kind
 * @param {{storeName?: string, amount?: string, bid?: string, oid?: string, email?: string}} [opts]
 *   amount is the already-formatted minimum ("₹1,500" for a WhatsApp outlet).
 * @returns {string} the message body (no URL encoding)
 */
export function supportWaText(kind = 'topup', { storeName, amount, bid, oid, email } = {}) {
    const name = String(storeName || '').trim() || 'my restaurant';
    const min = amount || `\u20B9${MIN_TOPUP.toLocaleString('en-IN')}`;
    const first = kind === 'connect'
        ? `Hi FoodHubbie Team! I want to connect WhatsApp ordering for ${name}.`
        : `Hi FoodHubbie Team! I want to top up my wallet (minimum ${min}) for ${name} and go live.`;
    const details = [];
    if (bid) details.push(`Business ID: ${bid}`);
    if (oid) details.push(`Outlet ID: ${oid}`);
    if (email) details.push(`Admin email: ${email}`);
    return details.length ? `${first}\n\n${details.join('\n')}` : first;
}
