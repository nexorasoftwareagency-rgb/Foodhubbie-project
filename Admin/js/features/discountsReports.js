/**
 * ROSHANI ERP | DISCOUNTS REPORTS MODULE
 * Renders per-discount performance analytics in a modal:
 *   - KPI cards (redemptions, total saved, active count, average)
 *   - Per-discount breakdown (count, total saved, average)
 *   - Channel split (whatsapp vs pos vs manual)
 *   - Recent redemptions list (last 50)
 *   - CSV export of the per-discount summary
 */
import { db, Outlet, get } from '../firebase.js';
import { escapeHtml, logAudit, showToast } from '../utils.js';
import { ui, loadLucide } from '../ui.js';
import { loadJSPDF } from './printing.js';

const REPORT_STATE = {
    range: 7,                       // days; 0 = all time
    discounts: {},
    usage: [],
    lastSnapshot: null,
    focusedMode: false
};

const _nameCache = new Map();
async function _resolveCustomerName(phone) {
    if (!phone) return null;
    const clean = String(phone).replace(/\D/g, '').slice(-10);
    if (!clean) return null;
    if (_nameCache.has(clean)) return _nameCache.get(clean);
    try {
        const snap = await get(Outlet.ref(`customers/${clean}`));
        const name = snap.exists() ? (snap.val()?.name || null) : null;
        _nameCache.set(clean, name);
        return name;
    } catch { _nameCache.set(clean, null); return null; }
}
function _initials(nameOrPhone) {
    const s = (nameOrPhone || '').trim();
    if (!s) return '?';
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s.slice(0, 2).toUpperCase();
}

function _rangeStartMs() {
    if (!REPORT_STATE.range) return 0;
    return Date.now() - (REPORT_STATE.range * 24 * 60 * 60 * 1000);
}

function _fmtINR(n) {
    return '\u20B9' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}

function _filterUsageByRange(usage) {
    const start = _rangeStartMs();
    return usage.filter(u => {
        const t = u.appliedAt || 0;
        return start === 0 || t >= start;
    });
}

function _isActiveNow(d, now = Date.now()) {
    if (!d || d.enabled === false) return false;
    if (d.startsAt && now < d.startsAt) return false;
    if (d.endsAt && d.endsAt !== 0 && now > d.endsAt) return false;
    return true;
}

export async function openDiscountsReports() {
    const modal = document.getElementById('discountsReportsModal');
    if (!modal) return;
    REPORT_STATE.focusedMode = false;
    ['discountKpiGrid', 'discountReportBreakdownWrap', 'discountReportChannelsWrap', 'discountReportRecentWrap']
        .forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    document.querySelector('#discountsReportsModal .discount-report-range-row')?.classList.remove('hidden');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    await loadLucide();
    window.lucide.createIcons({ root: modal });
    await refreshDiscountsReport();
}

export function closeDiscountsReports() {
    const modal = document.getElementById('discountsReportsModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    REPORT_STATE.focusedMode = false;
}

export async function setDiscountReportRange(el) {
    const days = parseInt(el?.getAttribute('data-range') || '7', 10);
    REPORT_STATE.range = isNaN(days) ? 7 : days;
    document.querySelectorAll('#discountsReportsModal .btn-discount-preset').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-range') === String(REPORT_STATE.range));
    });
    await renderReport();
}

export async function refreshDiscountsReport() {
    try {
        const [discountsSnap, usageSnap] = await Promise.all([
            get(Outlet.ref('discounts')),
            get(Outlet.ref('discountsUsage'))
        ]);
        REPORT_STATE.discounts = discountsSnap.val() || {};
        const usage = usageSnap.val() || {};
        REPORT_STATE.usage = Object.entries(usage).map(([id, u]) => ({ id, ...u }));
        REPORT_STATE.lastSnapshot = {
            discounts: REPORT_STATE.discounts,
            usage: REPORT_STATE.usage
        };
        await renderReport();
    } catch (e) {
        console.error('[Discounts Reports] Refresh failed:', e);
        showToast('Failed to load discount usage data.', 'error');
    }
}

