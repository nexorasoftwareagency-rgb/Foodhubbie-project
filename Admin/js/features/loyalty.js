// ============================================================================
// LOYALTY ADMIN — controller for the Loyalty tab (fetch, save, wire events).
// All markup and display maths live in ./loyalty-view.js (pure, unit-tested).
//
// Everything here runs on existing RTDB rules — nothing new to deploy:
//   loyalty/config               admin write (outlet-scoped)
//   loyalty/rankings             admin read (whole list) — Overview numbers
//   loyalty/adjustments          admin read/write — manual point changes
//   customers/{phone}/loyalty    public read by phone
//   loyalty/rankings/{phone}     public read by phone (single entry only)
//   customers/{phone}/rewards    public read by phone
//   customers/{phone}/orders     public read by phone
//   customers/{phone}/app        public read by phone
// ============================================================================

import { showToast, showConfirm } from '../utils.js';
import { get, set, runTransaction, query, orderByChild, limitToLast, auth, Outlet, BUSINESS_ID } from '../firebase.js';
import { logger } from '../utils/logger.js';
import { computeEarnPoints, computeTenderPaise } from '../../shared/loyalty-math.js';
import {
    LOYALTY_CSS, backPct, earnForBackPct, cloneConfig, buildPayload, formFromConfig, validateForm, sameForm,
    buildExample, summarize, pickName, tallyOutstanding, renderShell, renderOverview, renderMembers, renderMemberSheet,
    renderNoRecord, renderRewards, renderRules, renderBill, esc, fmtPhone
} from './loyalty-view.js';

const CALC = { computeEarnPoints, computeTenderPaise };
const VIEW_ORDER = ['overview', 'members', 'rewards', 'rules'];
const STATS_TTL_MS = 60 * 1000;
const COUNT_CONCURRENCY = 8;   // member balances read at a time while counting outstanding points

let _config = null;          // working copy of the saved program settings
let _server = null;          // what loyalty/config held when last read (null = never saved)
let _view = 'overview';
let _stats = null;           // summarize() of loyalty/rankings
let _adjs = null;            // last few manual adjustments
let _names = {};             // phone -> display name for the people shown on Overview
let _phones = [];            // every phone in loyalty/rankings (what "Update" counts)
let _outstanding = null;     // last tally of spendable points (kept until the next Update)
let _outState = 'idle';      // idle | counting
let _progress = { done: 0, total: 0 };
let _runToken = 0;           // lets a reload cancel an in-flight count
let _statsState = 'idle';    // idle | loading | ok | failed
let _statsAt = 0;
let _draft = null;           // unsaved Rules form values (survives switching tabs)
let _billRs = '500';
let _prefill = '';
let _editingReward = null;
let _boundEl = null;
let _busy = false;

function normPhone(raw) {
    return String(raw || '').replace(/\D/g, '').slice(-10);
}
function validPhone(p) {
    return /^[6-9][0-9]{9}$/.test(p);
}
function rewardSlug(label) {
    return String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'reward';
}
function cfgPath() {
    return Outlet.ref('loyalty/config');
}
function ensureStyles() {
    if (document.getElementById('lyd-css')) return;
    const st = document.createElement('style');
    st.id = 'lyd-css';
    st.textContent = LOYALTY_CSS;
    document.head.appendChild(st);
}
function announce(msg) {
    const el = document.getElementById('lyd-live');
    if (el) el.textContent = msg;
}

// ---------------------------------------------------------------- rules form

const FORM_IDS = {
    earnRs: 'loyalty-earn-rate', redeemRs: 'loyalty-redeem-value', minSpend: 'loyalty-min-spend',
    maxPct: 'loyalty-max-redeem-pct', expiry: 'loyalty-expiry-days',
    silverMin: 'loyalty-tier-silver-min', goldMin: 'loyalty-tier-gold-min',
    bronzeMult: 'loyalty-tier-bronze-mult', silverMult: 'loyalty-tier-silver-mult', goldMult: 'loyalty-tier-gold-mult'
};
const CHECK_IDS = { earnOn: 'loyalty-earn-enabled', dineOn: 'loyalty-dinein-earn-enabled', clawOn: 'loyalty-clawback-enabled' };

