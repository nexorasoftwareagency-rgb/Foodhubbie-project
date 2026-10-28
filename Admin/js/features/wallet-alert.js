/**
 * FoodHubbie ERP | WALLET LOW-BALANCE ALERT  (Admin/js/features/wallet-alert.js)
 *
 * Dashboard banner shown when the wallet is at or below 25% of everything topped up so far
 * ("low"), or finished ("empty"). Read-only. Uses the same math as the Cost tab wallet
 * (shared/cost-math.js). Orders are read once and cached for a few minutes, because the
 * balance needs lifetime usage; restaurants that never topped up are skipped (the setup
 * checklist covers them) so new outlets cost no extra read.
 */
import { Outlet, get } from '../firebase.js';
import { canAccessTab, SUPPORT_WA } from '../ui.js';
import { computeWallet, LOW_BALANCE_RATIO } from '../../shared/cost-math.js';

const PANEL_ID = 'walletAlert';
const CACHE_MS = 5 * 60 * 1000;
let _cache = null; // { at, outlet, wallet }

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

async function loadWallet() {
    if (_cache && _cache.outlet === Outlet.current && Date.now() - _cache.at < CACHE_MS) return _cache.wallet;
    const billingSnap = await get(Outlet.ref('billing'));
    const billing = billingSnap.val() || {};
    // Never topped up: nothing to warn about, skip the heavy orders read.
    const paidAny = Object.values(billing.payments || {}).some((p) => Number(p && p.amount) > 0);
    let wallet;
    if (!paidAny) {
        wallet = computeWallet({ billing });
    } else {
        const [ordersSnap, campSnap] = await Promise.all([
            get(Outlet.ref('orders')),
            get(Outlet.ref('bot/promotions/campaigns')).catch(() => null),
        ]);
        wallet = computeWallet({ billing, orders: ordersSnap.val() || {}, campaigns: campSnap ? campSnap.val() || {} : {} });
    }
    _cache = { at: Date.now(), outlet: Outlet.current, wallet };
    return wallet;
}

export async function loadWalletAlert() {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    el.style.display = 'none';
    // Same audience as the Cost tab; staff without access don't manage money.
    if (!canAccessTab('costs')) return;
    try {
        const w = await loadWallet();
        if (w.level !== 'low' && w.level !== 'empty') return;
        const empty = w.level === 'empty';
        const pct = Math.round(LOW_BALANCE_RATIO * 100);
        el.style.cssText = `display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px 16px;border-radius:10px;border-left:4px solid ${empty ? '#dc2626' : '#f59e0b'};`;
        el.innerHTML = `<div><strong>${empty ? 'Wallet balance finished' : 'Low wallet balance'}</strong>
            <div class="text-muted-small">${empty
                ? `Your balance is ${w.balance < 0 ? '−' : ''}${inr(Math.abs(w.balance))}. Top up now to avoid interruption.`
                : `${inr(w.balance)} left, which is ${pct}% or less of what you have topped up. Top up soon.`}</div></div>
            <div style="display:flex;gap:8px"><button type="button" class="btn-primary btn-sm" data-wallet-alert-contact>Top up via support</button>
            ${canAccessTab('costs') ? '<button type="button" class="btn-secondary btn-sm" data-action="switchTab" data-tab="costs">View wallet</button>' : ''}</div>`;
        el.querySelector('[data-wallet-alert-contact]')?.addEventListener('click', () => window.open(SUPPORT_WA, '_blank', 'noopener'));
    } catch (e) {
        console.warn('[WalletAlert] skipped:', e && e.message);
    }
}
