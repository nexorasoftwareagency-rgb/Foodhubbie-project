/**
 * FoodHubbie ERP | FEEDBACK MANAGEMENT MODULE
 * mob-data-table (plain HTML, no Tabulator) — same design as the Payments tab.
 */

import { Outlet, onValue, isConnected, onConnectionChange } from '../firebase.js';
import { escapeHtml, getSkeletonRows } from '../utils.js';

let _feedbackUnsub = null;
let _connUnsub = null;
let _feedData = [];
let _feedSortField = 'timestamp', _feedSortDir = 'desc';

function _ratingBadge(rating) {
    const r = parseInt(rating, 10) || 0;
    const cls = r <= 2 ? 'low' : r <= 3 ? 'mid' : 'high';
    return `<span class="mob-badge mob-badge-rating-${cls}">${'\u2605'.repeat(r)} ${r}/5</span>`;
}

function formatDateTime(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
        + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

function _renderFeedTable() {
    const tbody = document.getElementById('feedbackTableBody');
    const countEl = document.getElementById('feedbackCount');
    if (!tbody) return;

    if (countEl) countEl.textContent = `${_feedData.length} feedback${_feedData.length === 1 ? '' : 's'}`;

    const sorted = [..._feedData].sort((a, b) => {
        let av = a[_feedSortField], bv = b[_feedSortField];
        if (_feedSortField === 'timestamp' || _feedSortField === 'rating') {
            av = _feedSortField === 'timestamp' ? new Date(av || 0).getTime() : Number(av || 0);
            bv = _feedSortField === 'timestamp' ? new Date(bv || 0).getTime() : Number(bv || 0);
        } else {
            av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase();
        }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _feedSortDir === 'asc' ? cmp : -cmp;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="mob-table-empty">No feedback received yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(f => {
        const name = f.customerName || 'Guest';
        const phone = f.phone || 'Anonymous';
        const reason = f.reason || f.feedback || 'General Rating';
        const comment = f.comment || '';
        return `<tr>
            <td>
                <div class="mob-td-strong">${formatDateTime(f.timestamp)}</div>
                <div class="mob-td-sub">Log Time</div>
            </td>
            <td>
                <div class="mob-td-strong">#${escapeHtml(f.orderId || 'N/A')}</div>
            </td>
            <td>
                <div class="mob-td-strong">${escapeHtml(name)}</div>
                <div class="mob-td-sub">${escapeHtml(phone)}</div>
            </td>
            <td>${_ratingBadge(f.rating)}</td>
            <td>
                <div class="mob-td-strong">${escapeHtml(reason)}</div>
                ${comment ? `<div class="mob-td-sub">\u201C${escapeHtml(comment)}\u201D</div>` : ''}
            </td>
        </tr>`;
    }).join('');
}

function _initFeedTable() {
    const table = document.getElementById('feedbackTable');
    if (!table || table.dataset.wired) return;
    table.dataset.wired = '1';

    const sortEl = table.querySelector(`th[data-sort="${_feedSortField}"]`);
    if (sortEl) sortEl.classList.add(`mob-sort-${_feedSortDir}`);

    table.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (_feedSortField === field) {
                _feedSortDir = _feedSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _feedSortField = field;
                _feedSortDir = field === 'timestamp' || field === 'rating' ? 'desc' : 'asc';
            }
            table.querySelectorAll('th[data-sort]').forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_feedSortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderFeedTable();
        });
    });
}

export function loadFeedbacks() {
    const tableBody = document.getElementById('feedbackTableBody');
    if (!tableBody) return;

    if (_connUnsub) { _connUnsub(); _connUnsub = null; }
    cleanupFeedbacks();

    if (!isConnected()) {
        tableBody.innerHTML = '<tr><td colspan="5"><div class="offline-placeholder"><div class="offline-icon">\uD83D\uDCE1</div><h4>Waiting for connection</h4><p>Feedback data will load automatically when the connection is restored.</p></div></td></tr>';
        if (!_connUnsub) _connUnsub = onConnectionChange(function _retryFb(online) {
            if (!online) return;
            if (_connUnsub) { _connUnsub(); _connUnsub = null; }
            cleanupFeedbacks();
            loadFeedbacks();
        });
        return;
    }

    tableBody.innerHTML = getSkeletonRows(5, 5);

    _feedbackUnsub = onValue(Outlet.ref("feedbacks"), snap => {
        const feedbacks = [];
        snap.forEach(child => {
            feedbacks.push({ id: child.key, ...child.val() });
        });

        feedbacks.sort((a, b) => {
            const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            return dateB - dateA;
        });

        _feedData = feedbacks;
        _initFeedTable();
        _renderFeedTable();
    }, (error) => {
        console.error('[Feedback] Firebase read error:', error);
        const tb = document.getElementById('feedbackTableBody');
        if (tb) tb.innerHTML = '<tr><td colspan="5" style="padding:40px;text-align:center;color:#ef4444;font-weight:600;">Failed to load feedback data</td></tr>';
    });
}

export function cleanupFeedbacks() {
    console.log("[Performance] Cleaning up Feedback listeners...");
    if (_feedbackUnsub) {
        _feedbackUnsub();
        _feedbackUnsub = null;
    }
    if (_connUnsub) { _connUnsub(); _connUnsub = null; }
}