function savedForm() {
    return formFromConfig(_config);
}
function currentForm() {
    return _draft || savedForm();
}
function isDirty() {
    return !!_draft && !sameForm(_draft, savedForm());
}
function readFormFromDom() {
    const out = {};
    for (const [k, id] of Object.entries(FORM_IDS)) {
        const el = document.getElementById(id);
        out[k] = el ? el.value.trim() : '';
    }
    for (const [k, id] of Object.entries(CHECK_IDS)) {
        const el = document.getElementById(id);
        out[k] = !!(el && el.checked);
    }
    return out;
}

function syncRulesUi() {
    const dirty = isDirty();
    const bar = document.getElementById('lyd-savebar');
    if (bar) bar.classList.toggle('is-dirty', dirty);
    const msg = document.getElementById('lyd-savebar-msg');
    if (msg) msg.textContent = dirty ? 'You have unsaved changes.' : 'All changes saved.';
    const discard = document.getElementById('lyd-discard');
    if (discard) discard.disabled = !dirty;
    const tab = document.getElementById('lyd-tab-rules');
    if (tab) {
        const dot = tab.querySelector('.lyd-unsaved-dot');
        if (dirty && !dot) tab.insertAdjacentHTML('beforeend', '<span class="lyd-unsaved-dot" title="Unsaved changes"><span class="lyd-sr">Unsaved changes</span></span>');
        if (!dirty && dot) dot.remove();
    }
    const f = currentForm();
    const cur = backPct(f);
    document.querySelectorAll('.lyd-chip[data-pct]').forEach(ch => {
        const pct = Number(ch.getAttribute('data-pct'));
        ch.setAttribute('aria-pressed', cur !== null && Math.abs(cur - pct) < 0.01 ? 'true' : 'false');
        ch.disabled = earnForBackPct(pct, Number(f.redeemRs)) === null;
    });
    const note = document.getElementById('lyd-back-note');
    if (note) note.textContent = cur === null ? '' : `A normal-rate member gets about ${+(Math.round(cur * 100) / 100).toFixed(2)}% back on every bill.`;
    const bill = document.getElementById('lyd-bill');
    if (bill) bill.innerHTML = renderBill(buildExample(currentForm(), Number(_billRs), CALC), _billRs);
}

// ------------------------------------------------------------------- render

function renderBody() {
    const c = _config;
    if (_view === 'members') return renderMembers({ prefill: _prefill });
    if (_view === 'rewards') return renderRewards({ config: c, editingId: _editingReward });
    if (_view === 'rules') {
        const f = currentForm();
        return renderRules({ form: f, dirty: isDirty(), billRs: _billRs, example: buildExample(f, Number(_billRs), CALC) });
    }
    return renderOverview({
        config: c, stats: _stats, adjustments: _adjs, configured: _server != null,
        names: _names, outstandingState: _outState, progress: _progress,
        outstanding: _outstanding ? { ..._outstanding, valueRs: Math.round((_outstanding.points * c.redeemValuePaisePerPoint) / 100) } : null,
        loading: _statsState === 'loading' || _statsState === 'idle',
        failed: _statsState === 'failed'
    });
}

function renderAll(focusSel) {
    const container = document.getElementById('loyaltyApp');
    if (!container || !_config) return;
    ensureStyles();
    container.innerHTML = renderShell({
        view: _view,
        earnOn: _config.earnEnabled !== false,
        dirty: isDirty(),
        outlet: Outlet.current,
        body: renderBody()
    });
    if (focusSel) container.querySelector(focusSel)?.focus();
}

function renderPanelOnly() {
    const panel = document.getElementById('lyd-panel');
    if (!panel) return renderAll();
    panel.innerHTML = renderBody();
}

function setView(v, { focusTab = false } = {}) {
    if (!VIEW_ORDER.includes(v)) return;
    _view = v;
    renderAll(focusTab ? `#lyd-tab-${v}` : null);
    const panel = document.getElementById('lyd-panel');
    if (panel) {
        panel.classList.add('is-entering');
        panel.addEventListener('animationend', () => panel.classList.remove('is-entering'), { once: true });
    }
    if (v === 'overview' && (_statsState !== 'ok' || Date.now() - _statsAt > STATS_TTL_MS)) refreshStats();
}

