/**
 * FoodHubbie ERP | WHATSAPP BOT ANALYTICS (Admin/js/features/wa-analytics.js)
 * ============================================================================
 * Reads bot/usage/{date} and chats/ data to render WhatsApp Bot KPIs,
 * message breakdown, 7-day trend, and daily history table.
 *
 * Data path: businesses/{bid}/outlets/{oid}/bot/usage/{IST-date}
 *   { total, order_notification, rider_broadcast, promo, admin_alert, updatedAt }
 *
 * Chats data: businesses/{bid}/outlets/{oid}/chats/{customerId}/meta
 *   { lastTs, unread, phone, name }
 * ============================================================================
 */

import { Outlet, onValue } from '../firebase.js';
import { escapeHtml } from '../utils.js';
import { loadLucide } from '../ui.js';

let _usageUnsub = null;
let _chatsUnsub = null;
let _usageData = null;
let _chatsData = null;
let _active = false;

function _istDate(ts) {
    if (!ts) return '';
    return new Date(ts + 5.5 * 3600000).toISOString().split('T')[0];
}

function _dayLabel(dateStr) {
    const d = new Date(dateStr + 'T00:00:00+05:30');
    const today = _istDate(Date.now());
    const yesterday = _istDate(Date.now() - 86400000);
    if (dateStr === today) return 'Today';
    if (dateStr === yesterday) return 'Yest.';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function _countConversationsToday() {
    if (!_chatsData) return 0;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    let count = 0;
    for (const [, thread] of Object.entries(_chatsData)) {
        if (thread.meta?.lastTs >= todayMs) count++;
    }
    return count;
}

function _countUniqueNumbersToday() {
    if (!_usageData) return 0;
    // Approximate from usage data — unique recipients is not tracked per-message,
    // so we use total as a proxy for unique contacts (conservative estimate).
    const today = _istDate(Date.now());
    return _usageData[today]?.total || 0;
}

function _renderKpis() {
    const today = _istDate(Date.now());
    const yesterday = _istDate(Date.now() - 86400000);
    const todayData = _usageData?.[today] || {};
    const yesterdayData = _usageData?.[yesterday] || {};

    const sentToday = todayData.total || 0;
    const sentYesterday = yesterdayData.total || 0;
    const incomingToday = _countConversationsToday();
    const uniqueNums = sentToday; // proxy
    const conversations = incomingToday;

    _setKpi('waKpiSentToday', sentToday, sentYesterday);
    _setKpi('waKpiIncomingToday', incomingToday, 0);
    _setKpi('waKpiUniqueNums', uniqueNums, 0);
    _setKpi('waKpiConversations', conversations, 0);

    // Breakdown rings
    _setVal('waCountOrders', todayData.order_notification || 0);
    _setVal('waCountRiders', todayData.rider_broadcast || 0);
    _setVal('waCountPromos', todayData.promo || 0);
    _setVal('waCountAdmin', todayData.admin_alert || 0);
}

function _setKpi(id, cur, prev) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = cur.toLocaleString('en-IN');
    const trendId = id + 'Trend';
    const trendEl = document.getElementById(trendId);
    if (trendEl && prev !== undefined) {
        const diff = prev > 0 ? ((cur - prev) / prev * 100).toFixed(0) : (cur > 0 ? 100 : 0);
        const sign = diff > 0 ? '+' : '';
        trendEl.textContent = `${sign}${diff}% vs yesterday`;
        trendEl.style.color = diff > 0 ? '#16a34a' : diff < 0 ? '#ef4444' : '#6b7280';
    }
}

function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function _renderTrendChart() {
    const container = document.getElementById('waTrendChart');
    if (!container) return;

    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000 + 5.5 * 3600000);
        days.push(d.toISOString().split('T')[0]);
    }
    const series = days.map(d => ({
        date: d,
        count: _usageData?.[d]?.total || 0
    }));
    const maxCount = Math.max(1, ...series.map(d => d.count));

    container.innerHTML = series.map(s => {
        const h = maxCount > 0 ? Math.max(3, (s.count / maxCount) * 70) : 3;
        return `<div class="wa-trend-bar">
            <span class="wa-trend-bar-val">${s.count || ''}</span>
            <div class="wa-trend-bar-fill" style="height:${h}px"></div>
            <span class="wa-trend-bar-date">${_dayLabel(s.date)}</span>
        </div>`;
    }).join('');
}

function _renderHistoryTable() {
    const tbody = document.getElementById('waHistoryBody');
    if (!tbody) return;

    const days = [];
    for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000 + 5.5 * 3600000);
        days.push(d.toISOString().split('T')[0]);
    }

    const rows = days.map(d => {
        const data = _usageData?.[d] || {};
        const total = data.total || 0;
        if (total === 0) return '';
        return `<tr>
            <td>${_dayLabel(d)}</td>
            <td><strong>${total}</strong></td>
            <td>${data.order_notification || 0}</td>
            <td>${data.rider_broadcast || 0}</td>
            <td>${data.promo || 0}</td>
            <td>${data.admin_alert || 0}</td>
        </tr>`;
    }).filter(Boolean).reverse().join('');

    tbody.innerHTML = rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-tertiary)">No data yet</td></tr>';
}

function _renderAll() {
    if (!_active) return;
    _renderKpis();
    _renderTrendChart();
    _renderHistoryTable();
}

export function mount() {
    _active = true;
    _usageUnsub = onValue(Outlet.ref('bot/usage'), (snap) => {
        _usageData = snap.val();
        _renderAll();
    }, () => {});
    _chatsUnsub = onValue(Outlet.ref('chats'), (snap) => {
        _chatsData = snap.val();
        _renderAll();
    }, () => {});
}

export function unmount() {
    _active = false;
    if (_usageUnsub) { _usageUnsub(); _usageUnsub = null; }
    if (_chatsUnsub) { _chatsUnsub(); _chatsUnsub = null; }
    _usageData = null;
    _chatsData = null;
}
