/**
 * FoodHubbie Demo — presentation helpers.
 *
 * Thin builders over the existing Admin design-system classes (panel,
 * premium-table-v4, kpi-stat, btn-primary, form-input, status badges) so every
 * demo screen keeps the live product's look, spacing and hierarchy.
 */

import { escapeHtml } from '../../shared/dom/escape.js';

export const esc = escapeHtml;

export function money(n) {
    const v = Number(n) || 0;
    const decimals = Math.abs(v % 1) > 0.0001 ? 2 : 0;
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: 2 });
}

export function num(n) { return (Number(n) || 0).toLocaleString('en-IN'); }

export function timeOf(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function dateOf(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function dateTimeOf(iso) { return `${dateOf(iso)}, ${timeOf(iso)}`; }

export function minutesAgo(iso, now = Date.now()) {
    const m = Math.round((now - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m ago`;
    return `${Math.floor(h / 24)}d ago`;
}

const STATUS_TONE = {
    Pending: 'muted', Placed: 'info', Confirmed: 'info', Preparing: 'warn', Cooked: 'warn',
    Ready: 'ready', 'Out for Delivery': 'info', 'Reached Drop Location': 'info',
    Delivered: 'ok', Served: 'ok', Cancelled: 'bad',
    Paid: 'ok', Failed: 'bad', Refunded: 'warn',
    Active: 'ok', Online: 'ok', 'On delivery': 'info', Offline: 'muted',
    Approved: 'ok', Rejected: 'bad', Sent: 'ok', Scheduled: 'info', Draft: 'muted',
    Received: 'ok', 'Pending delivery': 'warn', Invited: 'info',
};

export function badge(text, tone) {
    const t = tone || STATUS_TONE[text] || 'muted';
    return `<span class="demo-badge" data-tone="${esc(t)}">${esc(text)}</span>`;
}

export const statusBadge = (s) => badge(s);

const TYPE_TONE = { 'dine-in': 'info', delivery: 'ok', takeaway: 'warn', pos: 'muted', QR: 'info', WA: 'ok', POS: 'muted', webview_delivery: 'ok' };
const TYPE_LABEL = { 'dine-in': 'Dine-in', delivery: 'Delivery', takeaway: 'Takeaway', pos: 'POS', QR: 'QR', WA: 'WhatsApp', POS: 'POS', webview_delivery: 'Web menu' };

export function typeBadge(t) {
    return `<span class="demo-badge" data-tone="${TYPE_TONE[t] || 'muted'}">${esc(TYPE_LABEL[t] || t || '—')}</span>`;
}

export function kpi(value, label, delta, primary) {
    return `<div class="kpi-stat${primary ? ' kpi-stat--primary' : ''}">
        <span class="kpi-stat__value">${value}</span>
        <span class="kpi-stat__label">${esc(label)}</span>
        <span class="kpi-stat__delta">${esc(delta || '')}</span>
    </div>`;
}

export function kpiStrip(items) {
    return `<div class="kpi-strip mb-24">${items.map(i => kpi(i.value, i.label, i.delta, i.primary)).join('')}</div>`;
}

/** Panel with optional header actions (HTML string). */
export function panel(title, body, actions = '', opts = {}) {
    return `<section class="panel demo-panel ${opts.className || ''}">
        ${title ? `<div class="panel-header">
            <h3 class="panel-title">${opts.icon ? `<i data-lucide="${esc(opts.icon)}" class="icon-16"></i> ` : ''}${esc(title)}</h3>
            ${actions ? `<div class="demo-panel__actions">${actions}</div>` : ''}
        </div>` : ''}
        <div class="demo-panel__body">${body}</div>
    </section>`;
}

export function sectionTitle(text, icon) {
    return `<h3 class="section-title">${icon ? `<i data-lucide="${esc(icon)}" class="icon-fixed-sm"></i> ` : ''}${esc(text)}</h3>`;
}

export function table({ columns, rows, empty = 'Nothing here yet.', rowClass }) {
    if (!rows || !rows.length) return emptyState('inbox', 'No records', empty);
    return `<div class="table-responsive demo-table-wrap">
        <table class="premium-table-v4 demo-table">
            <thead><tr>${columns.map(c => `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${esc(c.label || c)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((r, i) => `<tr${rowClass ? ` class="${rowClass(r, i)}"` : ''}>${r.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
    </div>`;
}

export function emptyState(icon, title, text) {
    return `<div class="demo-empty">
        <i data-lucide="${esc(icon || 'inbox')}" class="demo-empty__icon"></i>
        <p class="demo-empty__title">${esc(title)}</p>
        <span class="demo-empty__text">${esc(text)}</span>
    </div>`;
}

export function searchBar(id, placeholder, value = '') {
    return `<div class="demo-toolbar__search">
        <i data-lucide="search" class="icon-16"></i>
        <input id="${esc(id)}" class="form-input demo-search" type="search" placeholder="${esc(placeholder)}" value="${esc(value)}" aria-label="${esc(placeholder)}">
    </div>`;
}

export function select(id, options, value, label) {
    const opts = options.map(o => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`;
    }).join('');
    return `<select id="${esc(id)}" class="form-input demo-select" aria-label="${esc(label || id)}">${opts}</select>`;
}

export function tabs(items, activeId, kind = 'demo-chip') {
    return `<div class="demo-chips" role="tablist">${items.map(it => `
        <button type="button" role="tab" aria-selected="${it.id === activeId}" class="${kind}${it.id === activeId ? ' is-active' : ''}" data-chip="${esc(it.id)}">${esc(it.label)}${it.count != null ? ` <span class="demo-chip__count">${it.count}</span>` : ''}</button>`).join('')}
    </div>`;
}

/**
 * Vertical bar chart (inline SVG — no chart library, no network).
 * @param {{label:string,value:number}[]} series
 */
export function barChart(series, { height = 150, money: isMoney = true, ariaLabel = 'Chart' } = {}) {
    const max = Math.max(1, ...series.map(s => s.value));
    // ponytail: CSS flex bars, not SVG — an SVG with preserveAspectRatio="none"
    // stretches the text glyphs as badly as it stretches the rectangles.
    const cols = series.map(s => {
        const pct = Math.max(2, Math.round((s.value / max) * 100));
        const text = isMoney ? money(s.value) : num(s.value);
        return `<div class="demo-bars__col" title="${esc(s.label)}: ${text}">
            <span class="demo-bars__value">${text}</span>
            <span class="demo-bars__track"><span class="demo-bars__fill" style="height:${pct}%"></span></span>
            <span class="demo-bars__label">${esc(s.label)}</span>
        </div>`;
    }).join('');
    return `<div class="demo-bars" style="--demo-bars-h:${Number(height) || 150}px" role="img" aria-label="${esc(ariaLabel)}">${cols}</div>`;
}

/** Horizontal ranked bars (top items, payment split). */
export function rankBars(rows, { valueFmt = money, ariaLabel = 'Breakdown' } = {}) {
    const max = Math.max(1, ...rows.map(r => r.value));
    return `<div class="demo-rank" role="img" aria-label="${esc(ariaLabel)}">${rows.map(r => `
        <div class="demo-rank__row">
            <span class="demo-rank__name">${esc(r.label)}</span>
            <span class="demo-rank__track"><span class="demo-rank__fill" style="width:${Math.round((r.value / max) * 100)}%"></span></span>
            <span class="demo-rank__value">${valueFmt(r.value)}</span>
        </div>`).join('')}</div>`;
}

export function progress(value, max, tone = 'ok') {
    const pct = Math.max(0, Math.min(100, Math.round((Number(value) / Math.max(1, Number(max))) * 100)));
    return `<span class="demo-progress" data-tone="${tone}"><span class="demo-progress__fill" style="width:${pct}%"></span></span>`;
}

export function drawerShell(id, title, body, actions = '') {
    return `<div class="demo-drawer" id="${esc(id)}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="demo-drawer__backdrop" data-drawer-close="1"></div>
        <aside class="demo-drawer__panel">
            <header class="demo-drawer__head">
                <h3 class="demo-drawer__title">${esc(title)}</h3>
                <button type="button" class="demo-icon-btn" data-drawer-close="1" aria-label="Close"><i data-lucide="x"></i></button>
            </header>
            <div class="demo-drawer__body">${body}</div>
            ${actions ? `<footer class="demo-drawer__foot">${actions}</footer>` : ''}
        </aside>
    </div>`;
}

export function field(label, inputHtml, hint) {
    return `<label class="demo-field">
        <span class="form-label-small">${esc(label)}</span>
        ${inputHtml}
        ${hint ? `<span class="demo-field__hint">${esc(hint)}</span>` : ''}
    </label>`;
}

export function input(id, value, { type = 'text', placeholder = '', attrs = '' } = {}) {
    return `<input id="${esc(id)}" class="form-input" type="${esc(type)}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" ${attrs}>`;
}

export function textarea(id, value, { rows = 3, placeholder = '' } = {}) {
    return `<textarea id="${esc(id)}" class="form-input" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value ?? '')}</textarea>`;
}

export function toggle(id, checked, label) {
    return `<label class="demo-switch">
        <input type="checkbox" id="${esc(id)}"${checked ? ' checked' : ''} aria-label="${esc(label)}">
        <span class="demo-switch__track"><span class="demo-switch__thumb"></span></span>
        <span class="demo-switch__label">${esc(label)}</span>
    </label>`;
}

export function restrictedBtn(label, feature, { cls = 'btn-secondary', icon = 'lock', small = true } = {}) {
    return `<button type="button" class="${cls}${small ? ' btn-small' : ''}" data-demo-restricted="${esc(feature)}">
        <i data-lucide="${esc(icon)}" class="icon-14"></i> ${esc(label)}</button>`;
}

export function noteBar(text, tone = 'info', icon = 'info') {
    return `<div class="demo-note" data-tone="${esc(tone)}"><i data-lucide="${esc(icon)}" class="icon-16"></i><div>${text}</div></div>`;
}

/** Marks a screen/region as simulated so the visitor never mistakes it for real activity. */
export function simulatedTag(text = 'Simulated in demo') {
    return `<span class="demo-sim-tag"><i data-lucide="flask-conical" class="icon-14"></i> ${esc(text)}</span>`;
}

export function refreshedIcons() {
    if (window.lucide) window.lucide.createIcons();
}

/** Demo-only toast (the live app's showToast pulls in the Firebase SDK, which the demo never loads). */
export function toast(message, tone = 'success') {
    let host = document.getElementById('demoToasts');
    if (!host) {
        host = document.createElement('div');
        host.id = 'demoToasts';
        host.className = 'demo-toasts';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'demo-toast';
    el.dataset.tone = tone;
    el.innerHTML = `<i data-lucide="${tone === 'error' ? 'alert-circle' : tone === 'info' ? 'info' : 'check-circle'}" class="icon-16"></i><span>${esc(message)}</span>`;
    host.appendChild(el);
    refreshedIcons();
    setTimeout(() => { el.classList.add('is-out'); }, 2600);
    setTimeout(() => { el.remove(); }, 3100);
}