// ------------------------------------------------------------------- data

async function readServerConfig() {
    try {
        const snap = await get(cfgPath());
        return snap && snap.exists() ? snap.val() : null;
    } catch (e) {
        console.warn('[Loyalty] config read failed:', e);
        return null;
    }
}

// Overview numbers: the owner-scoped rankings list (one row per member) and
// the last few manual adjustments. Customers still cannot bulk-read either.
async function refreshStats() {
    _statsState = 'loading';
    if (_view === 'overview') renderPanelOnly();
    try {
        const snap = await get(Outlet.ref('loyalty/rankings'));
        const rows = snap && snap.exists() ? Object.values(snap.val() || {}) : [];
        _stats = summarize(rows, _config);
        _phones = rows.map(r => r && r.phone).filter(p => validPhone(String(p)));
        _statsState = 'ok';
        _statsAt = Date.now();
    } catch (e) {
        console.warn('[Loyalty] rankings read failed:', e);
        _stats = null;
        _statsState = 'failed';
    }
    try {
        const aSnap = await get(query(Outlet.ref('loyalty/adjustments'), orderByChild('createdAt'), limitToLast(6)));
        const rows = aSnap && aSnap.exists() ? Object.values(aSnap.val() || {}) : [];
        _adjs = rows.filter(Boolean).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    } catch (e) {
        console.warn('[Loyalty] adjustments read failed:', e);
        _adjs = null;
    }
    if (_view === 'overview') renderPanelOnly();
    // Names are a nicety: show the numbers first, then fill names in.
    loadNames([...(_stats ? _stats.top.map(r => r.phone) : []), ...((_adjs || []).map(a => a.phone))]);
}

// Reads customers/{phone}/app/name (customer app) then customers/{phone}/name
// (WhatsApp / POS) for the few people Overview lists. A failed read just means
// that person is shown by phone number.
async function loadNames(phones) {
    const todo = [...new Set(phones.filter(p => validPhone(String(p)) && !_names[p]))];
    if (!todo.length) return;
    await Promise.all(todo.map(async (ph) => {
        const [a, b] = await Promise.allSettled([
            get(Outlet.ref(`customers/${ph}/app/name`)),
            get(Outlet.ref(`customers/${ph}/name`))
        ]);
        const val = (r) => (r.status === 'fulfilled' && r.value && r.value.exists()) ? r.value.val() : '';
        const n = pickName(val(a), val(b));
        if (n) _names[ph] = n;
    }));
    if (_view === 'overview' && _outState !== 'counting') renderPanelOnly();
}

// "Points outstanding": add up each member's spendable balance, in this
// browser, from their own customers/{phone}/loyalty record. No server job.
// One small read per member, a few at a time, with live progress.
async function updateOutstanding() {
    if (_outState === 'counting' || !_phones.length) return;
    const token = ++_runToken;
    const phones = _phones.slice();
    _outState = 'counting';
    _progress = { done: 0, total: phones.length };
    if (_view === 'overview') renderPanelOnly();
    const rows = [];
    let failed = 0, next = 0;
    const paint = () => {
        const cap = document.getElementById('lyd-outstanding-cap');
        if (cap) cap.textContent = `Counting ${_progress.done.toLocaleString('en-IN')} of ${_progress.total.toLocaleString('en-IN')} members\u2026`;
    };
    async function worker() {
        while (next < phones.length) {
            if (token !== _runToken) return;
            const ph = phones[next++];
            try {
                const snap = await get(Outlet.ref(`customers/${ph}/loyalty`));
                rows.push(snap && snap.exists() ? snap.val() : {});
            } catch (e) {
                failed++;
            }
            _progress.done++;
            if (_progress.done % 5 === 0 || _progress.done === _progress.total) paint();
        }
    }
    await Promise.all(Array.from({ length: Math.min(COUNT_CONCURRENCY, phones.length) }, worker));
    if (token !== _runToken) return; // reloaded while counting
    _outstanding = tallyOutstanding(rows, _config, { failed, total: phones.length, at: Date.now() });
    _outState = 'idle';
    logger.info('LOYALTY', 'Outstanding counted', { outlet: Outlet.current, members: phones.length, failed });
    if (failed === phones.length) showToast('Could not read any member balances. Check your connection and try again.', 'error');
    else if (failed) showToast(`Counted ${phones.length - failed} of ${phones.length} members. ${failed} could not be read.`, 'error');
    else showToast('Points outstanding updated', 'success');
    announce(`Points outstanding: ${_outstanding.points}`);
    if (_view === 'overview') renderPanelOnly();
}