async function renderReport() {
    const filtered = _filterUsageByRange(REPORT_STATE.usage);

    // KPIs
    const totalRedemptions = filtered.length;
    const totalSavings = filtered.reduce((s, u) => s + (Number(u.amountGiven) || 0), 0);
    const now = Date.now();
    const activeCount = Object.values(REPORT_STATE.discounts).filter(d => _isActiveNow(d, now)).length;
    const average = totalRedemptions > 0 ? Math.round(totalSavings / totalRedemptions) : 0;

    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
    setText('drKpiRedemptions', totalRedemptions.toLocaleString('en-IN'));
    setText('drKpiSavings', _fmtINR(totalSavings));
    setText('drKpiActive', String(activeCount));
    setText('drKpiAverage', _fmtINR(average));

    // Per-discount breakdown
    const perDiscount = new Map();
    for (const u of filtered) {
        const k = u.discountId || 'unknown';
        if (!perDiscount.has(k)) {
            perDiscount.set(k, {
                id: k,
                name: u.discountLabel || REPORT_STATE.discounts[k]?.name || 'Unknown',
                type: REPORT_STATE.discounts[k]?.type || 'unknown',
                count: 0,
                total: 0
            });
        }
        const entry = perDiscount.get(k);
        entry.count += 1;
        entry.total += Number(u.amountGiven) || 0;
    }
    const breakdown = [...perDiscount.values()].sort((a, b) => b.total - a.total);
    const maxTotal = breakdown.length > 0 ? breakdown[0].total : 0;
    const breakdownEl = document.getElementById('discountReportBreakdown');
    if (breakdownEl) {
        if (breakdown.length === 0) {
            breakdownEl.innerHTML = '<div class="discount-report-empty">No redemptions in this range.</div>';
        } else {
            breakdownEl.innerHTML = breakdown.map(b => {
                const avg = b.count > 0 ? Math.round(b.total / b.count) : 0;
                const pct = maxTotal > 0 ? Math.round((b.total / maxTotal) * 100) : 0;
                const typeBadge = `<span class="discount-type-badge discount-type-${escapeHtml(b.type)}">${escapeHtml(b.type)}</span>`;
                return `
                    <div class="discount-report-row" style="cursor:pointer;" data-action="viewCodeUses" data-discount-id="${escapeHtml(b.id)}">
                        <div class="drr-label">
                            <div class="drr-name">${escapeHtml(b.name)} ${typeBadge}</div>
                            <div class="drr-meta">${b.count} redemption${b.count === 1 ? '' : 's'} \u00B7 avg ${_fmtINR(avg)}</div>
                        </div>
                        <div class="drr-bar-wrap">
                            <div class="drr-bar" style="width:${pct}%;"></div>
                        </div>
                        <div class="drr-value">${_fmtINR(b.total)}</div>
                    </div>
                `;
            }).join('');
        }
    }

    // Channel split
    const channelCounts = { whatsapp: 0, pos: 0, manual: 0, other: 0 };
    for (const u of filtered) {
        const ch = String(u.channel || '').toLowerCase();
        if (channelCounts[ch] !== undefined) channelCounts[ch] += 1;
        else channelCounts.other += 1;
    }
    const channelsEl = document.getElementById('discountReportChannels');
    if (channelsEl) {
        const totalCh = Object.values(channelCounts).reduce((a, b) => a + b, 0);
        if (totalCh === 0) {
            channelsEl.innerHTML = '<div class="discount-report-empty">No channel data in this range.</div>';
        } else {
            const ch = [
                { key: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
                { key: 'pos',      label: 'POS',      color: '#1d4ed8' },
                { key: 'manual',   label: 'Manual',   color: '#64748b' },
                { key: 'other',    label: 'Other',    color: '#a3a3a3' }
            ];
            channelsEl.innerHTML = ch.filter(c => channelCounts[c.key] > 0).map(c => {
                const n = channelCounts[c.key];
                const pct = Math.round((n / totalCh) * 100);
                return `
                    <div class="drc-row">
                        <div class="drc-dot" style="background:${c.color};"></div>
                        <div class="drc-label">${c.label}</div>
                        <div class="drc-bar-wrap">
                            <div class="drc-bar" style="width:${pct}%; background:${c.color};"></div>
                        </div>
                        <div class="drc-value">${n} <span class="text-muted-small">(${pct}%)</span></div>
                    </div>
                `;
            }).join('');
        }
    }

    // Recent redemptions (last 50 in range)
    const recent = [...filtered]
        .sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0))
        .slice(0, 50);
    const recentEl = document.getElementById('discountReportRecent');
    if (recentEl) {
        if (recent.length === 0) {
            recentEl.innerHTML = '<div class="discount-report-empty">No recent redemptions in this range.</div>';
        } else {
            recentEl.innerHTML = recent.map(u => {
                const d = new Date(u.appliedAt || 0);
                const dateStr = d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
                const channel = String(u.channel || 'other');
                const source = String(u.discountSource || 'auto');
                const orderLink = u.orderId ? escapeHtml(u.orderId) : '\u2014';
                return `
                    <div class="discount-recent-row">
                        <div class="drcr-time">${escapeHtml(dateStr)}</div>
                        <div class="drcr-discount">${escapeHtml(u.discountLabel || 'Discount')}</div>
                        <div class="drcr-customer">${escapeHtml(u.customerPhone || 'Walk-in')}</div>
                        <div class="drcr-order">#${orderLink}</div>
                        <div class="drcr-channel"><span class="channel-chip channel-${escapeHtml(channel)}">${escapeHtml(channel)}</span></div>
                        <div class="drcr-source text-muted-small">${escapeHtml(source)}</div>
                        <div class="drcr-amount">-${_fmtINR(u.amountGiven)}</div>
                    </div>
                `;
            }).join('');
        }
    }

    await loadLucide();
    const modal = document.getElementById('discountsReportsModal');
    if (modal) window.lucide.createIcons({ root: modal });
}

