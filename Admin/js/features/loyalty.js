// ============================================================================
// LOYALTY ADMIN — configure earn rate, tiers and rewards; look up a customer's
// loyalty record. Everything here runs on existing RTDB rules:
//   loyalty/config          admin write (outlet-scoped)
//   customers/{phone}/loyalty   public read by phone
//   loyalty/rankings/{phone}    public read by phone (single entry only)
//   customers/{phone}/rewards   public read by phone
//   customers/{phone}/orders    public read by phone
//   customers/{phone}/app       public read by phone
// No bulk reads are used: the rankings parent is deliberately read-restricted,
// so there is no full leaderboard in this view — individual customers are
// looked up by phone instead.
// ============================================================================

import { escapeHtml, showToast, showConfirm } from '../utils.js';
import { get, set } from '../firebase.js';
import { Outlet } from '../firebase.js';
import { logger } from '../utils/logger.js';

const TIER_KEYS = ['bronze', 'silver', 'gold'];
const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const TIER_COLOUR = { bronze: '#8a6d3b', silver: '#a8a8a8', gold: '#c5a005' };

const DEFAULTS = {
  earnRatePaisePerPoint: 2000,
  tiers: {
    bronze: { min: 0, label: 'Bronze', multiplier: 1 },
    silver: { min: 1000, label: 'Silver', multiplier: 1.25 },
    gold: { min: 5000, label: 'Gold', multiplier: 1.5 }
  },
  rewards: [
    { id: 'free-samosa', label: 'Free Samosa', cost: 200, type: 'item' },
    { id: '10pct-off', label: '10% Off Next Order', cost: 500, type: 'discount' },
    { id: 'free-dessert', label: 'Free Dessert', cost: 800, type: 'item' }
  ]
};

let _config = null;   // deep copy of what is shown in the form
let _server = null;   // last fetched server value, for change detection
let _editingReward = null;  // reward id currently edited inline, or null
let _formListenersAttached = false;

function normPhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    return d.slice(-10);
}

function validPhone(p) {
    return /^[6-9][0-9]{9}$/.test(p);
}

function tierLabel(t) {
    return TIER_LABEL[t] || t;
}

function tierColour(t) {
    return TIER_COLOUR[t] || '#6b7280';
}

function money(n) {
    const v = Number(n || 0);
    return '?' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
}

function ptsPer100(config) {
    const rate = Number(config && config.earnRatePaisePerPoint || DEFAULTS.earnRatePaisePerPoint);
    return (10000 / rate).toFixed(rate % 100 === 0 ? 0 : 2);
}

function tierForPoints(pts, config) {
    const tiers = (config && config.tiers) || DEFAULTS.tiers;
    let t = 'bronze';
    for (const k of TIER_KEYS) {
        const td = tiers[k];
        if (td && typeof td.min === 'number' && pts >= td.min) t = k;
    }
    return t;
}

function nextTier(pts, config) {
    const tiers = (config && config.tiers) || DEFAULTS.tiers;
    const cur = tierForPoints(pts, config);
    const curMin = tiers[cur]?.min || 0;
    for (const k of TIER_KEYS) {
        const td = tiers[k];
        if (td && typeof td.min === 'number' && td.min > curMin) {
            const range = td.min - curMin;
            return {
                k, label: td.label, min: td.min, multiplier: td.multiplier,
                percent: range > 0 ? Math.min(100, Math.floor(((pts - curMin) / range) * 100)) : 100
            };
        }
    }
    return null;
}

function cloneConfig(c) {
    if (!c) return JSON.parse(JSON.stringify(DEFAULTS));
    return {
        earnRatePaisePerPoint: Number(c.earnRatePaisePerPoint) || DEFAULTS.earnRatePaisePerPoint,
        tiers: { ...DEFAULTS.tiers, ...(c.tiers || {}) },
        rewards: Array.isArray(c.rewards) ? c.rewards.slice() : DEFAULTS.rewards.slice()
    };
}

function rewardSlug(label) {
    return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'reward';
}