async function writeConfig(payload) {
    await set(cfgPath(), payload);
    _server = JSON.parse(JSON.stringify(payload));
    _config = cloneConfig(payload);
}

function markInvalid(ids) {
    document.querySelectorAll('.lyd-input[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    ids.forEach(id => document.getElementById(id)?.setAttribute('aria-invalid', 'true'));
}

async function saveRules() {
    if (_busy) return;
    const values = readFormFromDom();
    const res = validateForm(values, _config);
    if (!res.ok) {
        markInvalid(res.errors.map(e => e.id));
        showToast(res.errors[0].msg, 'error');
        announce(res.errors[0].msg);
        document.getElementById(res.errors[0].id)?.focus();
        return;
    }
    markInvalid([]);
    const btn = document.getElementById('lyd-save');
    _busy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        const payload = buildPayload(_config, res.fields);
        await writeConfig(payload);
        _draft = null;
        showToast('Rules saved', 'success');
        announce('Rules saved');
        logger.info('LOYALTY', 'Config saved', { outlet: Outlet.current, earnRate: payload.earnRatePaisePerPoint, redeemValue: payload.redeemValuePaisePerPoint });
        _statsAt = 0;
        renderAll();
    } catch (e) {
        console.error('[Loyalty] save failed:', e);
        showToast('Could not save the rules. Check your connection and try again.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Save rules'; }
    } finally {
        _busy = false;
    }
}

async function toggleEarning() {
    if (_busy) return;
    const next = !(_config.earnEnabled !== false);
    if (!next) {
        const sure = await showConfirm('Customers will not earn points on new orders until you turn earning back on. Points they already have stay.', 'Pause earning');
        if (!sure) return;
    }
    const sw = document.getElementById('lyd-earn-switch');
    _busy = true;
    if (sw) sw.disabled = true;
    try {
        await writeConfig(buildPayload(_config, { earnEnabled: next }));
        if (_draft) _draft = { ..._draft, earnOn: next };
        showToast(next ? 'Earning is on' : 'Earning is paused', 'success');
        logger.info('LOYALTY', 'Earning toggled', { outlet: Outlet.current, earnEnabled: next });
        renderAll('#lyd-earn-switch');
        announce(next ? 'Earning is on' : 'Earning is paused');
    } catch (e) {
        console.error('[Loyalty] toggle failed:', e);
        showToast('Could not change earning. Try again.', 'error');
        if (sw) sw.disabled = false;
    } finally {
        _busy = false;
    }
}

// ------------------------------------------------------------------ rewards

function findRewardRow(id) {
    return Array.from(document.querySelectorAll('[data-reward]')).find(el => el.getAttribute('data-reward') === id) || null;
}

async function persistRewards(nextRewards, okMsg) {
    try {
        await writeConfig(buildPayload(_config, { rewards: nextRewards }));
        showToast(okMsg, 'success');
        logger.info('LOYALTY', 'Rewards saved', { outlet: Outlet.current, count: nextRewards.length });
        return true;
    } catch (e) {
        console.error('[Loyalty] reward save failed:', e);
        showToast('Could not save. Check your connection and try again.', 'error');
        return false;
    }
}