export async function exportDiscountsReport() {
    await loadJSPDF();
    const filtered = _filterUsageByRange(REPORT_STATE.usage);
    const perDiscount = new Map();
    for (const u of filtered) {
        const k = u.discountId || 'unknown';
        if (!perDiscount.has(k)) {
            perDiscount.set(k, {
                id: k,
                name: u.discountLabel || REPORT_STATE.discounts[k]?.name || 'Unknown',
                type: REPORT_STATE.discounts[k]?.type || 'unknown',
                enabled: REPORT_STATE.discounts[k]?.enabled !== false,
                count: 0,
                total: 0
            });
        }
        const entry = perDiscount.get(k);
        entry.count += 1;
        entry.total += Number(u.amountGiven) || 0;
    }
    const rows = [...perDiscount.values()].sort((a, b) => b.total - a.total);

    const rangeLabel = REPORT_STATE.range === 0
        ? 'all_time'
        : `last_${REPORT_STATE.range}_days`;
    const today = new Date().toISOString().slice(0, 10);
    const header = ['Discount ID', 'Name', 'Type', 'Enabled', 'Redemptions', 'Total Saved (INR)', 'Avg per Redemption (INR)'];
    const csv = [header.join(',')];
    for (const r of rows) {
        const avg = r.count > 0 ? Math.round(r.total / r.count) : 0;
        csv.push([
            r.id,
            `"${(r.name || '').replace(/"/g, '""')}"`,
            r.type,
            r.enabled ? 'yes' : 'no',
            r.count,
            Math.round(r.total),
            avg
        ].join(','));
    }
    const totalSavings = rows.reduce((s, r) => s + r.total, 0);
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    csv.push(['', '', '', 'TOTAL', totalCount, Math.round(totalSavings), totalCount > 0 ? Math.round(totalSavings / totalCount) : 0].join(','));

    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `discounts_report_${rangeLabel}_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
    logAudit('Discounts', 'Exported discounts report', `Range: ${rangeLabel}, rows: ${rows.length}`);
    showToast(`Exported ${rows.length} discount row(s) to CSV.`, 'success');
}

const _COUPON_WORDS = ['PIZZA', 'DEAL', 'FEAST', 'SAVE', 'YUMMY', 'TREAT', 'SALE', 'FRESH', 'HOT', 'MEGA', 'SUPER', 'LUCKY', 'BOGO', 'FREE', 'WOW', 'YAY'];

export function generateCouponCode(prefix = '') {
    const word = prefix || _COUPON_WORDS[Math.floor(Math.random() * _COUPON_WORDS.length)];
    const num = Math.floor(Math.random() * 90 + 10);
    return `${word}${num}`;
}

export async function openCodeUses(discountId) {
    const all = REPORT_STATE.usage || [];
    const filtered = all.filter(u => u.discountId === discountId);
    const sorted = filtered.sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));
    const disc = REPORT_STATE.discounts[discountId];
    const title = document.getElementById('discountCodeUsesTitle');
    const list = document.getElementById('discountCodeUsesList');
    const panel = document.getElementById('discountCodeUsesPanel');
    const backBtn = document.getElementById('discountCodeUsesBackBtn');

    if (title) title.textContent = disc?.name || discountId;
    if (panel) panel.classList.remove('hidden');
    if (backBtn) backBtn.innerHTML = REPORT_STATE.focusedMode
        ? '<i data-lucide="x"></i> Close'
        : '<i data-lucide="arrow-left"></i> Back to reports';

    if (!list) return;

    const totalSaved = sorted.reduce((s, u) => s + (Number(u.amountGiven) || 0), 0);
    const avg = sorted.length > 0 ? Math.round(totalSaved / sorted.length) : 0;
    const globalLimit = disc?.globalLimit || 0;
    const usedCount = disc?.stats?.usedCount ?? sorted.length;
    const pct = globalLimit ? Math.min(100, Math.round((usedCount / globalLimit) * 100)) : null;

    let kpiHtml = `
        <div class="discount-usage-kpis">
            <div class="discount-usage-kpi-card">
                <div class="kpi-label">Times Used</div>
                <div class="kpi-value">${sorted.length.toLocaleString('en-IN')}</div>
            </div>
            <div class="discount-usage-kpi-card">
                <div class="kpi-label">Total Given</div>
                <div class="kpi-value money">${_fmtINR(totalSaved)}</div>
            </div>
            <div class="discount-usage-kpi-card">
                <div class="kpi-label">Avg / Redemption</div>
                <div class="kpi-value">${_fmtINR(avg)}</div>
            </div>
        </div>`;
    if (globalLimit > 0) {
        const cls = pct >= 90 ? 'full' : pct >= 70 ? 'warn' : 'ok';
        kpiHtml += `
        <div class="discount-limit-progress">
            <div class="dlp-track"><div class="dlp-fill ${cls}" style="width:${pct}%;"></div></div>
            <div class="dlp-text"><span>${usedCount} of ${globalLimit} used</span><span>${pct}%</span></div>
        </div>`;
    }

    if (sorted.length === 0) {
        list.innerHTML = kpiHtml + `
            <div class="usage-log-empty">
                <i data-lucide="ticket"></i>
                <p>No redemptions yet</p>
                <span>Usage will appear here as customers apply this discount</span>
            </div>`;
        await loadLucide();
        window.lucide.createIcons({ root: list });
        return;
    }

    const page = sorted.slice(0, 200);
    const uniquePhones = [...new Set(page.map(u => u.customerPhone).filter(Boolean))];
    await Promise.all(uniquePhones.map(_resolveCustomerName));

    const rowsHtml = page.map(u => {
        const cleanPhone = String(u.customerPhone || '').replace(/\D/g, '').slice(-10);
        const name = _nameCache.get(cleanPhone) || u.customerPhone || 'Walk-in';
        const d = new Date(u.appliedAt || 0);
        const dateStr = d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const channel = String(u.channel || 'other');
        return `
            <div class="usage-log-row">
                <div class="usage-log-avatar">${escapeHtml(_initials(name))}</div>
                <div class="usage-log-info">
                    <div class="usage-log-name">${escapeHtml(name)}</div>
                    <div class="usage-log-meta">
                        <span>${escapeHtml(u.customerPhone || '—')}</span>
                        ${u.orderId ? `<span>·</span><span class="usage-log-order-link" data-action="viewOrderFromDiscountUsage" data-id="${escapeHtml(u.orderId)}" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">#${escapeHtml(String(u.orderId).slice(-5))}</span>` : ''}
                        <span class="channel-chip channel-${escapeHtml(channel)}">${escapeHtml(channel)}</span>
                    </div>
                </div>
                <div>
                    <div class="usage-log-amount">-${_fmtINR(u.amountGiven)}</div>
                    <div class="usage-log-date">${escapeHtml(dateStr)}</div>
                </div>
            </div>`;
    }).join('');

    list.innerHTML = kpiHtml + `<div style="margin-top:14px;">${rowsHtml}</div>` +
        (sorted.length > 200 ? `<div class="text-muted-small mt-8">Showing 200 of ${sorted.length} redemptions</div>` : '');

    await loadLucide();
    window.lucide.createIcons({ root: list });
}

export async function openDiscountUsageDirect(discountId) {
    const modal = document.getElementById('discountsReportsModal');
    if (!modal) return;

    REPORT_STATE.focusedMode = true;
    ['discountKpiGrid', 'discountReportBreakdownWrap', 'discountReportChannelsWrap', 'discountReportRecentWrap']
        .forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.querySelector('#discountsReportsModal .discount-report-range-row')?.classList.add('hidden');

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    await loadLucide();
    window.lucide.createIcons({ root: modal });

    await refreshDiscountsReport();
    await openCodeUses(discountId);
}

export function closeCodeUsesPanel() {
    const panel = document.getElementById('discountCodeUsesPanel');
    if (panel) panel.classList.add('hidden');
    if (REPORT_STATE.focusedMode) { closeDiscountsReports(); }
}