function escapeHtmlAttr(s) {
    return String(s == null ? '' : s).replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- rendering

function renderTierRow(tk, tiers) {
    const td = tiers[tk] || { min: 0, label: TIER_LABEL[tk], multiplier: 1 };
    const isBronze = tk === 'bronze';
    const disabled = isBronze ? 'disabled' : '';
    return `
    <tr data-tier="${escapeHtml(tk)}">
        <td>
            <span style="color:${tierColour(tk)};font-weight:800;text-transform:uppercase;font-size:11px;">
                ${escapeHtml(tierLabel(tk))}
            </span>
            <div class="mob-td-sub" style="font-size:10.5px;">${isBronze ? 'everyone starts here' : 'points threshold'}</div>
        </td>
        <td class="mob-th-center">
            <input type="number" min="0" step="1" data-field="min" data-tier="${escapeHtml(tk)}"
                value="${Number(td.min || 0)}" class="mob-input-tier" ${disabled}>
            <div class="mob-td-sub">${isBronze ? 'fixed' : 'minimum points'}</div>
        </td>
        <td class="mob-th-center">
            <input type="number" min="0.1" step="0.05" data-field="mult" data-tier="${escapeHtml(tk)}"
                value="${Number(td.multiplier || 1).toFixed(2)}" class="mob-input-tier" ${disabled}>
            <div class="mob-td-sub">points earned per ?100</div>
        </td>
    </tr>`;
}

function renderRewardRow(r, editing) {
    if (editing && editing.id === r.id) {
        return `
    <tr data-reward="${escapeHtml(r.id)}">
        <td colspan="4">
            <div style="display:flex;gap:8px;align-items:center;">
                <input type="text" data-field="label" value="${escapeHtmlAttr(r.label)}" class="mob-input-reward" placeholder="Reward name">
                <input type="number" min="0" data-field="cost" value="${Number(r.cost || 0)}" class="mob-input-reward mob-input-cost" placeholder="0">
                <select data-field="type" class="mob-input-reward mob-input-type">
                    <option value="item" ${r.type === 'discount' ? '' : 'selected'}>Item</option>
                    <option value="discount" ${r.type === 'discount' ? 'selected' : ''}>Discount</option>
                </select>
                <button type="button" data-action="loyalty-save-reward" data-reward-id="${escapeHtml(r.id)}" class="btn-small btn-primary">Save</button>
                <button type="button" data-action="loyalty-cancel-edit" data-reward-id="${escapeHtml(r.id)}" class="btn-small btn-secondary">Cancel</button>
            </div>
        </td>
    </tr>`;
    }
    const typeChip = r.type === 'discount' ? 'mob-badge-type-dinein' : 'mob-badge-type-pos';
    return `
    <tr data-reward="${escapeHtml(r.id)}">
        <td>
            <div class="mob-td-strong">${escapeHtml(r.label || 'Reward')}</div>
            <div class="mob-td-sub">${escapeHtml(r.id)}</div>
        </td>
        <td class="mob-th-center">${Number(r.cost || 0)} pts</td>
        <td class="mob-th-center"><span class="mob-badge ${typeChip}">${escapeHtml(r.type || 'item')}</span></td>
        <td class="mob-th-center">
            <button type="button" data-action="loyalty-edit-reward" data-reward-id="${escapeHtml(r.id)}" class="btn-small btn-secondary">Edit</button>
            <button type="button" data-action="loyalty-delete-reward" data-reward-id="${escapeHtml(r.id)}" class="btn-small btn-secondary">Delete</button>
        </td>
    </tr>`;
}

function renderAddRewardRow() {
    return `
    <tr>
        <td colspan="4">
            <div style="display:flex;gap:8px;align-items:center;">
                <input type="text" id="loyalty-new-label" class="mob-input-reward" placeholder="Reward name (e.g. Free Samosa)">
                <input type="number" id="loyalty-new-cost" min="0" class="mob-input-reward mob-input-cost" placeholder="Cost in points">
                <select id="loyalty-new-type" class="mob-input-reward mob-input-type">
                    <option value="item">Item</option>
                    <option value="discount">Discount</option>
                </select>
                <button type="button" data-action="loyalty-add-reward" class="btn-small btn-primary">Add</button>
            </div>
        </td>
    </tr>`;
}

function renderConfigForm() {
    const c = _config;
    const rateRs = (c.earnRatePaisePerPoint || DEFAULTS.earnRatePaisePerPoint) / 100;
    const tiers = c.tiers || DEFAULTS.tiers;
    return `
    <div class="mob-card mob-table-card" style="margin:0;">
        <div class="mob-section-head-row">
            <h3 class="mob-card-title">Configure the program</h3>
            <p class="mob-td-sub" style="margin-left:auto;max-width:420px;color:var(--mob-sub);">
                Customers earn <b>${ptsPer100(c)} points per ?100 spent</b> ({money(c.earnRatePaisePerPoint / 100)} spent per point).
                Tier multipliers apply to points earned on each order.
            </p>
        </div>
        <div style="padding:16px;">
            <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <label style="font-size:12px;font-weight:600;color:var(--mob-sub);">Amount spent for 1 point (?)</label>
                    <input type="number" id="loyalty-earn-rate" min="1" step="1"
                        value="${Number(rateRs).toFixed(rateRs % 1 === 0 ? 0 : 2)}" class="mob-input-reward">
                </div>
                <button type="button" data-action="loyalty-save-config" class="btn-primary">Save program settings</button>
            </div>
            <table class="mob-data-table" style="margin-top:14px;">
                <thead>
                    <tr>
                        <th>Tier</th>
                        <th class="mob-th-center">Tier name</th>
                        <th class="mob-th-center">Minimum points</th>
                        <th class="mob-th-center">Multiplier</th>
                    </tr>
                </thead>
                <tbody>
                    ${TIER_KEYS.map(tk => renderTierRow(tk, tiers)).join('')}
                </tbody>
            </table>
        </div>
    </div>`;
}

function renderRewardsCatalog() {
    const rewards = (_config && _config.rewards) || DEFAULTS.rewards.slice();
    return `
    <div class="mob-card mob-table-card" style="margin:0;">
        <div class="mob-section-head-row">
            <h3 class="mob-card-title">Reward catalog</h3>
            <p class="mob-td-sub" style="margin-left:auto;max-width:420px;color:var(--mob-sub);">
                Rewards customers can redeem their points for. Edit a row to change it; deleted rewards stay valid
                for customers who already redeemed them.
            </p>
        </div>
        <div style="padding:16px;">
            <table class="mob-data-table">
                <thead>
                    <tr>
                        <th>Reward</th>
                        <th class="mob-th-center">Cost</th>
                        <th class="mob-th-center">Type</th>
                        <th class="mob-th-center">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${rewards.map(r => renderRewardRow(r, _editingReward)).join('')}
                    ${renderAddRewardRow()}
                </tbody>
            </table>
        </div>
    </div>`;
}

function fmtDate(ts) {
    if (!ts) return '\u2014';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
        + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function renderCustomerCard(phone, appRec, loyRec, rankRec, rewardsRec, ordersSnap) {
    const loy = loyRec || {};
    const pts = Number(loy.lifetimePoints || 0);
    const tier = loy.tier || tierForPoints(pts, _config);
    const disp = tierColour(tier);
    const nt = nextTier(pts, _config);
    const app = appRec || {};
    const orders = ordersSnap ? Object.entries(ordersSnap.val() || {})
        .map(([id, o]) => (o ? { id, ...o } : null)).filter(Boolean)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, 5) : [];
    const redeemed = rewardsRec ? Object.entries(rewardsRec.val() || {})
        .map(([id, r]) => (r ? { id, ...r } : null)).filter(Boolean)
        .sort((a, b) => Number(b.redeemedAt || 0) - Number(a.redeemedAt || 0)) : [];

    const rankLine = rankRec && Number.isFinite(Number(rankRec.rank))
        ? `<span class="mob-td-strong">Rank #${rankRec.rank}</span> <span class="mob-td-sub">among this kitchen's customers</span>`
        : `<span class="mob-td-sub">Not ranked yet</span>`;

    const progress = nt ? `<div style="font-size:11.5px;color:var(--mob-sub);margin-top:2px;">
        ${nt.k === null ? 'Top tier reached' : `${Math.max(0, nt.min - pts)} points to ${tierLabel(nt.k)}`}
        <div style="margin-top:4px;height:6px;background:var(--mob-line);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${nt.percent || 0}%;background:${disp};"></div>
        </div></div>` : `<div style="font-size:11.5px;color:var(--mob-sub);margin-top:2px;">Top tier reached</div>`;

    const recentOrders = orders.map(o => `
        <tr>
            <td class="mob-td-strong">${escapeHtml(o.orderId || o.id || '\u2014')}</td>
            <td class="mob-th-center">${fmtDate(o.createdAt)}</td>
            <td class="mob-th-right">${money(o.total || 0)}</td>
            <td class="mob-th-center"><span class="mob-badge mob-badge-status-${(o.status || 'placed').toLowerCase()}">${escapeHtml(o.status || 'Placed')}</span></td>
        </tr>`).join('');

    const redeemedRows = redeemed.map(r => `
        <tr>
            <td class="mob-td-strong">${escapeHtml(r.label || r.rewardId || 'Reward')}</td>
            <td class="mob-th-center">${escapeHtml(r.code || '\u2014')}</td>
            <td class="mob-th-center">${fmtDate(r.redeemedAt)}</td>
            <td class="mob-th-center">${escapeHtml(r.status || 'active')}</td>
        </tr>`).join('');

    return `
    <div class="mob-card mob-table-card" style="margin:0;">
        <div class="mob-section-head-row">
            <h3 class="mob-card-title">Customer: ${escapeHtml(phone)}</h3>
            <div class="mob-td-sub" style="margin-left:auto;">${escapeHtml(app.name || 'No name on file')} <span style="font-weight:700;">${escapeHtml(app.phone || phone)}</span></div>
        </div>
        <div style="padding:16px;">
            <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <span class="mob-td-sub">Tier</span>
                    <span style="color:${disp};font-weight:800;text-transform:uppercase;font-size:13px;">${tierLabel(tier)}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <span class="mob-td-sub">Points</span>
                    <span class="mob-td-strong" style="font-size:20px;">${pts}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <span class="mob-td-sub">Lifetime spent</span>
                    <span class="mob-td-strong">${money(loy.totalSpent || 0)}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <span class="mob-td-sub">Orders</span>
                    <span class="mob-td-strong">${Number(loy.orderCount || orders.length)}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    ${rankLine}
                </div>
            </div>
            <div style="margin-top:10px;">${progress}</div>
            ${redeemed.length ? `
            <table class="mob-data-table" style="margin-top:10px;">
                <thead><tr><th>Redeemed reward</th><th class="mob-th-center">Code</th><th class="mob-th-center">Redeemed on</th><th class="mob-th-center">Status</th></tr></thead>
                <tbody>${redeemedRows.join('')}</tbody>
            </table>` : `<p class="mob-table-empty" style="margin-top:10px;">No rewards redeemed yet.</p>`}
            ${orders.length ? `
            <table class="mob-data-table" style="margin-top:10px;">
                <thead><tr><th>Recent order</th><th class="mob-th-center">Date</th><th class="mob-th-right">Total</th><th class="mob-th-center">Status</th></tr></thead>
                <tbody>${recentOrders.join('')}</tbody>
            </table>` : ''}
        </div>
    </div>`;
}

function formatOrderId(o) {
    return o || '\u2014';
}

// ---------------------------------------------------------------- data

function cfgPath() {
    return Outlet.ref('loyalty/config');
}

async function readServerConfig() {
    try {
        const snap = await get(cfgPath());
        return snap && snap.exists() ? snap.val() : null;
    } catch (e) {
        console.warn('[Loyalty] config read failed:', e);
        return null;
    }
}

async function saveConfig() {
    const rateEl = document.getElementById('loyalty-earn-rate');
    const rateRs = parseFloat(rateEl.value);
    if (!Number.isFinite(rateRs) || rateRs <= 0) {
        showToast('Enter a valid amount per point', 'error');
        rateEl.focus();
        return;
    }
    const tiers = {};
    let ok = true;
    for (const tk of TIER_KEYS) {
        const row = document.querySelector(`tr[data-tier="${tk}"]`);
        if (!row) continue;
        const min = parseFloat(row.querySelector('[data-field="min"]').value);
        const mult = parseFloat(row.querySelector('[data-field="mult"]').value);
        const labelEl = row.querySelector('[data-field="label"]');
        const label = (labelEl && labelEl.value.trim()) || TIER_LABEL[tk];
        if (!Number.isFinite(min) || min < 0 || !Number.isFinite(mult) || mult <= 0) {
            ok = false;
            break;
        }
        tiers[tk] = { min, label, multiplier: mult };
    }
    if (!ok) { showToast('Enter valid tier thresholds and multipliers', 'error'); return; }

    const rewards = (_config && _config.rewards) || DEFAULTS.rewards.slice();
    const payload = {
        earnRatePaisePerPoint: Math.round(rateRs * 100),
        tiers,
        rewards
    };
    try {
        const btn = document.querySelector('[data-action="loyalty-save-config"]');
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving.';
        await set(cfgPath(), payload);
        _server = JSON.parse(JSON.stringify(payload));
        _config = cloneConfig(payload);
        btn.disabled = false;
        btn.textContent = oldText;
        showToast('Program settings saved', 'success');
        logger.info('LOYALTY', 'Config saved', { outlet: Outlet.current, earnRate: payload.earnRatePaisePerPoint });
        renderAll();
    } catch (e) {
        console.error('[Loyalty] save failed:', e);
        showToast('Save failed. Try again.', 'error');
        const btn = document.querySelector('[data-action="loyalty-save-config"]');
        if (btn) { btn.disabled = false; btn.textContent = 'Save program settings'; }
    }
}

async function saveRewards() {
    try {
        const btn = document.querySelector('[data-action="loyalty-add-reward"]');
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving.';
        const payload = {
            earnRatePaisePerPoint: (_config && _config.earnRatePaisePerPoint) || DEFAULTS.earnRatePaisePerPoint,
            tiers: (_config && _config.tiers) || DEFAULTS.tiers,
            rewards: (_config && _config.rewards) || DEFAULTS.rewards.slice()
        };
        await set(cfgPath(), payload);
        _server = JSON.parse(JSON.stringify(payload));
        btn.disabled = false;
        btn.textContent = oldText;
        showToast('Reward catalog saved', 'success');
        logger.info('LOYALTY', 'Rewards saved', { outlet: Outlet.current, count: payload.rewards.length });
        renderAll();
    } catch (e) {
        console.error('[Loyalty] reward save failed:', e);
        showToast('Save failed. Try again.', 'error');
    }
}

async function deleteReward(id) {
    const sure = await showConfirm(`Remove this reward from the catalog? Already redeemed codes stay valid for customers.`, 'Delete reward');
    if (!sure) return;
    const rewards = ((_config && _config.rewards) || DEFAULTS.rewards.slice()).filter(r => r.id !== id);
    const payload = {
        earnRatePaisePerPoint: (_config && _config.earnRatePaisePerPoint) || DEFAULTS.earnRatePaisePerPoint,
        tiers: (_config && _config.tiers) || DEFAULTS.tiers,
        rewards
    };
    try {
        await set(cfgPath(), payload);
        _server = JSON.parse(JSON.stringify(payload));
        _editingReward = null;
        showToast('Reward removed', 'success');
        renderAll();
    } catch (e) {
        console.error('[Loyalty] delete failed:', e);
        showToast('Delete failed. Try again.', 'error');
    }
}

async function lookupCustomer() {
    const raw = document.getElementById('loyalty-lookup-phone').value;
    const phone = normPhone(raw);
    const container = document.getElementById('loyalty-customer-result');
    if (!validPhone(phone)) {
        container.innerHTML = `<p class="mob-table-empty">Enter a valid 10-digit mobile number.</p>`;
        return;
    }
    container.innerHTML = `<div class="mob-table-empty" style="padding:24px;">Looking up ${phone}…</div>`;
    try {
        const [loyalSnap, rankSnap, rewardsSnap, ordersSnap, appSnap] = await Promise.all([
            get(Outlet.ref(`customers/${phone}/loyalty`)),
            get(Outlet.ref(`loyalty/rankings/${phone}`)),
            get(Outlet.ref(`customers/${phone}/rewards`)),
            get(Outlet.ref(`customers/${phone}/orders`)),
            get(Outlet.ref(`customers/${phone}/app`))
        ]);
        container.innerHTML = renderCustomerCard(phone,
            appSnap && appSnap.exists() ? appSnap.val() : null,
            loyalSnap && loyalSnap.exists() ? loyalSnap.val() : null,
            rankSnap && rankSnap.exists() ? rankSnap.val() : null,
            rewardsSnap && rewardsSnap.exists() ? rewardsSnap.val() : null,
            ordersSnap);
    } catch (e) {
        console.error('[Loyalty] lookup failed:', e);
        container.innerHTML = `<p class="mob-table-empty">Lookup failed. Try again.</p>`;
    }
}

function renderAll() {
    const container = document.getElementById('loyaltyApp');
    if (!container) return;
    const rateRs = (_config && _config.earnRatePaisePerPoint) ? _config.earnRatePaisePerPoint / 100 : 20;
    const configured = _server != null;
    container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="mob-section-head-row" style="align-items:flex-start;">
            <div>
                <h2 class="mob-card-title" style="font-size:22px;">Loyalty</h2>
                <p class="mob-td-sub">Points, tiers and rewards customers earn at this kitchen.</p>
            </div>
        </div>
        <div class="mob-card" style="padding:14px 16px;margin:0;">
            <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <span class="mob-td-sub">Program</span>
                    <span class="mob-td-strong">${configured ? 'Configured' : 'Using defaults'}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <span class="mob-td-sub">Earn rate</span>
                    <span class="mob-td-strong">${ptsPer100(_config)} points per ?100</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <span class="mob-td-sub">Rewards in catalog</span>
                    <span class="mob-td-strong">${((_config && _config.rewards) || DEFAULTS.rewards).length}</span>
                </div>
                <div style="margin-left:auto;display:flex;flex-direction:column;gap:2px;text-align:right;">
                    <span class="mob-td-sub">Outlet</span>
                    <span class="mob-td-sub" style="font-size:11px;text-transform:uppercase;">${escapeHtml(Outlet.current)}</span>
                </div>
            </div>
            ${!configured ? `<p class="mob-table-empty" style="margin:8px 0 0 0;">Not yet configured by an admin — customers earn at the default rates shown below. Open any panel to save your own settings.</p>` : ''}
        </div>
        ${renderConfigForm()}
        ${renderRewardsCatalog()}
        <div class="mob-card mob-table-card" style="margin:0;">
            <div class="mob-section-head-row">
                <h3 class="mob-card-title">Look up a customer</h3>
                <p class="mob-td-sub" style="margin-left:auto;">Search by phone to see their tier, points, rank and redemptions.</p>
            </div>
            <div style="padding:16px;">
                <div style="display:flex;gap:8px;align-items:flex-end;">
                    <input type="text" id="loyalty-lookup-phone" maxlength="15" placeholder="98765 43210" class="mob-input-reward" style="max-width:220px;">
                    <button type="button" data-action="loyalty-search-customer" class="btn-primary">Look up</button>
                </div>
                <div class="mob-td-sub" style="margin-top:4px;">Enter the customer's registered mobile number.</div>
                <div id="loyalty-customer-result"></div>
            </div>
        </div>
    </div>`;
    document.getElementById('loyalty-search-customer')?.addEventListener('click', () => lookupCustomer());
    document.getElementById('loyalty-lookup-phone')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupCustomer(); });
    window.__adminLogger?.info('LOYALTY', 'Tab mounted', { outlet: Outlet.current });
}

// Deferred form listeners (attached after render so inputs exist)
function attachFormListeners() {
    if (_formListenersAttached) return;
    _formListenersAttached = true;
    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const rewardId = btn.getAttribute('data-reward-id');
        if (action === 'loyalty-save-config') { await saveConfig(); return; }
        if (action === 'loyalty-edit-reward') { _editingReward = rewardId; renderAll(); return; }
        if (action === 'loyalty-cancel-edit') { _editingReward = null; renderAll(); return; }
        if (action === 'loyalty-save-reward') {
            const row = document.querySelector(`tr[data-reward="${escapeHtml(rewardId)}"]`);
            if (!row) return;
            const label = row.querySelector('[data-field="label"]').value.trim();
            const cost = parseFloat(row.querySelector('[data-field="cost"]').value);
            const type = row.querySelector('[data-field="type"]').value;
            if (!label || !Number.isFinite(cost) || cost < 0) { showToast('Enter a valid name and cost', 'error'); return; }
            const rewards = (_config && _config.rewards) || DEFAULTS.rewards.slice();
            const idx = rewards.findIndex(r => r.id === rewardId);
            if (idx >= 0) rewards[idx] = { id: rewardId, label, cost, type };
            _config.rewards = rewards;
            _editingReward = null;
            await saveRewards();
            return;
        }
        if (action === 'loyalty-add-reward') {
            const label = document.getElementById('loyalty-new-label').value.trim();
            const cost = parseFloat(document.getElementById('loyalty-new-cost').value);
            const type = document.getElementById('loyalty-new-type').value;
            if (!label || !Number.isFinite(cost) || cost < 0) { showToast('Enter a valid name and cost', 'error'); return; }
            const rewards = (_config && _config.rewards) || DEFAULTS.rewards.slice();
            const id = rewardSlug(label);
            if (rewards.some(r => r.id === id)) { showToast('A reward with this name already exists', 'error'); return; }
            rewards.push({ id, label, cost, type });
            _config.rewards = rewards;
            document.getElementById('loyalty-new-label').value = '';
            document.getElementById('loyalty-new-cost').value = '';
            await saveRewards();
            return;
        }
        if (action === 'loyalty-delete-reward') {
            await deleteReward(rewardId);
            return;
        }
    });
    container.addEventListener('input', (e) => {
        const field = e.target.closest('[data-field]');
        if (!field) return;
        const tk = field.getAttribute('data-tier');
        if (tk) {
            const tiers = (_config && _config.tiers) || {};
            tiers[tk] = tiers[tk] || {};
            const v = field.value === '' ? 0 : parseFloat(field.value);
            if (field.getAttribute('data-field') === 'label') tiers[tk].label = field.value;
            else tiers[tk][field.getAttribute('data-field')] = Number.isFinite(v) ? v : tiers[tk][field.getAttribute('data-field')];
            _config.tiers = tiers;
        }
    });
}

export async function loadLoyalty() {
    const container = document.getElementById('loyaltyApp');
    if (!container) {
        logger.warn('LOYALTY', 'tab-loyalty not found in DOM');
        return;
    }
    container.innerHTML = `<div class="mob-table-empty" style="padding:30px;">Loading loyalty program…</div>`;
    try {
        const server = await readServerConfig();
        _config = cloneConfig(server);
        _server = server ? JSON.parse(JSON.stringify(server)) : null;
        logger.info('LOYALTY', 'Config loaded', { outlet: Outlet.current, configured: !!server });
    } catch (e) {
        console.warn('[Loyalty] initial read failed:', e);
        _config = cloneConfig(null);
        _server = null;
    }
    renderAll();
    attachFormListeners();
}