async function saveRewardEdit(id) {
    const row = findRewardRow(id);
    if (!row) return;
    const label = row.querySelector('[data-field="label"]').value.trim();
    const cost = Math.round(parseFloat(row.querySelector('[data-field="cost"]').value));
    const type = row.querySelector('[data-field="type"]').value === 'discount' ? 'discount' : 'item';
    if (!label || !Number.isFinite(cost) || cost < 0) { showToast('Enter a reward name and a cost in points.', 'error'); return; }
    const next = (_config.rewards || []).map(r => r.id === id ? { id, label, cost, type } : r);
    if (await persistRewards(next, 'Reward saved')) { _editingReward = null; renderPanelOnly(); }
}

async function addReward() {
    const labelEl = document.getElementById('loyalty-new-label');
    const costEl = document.getElementById('loyalty-new-cost');
    const label = labelEl.value.trim();
    const cost = Math.round(parseFloat(costEl.value));
    const type = document.getElementById('loyalty-new-type').value === 'discount' ? 'discount' : 'item';
    if (!label || !Number.isFinite(cost) || cost < 0) { showToast('Enter a reward name and a cost in points.', 'error'); return; }
    const rewards = (_config.rewards || []).slice();
    const id = rewardSlug(label);
    if (rewards.some(r => r.id === id)) { showToast('A reward with this name already exists.', 'error'); labelEl.focus(); return; }
    rewards.push({ id, label, cost, type });
    if (await persistRewards(rewards, 'Reward added')) renderPanelOnly();
}

async function deleteReward(id) {
    const sure = await showConfirm('Remove this reward from the list? Customers who already claimed it can still use it.', 'Delete reward');
    if (!sure) return;
    const next = (_config.rewards || []).filter(r => r.id !== id);
    if (await persistRewards(next, 'Reward deleted')) { _editingReward = null; renderPanelOnly(); }
}

// ------------------------------------------------------------------ members

async function lookupCustomer() {
    const input = document.getElementById('loyalty-lookup-phone');
    const container = document.getElementById('loyalty-customer-result');
    if (!input || !container) return;
    const phone = normPhone(input.value);
    _prefill = input.value;
    if (!validPhone(phone)) {
        input.setAttribute('aria-invalid', 'true');
        container.innerHTML = `<p class="lyd-quiet" role="alert">Enter a 10-digit mobile number that starts with 6, 7, 8 or 9.</p>`;
        return;
    }
    input.removeAttribute('aria-invalid');
    container.innerHTML = `<p class="lyd-quiet">Looking up ${esc(fmtPhone(phone))}…</p>`;
    try {
        const [loyalSnap, rankSnap, rewardsSnap, ordersSnap, appSnap] = await Promise.all([
            get(Outlet.ref(`customers/${phone}/loyalty`)),
            get(Outlet.ref(`loyalty/rankings/${phone}`)),
            get(Outlet.ref(`customers/${phone}/rewards`)),
            get(Outlet.ref(`customers/${phone}/orders`)),
            get(Outlet.ref(`customers/${phone}/app`))
        ]);
        if (!loyalSnap || !loyalSnap.exists()) {
            container.innerHTML = renderNoRecord(phone);
            return;
        }
        const list = (snap, sortKey, limit) => Object.entries((snap && snap.val()) || {})
            .map(([id, o]) => (o ? { id, ...o } : null)).filter(Boolean)
            .sort((a, b) => Number(b[sortKey] || 0) - Number(a[sortKey] || 0))
            .slice(0, limit);
        container.innerHTML = renderMemberSheet({
            phone,
            app: appSnap && appSnap.exists() ? appSnap.val() : null,
            loy: loyalSnap.val(),
            rank: rankSnap && rankSnap.exists() ? rankSnap.val() : null,
            rewards: list(rewardsSnap, 'redeemedAt', 50),
            orders: list(ordersSnap, 'createdAt', 5)
        }, _config);
    } catch (e) {
        console.error('[Loyalty] lookup failed:', e);
        container.innerHTML = `<p class="lyd-quiet" role="alert">Could not look this customer up. Check your connection and try again.</p>`;
    }
}

// Manual point adjustment: moves ONLY the spendable balance (tier and
// lifetime points stay as earned), guarded by a transaction, with a
// mandatory reason, an audit row under loyalty/adjustments and a
// lastAdjustment mirror on the row itself.
async function adjustPoints(phone) {
    const deltaEl = document.getElementById('loyalty-adj-delta');
    const reasonEl = document.getElementById('loyalty-adj-reason');
    if (!deltaEl || !reasonEl) return;
    const delta = Math.round(parseFloat(deltaEl.value));
    const reason = reasonEl.value.trim();
    if (!Number.isFinite(delta) || delta === 0) {
        showToast('Enter a whole number of points, like -50 or 25.', 'error');
        deltaEl.setAttribute('aria-invalid', 'true');
        deltaEl.focus();
        return;
    }
    deltaEl.removeAttribute('aria-invalid');
    if (reason.length < 3) {
        showToast('Add a short reason for this change.', 'error');
        reasonEl.setAttribute('aria-invalid', 'true');
        reasonEl.focus();
        return;
    }
    reasonEl.removeAttribute('aria-invalid');
    const sure = await showConfirm(`${delta > 0 ? 'Add' : 'Remove'} ${Math.abs(delta)} points ${delta > 0 ? 'to' : 'from'} ${fmtPhone(phone)}?`, 'Apply change');
    if (!sure) return;
    const btn = document.querySelector('[data-action="loyalty-adjust-points"]');
    if (btn) btn.disabled = true;
    const now = Date.now();
    const uid = (auth && auth.currentUser && auth.currentUser.uid) || '';
    const bid = BUSINESS_ID();
    const rowRef = Outlet.ref(`customers/${phone}/loyalty`);
    try {
        // Read once first: a transaction's update function can be called with
        // null even when the node exists, so seed it with the real record. Never
        // return null from the transition - that deletes the customer's points.
        const snap = await get(rowRef);
        const seed = snap.exists() ? snap.val() : null;
        if (!seed || typeof seed !== 'object') {
            showToast('This customer has no loyalty record yet. Points can be changed after their first paid order.', 'error');
            if (btn) btn.disabled = false;
            return;
        }
        const result = await runTransaction(rowRef, (cur) => {
            const c = cur || seed;
            const curPoints = Number.isFinite(Number(c.points)) ? Number(c.points) : 0;
            const newPoints = Math.max(0, curPoints + delta);
            return { ...c, points: newPoints, updatedAt: now, lastAdjustment: { delta, reason, by: uid, at: now } };
        });
        if (!result.committed) throw new Error('transaction aborted — row changed underneath');
        const after = Number((result.snapshot && result.snapshot.val() && result.snapshot.val().points) || 0);
        await set(Outlet.ref(`loyalty/adjustments/${now}_${phone}`), {
            phone, outlet: Outlet.current, business: bid,
            delta, pointsAfter: after, reason, createdBy: uid, createdAt: now
        });
        showToast(`${fmtPhone(phone)} now has ${after} points`, 'success');
        logger.info('LOYALTY', 'Manual adjustment', { outlet: Outlet.current, delta, pointsAfter: after });
        _statsAt = 0;
        await lookupCustomer();
    } catch (e) {
        if (e && e.message && e.message.includes('row changed underneath')) {
            showToast('Their points changed while you were editing. Look them up again and retry.', 'error');
        } else if (e && e.message && e.message.includes('aborted')) {
            showToast('This customer has no loyalty record yet. Points can be changed after their first paid order.', 'error');
        } else {
            console.error('[Loyalty] adjustment failed:', e);
            showToast('Could not change the points. Try again.', 'error');
        }
        if (btn) btn.disabled = false;
    }
}

// ------------------------------------------------------------------- events

function bindEvents(container) {
    if (_boundEl === container) return;
    _boundEl = container;

    container.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || btn.type === 'submit') return; // submit buttons go through the form's submit event
        const action = btn.getAttribute('data-action');
        const rewardId = btn.getAttribute('data-reward-id');
        switch (action) {
            case 'loyalty-view': setView(btn.getAttribute('data-view'), { focusTab: true }); break;
            case 'loyalty-toggle-earning': await toggleEarning(); break;
            case 'loyalty-refresh': await refreshStats(); break;
            case 'loyalty-update-outstanding': await updateOutstanding(); break;
            case 'loyalty-quick-rate': {
                const input = document.getElementById('loyalty-earn-rate');
                const redeem = Number((document.getElementById('loyalty-redeem-value') || {}).value);
                const target = earnForBackPct(Number(btn.getAttribute('data-pct')), redeem);
                if (input && target !== null) {
                    input.value = String(target);
                    input.dispatchEvent(new Event('input', { bubbles: true })); // updates the draft, the chips and the example bill
                }
                break;
            }
            case 'loyalty-save-config': await saveRules(); break;
            case 'loyalty-discard': _draft = null; renderPanelOnly(); syncRulesUi(); break;
            case 'loyalty-edit-reward': _editingReward = rewardId; renderPanelOnly(); document.getElementById('lyd-edit-label')?.focus(); break;
            case 'loyalty-cancel-edit': _editingReward = null; renderPanelOnly(); break;
            case 'loyalty-save-reward': await saveRewardEdit(rewardId); break;
            case 'loyalty-add-reward': await addReward(); break;
            case 'loyalty-delete-reward': await deleteReward(rewardId); break;
            case 'loyalty-adjust-points': await adjustPoints(btn.getAttribute('data-phone')); break;
            case 'loyalty-open-member':
                _view = 'members';
                _prefill = fmtPhone(btn.getAttribute('data-phone'));
                renderAll();
                await lookupCustomer();
                document.getElementById('loyalty-customer-result')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                break;
            default: break;
        }
    });

    container.addEventListener('submit', (e) => {
        if (e.target.closest('[data-lyd-find]')) { e.preventDefault(); lookupCustomer(); }
        else if (e.target.closest('#lyd-rules-form')) { e.preventDefault(); }
    });

    container.addEventListener('input', (e) => {
        const t = e.target;
        if (t.id === 'lyd-bill-amount') {
            _billRs = t.value;
            syncRulesUi();
            return;
        }
        if (t.hasAttribute && t.hasAttribute('data-rule')) {
            t.removeAttribute('aria-invalid');
            _draft = readFormFromDom();
            syncRulesUi();
            return;
        }
        if (t.id === 'loyalty-adj-delta') {
            const bal = Number((document.getElementById('lyd-balance') || {}).dataset?.balance) || 0;
            const d = Math.round(parseFloat(t.value));
            const prev = document.getElementById('lyd-adj-preview');
            if (prev) {
                prev.textContent = Number.isFinite(d) && d !== 0
                    ? `Their points to spend would go from ${bal} to ${Math.max(0, bal + d)}.`
                    : 'Only the points to spend change. Their tier and points earned over time stay as they are.';
            }
        }
    });

    container.addEventListener('change', (e) => {
        if (e.target.hasAttribute && e.target.hasAttribute('data-rule')) {
            _draft = readFormFromDom();
            syncRulesUi();
        }
    });

    container.addEventListener('keydown', (e) => {
        const tab = e.target.closest && e.target.closest('[role="tab"]');
        if (!tab) return;
        const i = VIEW_ORDER.indexOf(tab.getAttribute('data-view'));
        let n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % VIEW_ORDER.length;
        else if (e.key === 'ArrowLeft') n = (i - 1 + VIEW_ORDER.length) % VIEW_ORDER.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = VIEW_ORDER.length - 1;
        if (n === null) return;
        e.preventDefault();
        setView(VIEW_ORDER[n], { focusTab: true });
    });
}

// -------------------------------------------------------------------- entry

export async function loadLoyalty() {
    const container = document.getElementById('loyaltyApp');
    if (!container) {
        logger.warn('LOYALTY', 'tab-loyalty not found in DOM');
        return;
    }
    ensureStyles();
    container.innerHTML = `<div class="lyd"><p class="lyd-quiet" style="padding:30px 0">Loading your loyalty program…</p></div>`;
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
    _draft = null;
    _runToken++;
    _outState = 'idle';
    _outstanding = null;
    _names = {};
    _phones = [];
    _statsState = 'idle';
    bindEvents(container);
    renderAll();
    refreshStats();
    window.__adminLogger?.info('LOYALTY', 'Tab mounted', { outlet: Outlet.current, configured: _server != null });
}
