/**
 * ROSHANI ERP | RIDER INTELLIGENCE
 * Analytics and performance monitoring for delivery personnel.
 */

import { Outlet, db, ref, get, query, orderByChild, equalTo, startAt, endAt, push, set, serverTimestamp } from '../firebase.js';
import { state } from '../state.js';
import { escapeHtml, showToast, formatDate, getISTDateString, getSkeletonDivs } from '../utils.js';
import { settleRiderWallet } from './riders.js';
import { loadJSPDF } from './printing.js';

let riderEarningsChart = null;
let _reportRows = [];
let _selectedRider = null;
let _lastFrom = '';
let _lastTo = '';
let _chartJSPromise = null;
let _reportSending = false;

async function loadChartJS() {
    if (_chartJSPromise) return _chartJSPromise;
    _chartJSPromise = import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm').then(m => {
        const C = m.Chart;
        if (C && C.register && m.CategoryScale) {
            C.register(m.CategoryScale, m.LinearScale, m.BarElement, m.BarController, m.Tooltip, m.Legend);
        }
        window.Chart = C;
        return m;
    }).catch(e => { _chartJSPromise = null; throw e; });
    await _chartJSPromise;
}

export async function generateRiderPerformanceReport() {
    const sel = document.getElementById('riderSelectAnalytics');
    const riderId = sel?.value;
    const fromEl = document.getElementById('riderReportFrom');
    const toEl = document.getElementById('riderReportTo');
    const from = fromEl?.value || '';
    const to = toEl?.value || '';

    if (!riderId) { showToast('Select a rider to analyze.', 'warning'); return; }
    if (!from || !to) { showToast('Select both From and To dates.', 'warning'); return; }
    if (new Date(from) > new Date(to)) { showToast('Start date must be before end date.', 'warning'); return; }

    _selectedRider = state.ridersList.find(r => r.id === riderId) || null;
    _lastFrom = from; _lastTo = to;

    _renderSkeleton();
    try {
        const qStart = `${from}T00:00:00.000Z`;
        const qEnd = `${to}T23:59:59.999Z`;

        const orders = [];
        const outlets = ['pizza', 'cake'];
        for (const outlet of outlets) {
            const snap = await get(query(ref(db, `${outlet}/orders`), orderByChild('createdAt'), startAt(qStart), endAt(qEnd)));
            if (snap.exists()) {
                snap.forEach(child => {
                    const o = child.val();
                    if (!o) return;
                    const assigned = o.riderId || o.assignedRider;
                    const riderEmail = _selectedRider?.email ? String(_selectedRider.email).toLowerCase() : '';
                    if (assigned !== riderId && (riderEmail && String(assigned || '').toLowerCase() !== riderEmail)) return;
                    orders.push({ outlet, id: child.key, ...o });
                });
            }
        }

        const [statsSnap, settlementsSnap] = await Promise.all([
            get(Outlet.ref(`riderStats/${riderId}`)),
            get(ref(db, `settlements/${riderId}`))
        ]);

        const stats = statsSnap.val() || {};
        const settlements = settlementsSnap.exists() ? settlementsSnap.val() : {};

        _renderReport(orders, stats, settlements, riderId);
    } catch (e) {
        console.error('[RiderAnalytics] Report generation failed:', e);
        showToast('Error generating rider report.', 'error');
        _renderEmpty('Failed to load rider data.');
    }
}

function _ms(v) {
    if (!v) return null;
    if (typeof v === 'string') return new Date(v).getTime();
    if (v && typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
    return v;
}

function _deliveryMinutes(o) {
    const a = _ms(o.assignedAt), d = _ms(o.deliveredAt);
    if (!a || !d) return null;
    return Math.round((d - a) / 60000);
}

function _renderReport(orders, stats, settlements, riderId) {
    const name = _selectedRider?.name || 'Rider';
    const delivered = orders.filter(o => String(o.status || '').toLowerCase() === 'delivered');
    const times = delivered.map(_deliveryMinutes).filter(t => t !== null && t >= 0);
    const avgTime = times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null;

    const earnings = orders.reduce((s, o) => s + Number(o.deliveryFee || 0), 0);
    const pendingCash = orders.filter(o =>
        String(o.paymentMethod || '').toUpperCase() === 'CASH' &&
        String(o.status || '').toLowerCase() === 'delivered' && !o.settled
    ).reduce((s, o) => s + Number(o.total || 0), 0);

    const lifetimeEarnings = Number(stats.totalEarnings || 0);
    const settlementList = Object.entries(settlements || {})
        .map(([id, s]) => ({ id, ...s }))
        .sort((a, b) => _ms(b.timestamp) - _ms(a.timestamp));

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setText('riderStatEarnings', '₹' + earnings.toLocaleString('en-IN'));
    setText('riderStatPendingCash', '₹' + pendingCash.toLocaleString('en-IN'));
    setText('riderStatDeliveries', delivered.length);
    setText('riderStatAvgTime', avgTime === null ? '—' : avgTime + 'm');
    setText('riderStatRating', '—');

    const tbody = document.getElementById('riderAnalyticsTableBody');
    if (!tbody) return;
    if (orders.length === 0) {
        tbody.innerHTML = '<div class="text-center p-40 text-muted">No orders found for the selected period.</div>';
    } else {
        _reportRows = orders.slice().sort((a, b) => _ms(b.createdAt) - _ms(a.createdAt));
        tbody.innerHTML = `<table class="mob-data-table">
            <thead><tr>
                <th>Date</th><th>Order</th><th>Outlet</th><th>Payment</th><th>Delivery Fee</th><th>Total</th><th>Status</th>
            </tr></thead>
            <tbody>${_reportRows.map(o => {
                const mins = _deliveryMinutes(o);
                return `<tr>
                    <td>${formatDate(o.createdAt)}</td>
                    <td>#${escapeHtml(String(o.id).slice(-5))}</td>
                    <td>${(o.outlet || '').toUpperCase()}</td>
                    <td>${escapeHtml(o.paymentMethod || '—')}</td>
                    <td>₹${Number(o.deliveryFee || 0)}</td>
                    <td>₹${Number(o.total || 0).toLocaleString('en-IN')}</td>
                    <td>${escapeHtml(o.status || '—')}${mins !== null ? `<div class="mob-td-sub">${mins}m</div>` : ''}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    }

    // Earnings trend chart
    const byDay = {};
    orders.forEach(o => {
        const d = getISTDateString(o.createdAt);
        byDay[d] = (byDay[d] || 0) + Number(o.deliveryFee || 0);
    });
    const days = Object.keys(byDay).sort();
    _renderChart(days, days.map(d => byDay[d]));

    // Status summary
    const statusEl = document.getElementById('riderStatusSummary');
    const ordered = orders.filter(o => String(o.status || '').toLowerCase() !== 'delivered');
    statusEl.innerHTML = `
        <div class="skeleton-rider-card" style="border:none;box-shadow:none;padding:0 0 10px;">
            <div class="identity-avatar-v4" style="background:var(--primary);color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;">${escapeHtml((name || '?').charAt(0).toUpperCase())}</div>
            <div class="identity-info-v4">
                <span class="name" style="font-weight:700;">${escapeHtml(name)}</span>
                <div class="mob-td-sub">${delivered.length} delivered · ${ordered.length} in progress</div>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">
            <div style="display:flex;justify-content:space-between;"><span class="mob-td-sub">Lifetime orders</span><strong>${stats.totalOrders || 0}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span class="mob-td-sub">Lifetime earnings</span><strong>₹${lifetimeEarnings.toLocaleString('en-IN')}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span class="mob-td-sub">Avg delivery time</span><strong>${avgTime === null ? '—' : avgTime + 'm'}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span class="mob-td-sub">Settlements</span><strong>${settlementList.length}</strong></div>
            ${settlementList.slice(0, 3).map(s => `<div style="display:flex;justify-content:space-between;"><span class="mob-td-sub">${formatDate(s.timestamp)}</span><strong>₹${Number(s.amountCollected || 0).toLocaleString('en-IN')}</strong></div>`).join('')}
        </div>`;
}

async function _renderChart(labels, data) {
    await loadChartJS();
    const canvas = document.getElementById('riderEarningsChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (riderEarningsChart) riderEarningsChart.destroy();
    riderEarningsChart = new window.Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ label: 'Earnings (₹)', data, backgroundColor: 'rgba(232,73,8,0.75)', borderRadius: 6 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true },
                x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }
            }
        }
    });
}

function _renderSkeleton() {
    const tbody = document.getElementById('riderAnalyticsTableBody');
    if (tbody) tbody.innerHTML = getSkeletonDivs(5);
    const statusEl = document.getElementById('riderStatusSummary');
    if (statusEl) statusEl.innerHTML = `<div class="skeleton-rider-card"><div class="skeleton skeleton-circle"></div><div class="skeleton-text-group"><div class="skeleton skeleton-text" style="width:55%"></div><div class="skeleton skeleton-text" style="width:30%"></div></div></div>`;
}

function _renderEmpty(msg) {
    const tbody = document.getElementById('riderAnalyticsTableBody');
    if (tbody) tbody.innerHTML = `<div class="text-center p-40 text-muted">${msg || 'No rider selected.'}</div>`;
    const statusEl = document.getElementById('riderStatusSummary');
    if (statusEl) statusEl.innerHTML = '<p class="text-muted-small">No rider selected for analysis.</p>';
}

export function populateRiderSelect() {
    const sel = document.getElementById('riderSelectAnalytics');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Select Rider</option>';
    state.ridersList.forEach(r => {
        sel.innerHTML += `<option value="${r.id}" ${r.id === current ? 'selected' : ''}>${escapeHtml(r.name || 'Unknown')}</option>`;
    });
}

export function cleanupRiderAnalytics() {
    if (riderEarningsChart) { riderEarningsChart.destroy(); riderEarningsChart = null; }
}

export function initRiderAnalytics() {
    const fromEl = document.getElementById('riderReportFrom');
    const toEl = document.getElementById('riderReportTo');
    if (fromEl && !fromEl.value) fromEl.value = getISTDateString(new Date(Date.now() - 29 * 86400000));
    if (toEl && !toEl.value) toEl.value = getISTDateString(new Date());

    populateRiderSelect();

    const btn = document.getElementById('btnGenerateRiderReport');
    if (btn && !btn.dataset.wired) {
        btn.dataset.wired = '1';
        btn.addEventListener('click', generateRiderPerformanceReport);
    }

    const sel = document.getElementById('riderSelectAnalytics');
    if (sel && !sel.dataset.wired) {
        sel.dataset.wired = '1';
        sel.addEventListener('change', () => {
            if (!sel.value) { _renderEmpty(); return; }
            generateRiderPerformanceReport();
        });
    }

    const settleBtn = document.getElementById('btnSettleRiderAnalytics');
    if (settleBtn && !settleBtn.dataset.wired) {
        settleBtn.dataset.wired = '1';
        settleBtn.addEventListener('click', async () => {
            const selEl = document.getElementById('riderSelectAnalytics');
            if (!selEl?.value) { showToast('Select a rider first.', 'warning'); return; }
            const rider = state.ridersList.find(r => r.id === selEl.value);
            await settleRiderWallet(rider?.id, rider?.name || 'Rider');
        });
    }

    const excelBtn = document.getElementById('btnRiderExportExcel');
    if (excelBtn && !excelBtn.dataset.wired) {
        excelBtn.dataset.wired = '1';
        excelBtn.addEventListener('click', _exportExcel);
    }

    const pdfBtn = document.getElementById('btnRiderExportPDF');
    if (pdfBtn && !pdfBtn.dataset.wired) {
        pdfBtn.dataset.wired = '1';
        pdfBtn.addEventListener('click', _exportPDF);
    }

    const waBtn = document.getElementById('btnRiderReportWhatsApp');
    if (waBtn && !waBtn.dataset.wired) {
        waBtn.dataset.wired = '1';
        waBtn.addEventListener('click', _sendWhatsApp);
    }

    if (!_selectedRider) _renderEmpty();
}

async function _sendWhatsApp() {
    if (_reportSending) { showToast('Already sending a report, please wait.', 'info'); return; }
    if (_reportRows.length === 0) { showToast('No data to send. Run Analyze first.', 'info'); return; }

    const delivered = _reportRows.filter(o => String(o.status || '').toLowerCase() === 'delivered');
    const earnings = _reportRows.reduce((s, o) => s + Number(o.deliveryFee || 0), 0);
    const pendingCash = _reportRows.filter(o =>
        String(o.paymentMethod || '').toUpperCase() === 'CASH' &&
        String(o.status || '').toLowerCase() === 'delivered' && !o.settled
    ).reduce((s, o) => s + Number(o.total || 0), 0);

    const name = _selectedRider?.name || 'Rider';
    const span = (_lastFrom === _lastTo) ? _lastFrom : `${_lastFrom} → ${_lastTo}`;
    const lines = [
        `🚴 *RIDER PERFORMANCE REPORT*`,
        ``,
        `👤 *Rider:* ${name}`,
        `📅 *Period:* ${span}`,
        ``,
        `┌─ *Summary*`,
        `│ ✅ Delivered: ${delivered.length}`,
        `│ 💰 Earnings: ₹${earnings.toLocaleString('en-IN')}`,
        `│ 💵 Pending Cash: ₹${pendingCash.toLocaleString('en-IN')}`,
        `└──────────────`,
        ``,
        `📋 *Order Details:*`,
        `_${_reportRows.length} order(s) in period_`
    ];
    _reportRows.forEach(o => {
        lines.push(`▫️ ${formatDate(o.createdAt)} | #${String(o.id).slice(-5)} | ${o.outlet?.toUpperCase() || ''} | ₹${Number(o.total || 0)} | ${o.status || ''}`);
    });

    _reportSending = true;
    try {
        const phone = await _resolveAdminPhone();
        if (!phone) { showToast('No admin phone in store settings.', 'error'); return; }

        const outlet = Outlet.current;
        const cmdRef = push(ref(db, `bot/${outlet}/commands`));
        await set(cmdRef, { action: "SEND_GENERIC_MESSAGE", phone, message: lines.join('\n'), timestamp: serverTimestamp() });
        showToast('Report sent to admin via bot.', 'success');
    } catch (e) {
        console.error('[RiderAnalytics] Bot send failed:', e);
        showToast('Failed to queue bot message.', 'error');
    } finally {
        _reportSending = false;
    }
}

async function _resolveAdminPhone() {
    try {
        const store = await get(Outlet.ref('settings/Store'));
        const delivery = await get(Outlet.ref('settings/Delivery'));
        const raw = (store.exists() && (store.val().phone || store.val().whatsappNumber)) ||
            (delivery.exists() && (delivery.val().notifyPhone || delivery.val().reportPhone));
        return String(raw || '').replace(/[^0-9]/g, '').slice(-10);
    } catch (e) {
        console.error('[RiderAnalytics] Admin phone resolve failed:', e);
        return '';
    }
}

function _exportExcel() {
    if (_reportRows.length === 0) { showToast('No data to export. Run Analyze first.', 'info'); return; }
    const data = _reportRows.map(o => ({
        Date: formatDate(o.createdAt),
        Order: '#' + String(o.id).slice(-5),
        Outlet: (o.outlet || '').toUpperCase(),
        Payment: o.paymentMethod || '',
        'Delivery Fee': o.deliveryFee || 0,
        Total: o.total || 0,
        Status: o.status || ''
    }));
    if (typeof XLSX !== 'undefined') {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Rider Report');
        XLSX.writeFile(wb, `Rider_Report_${_lastFrom}_to_${_lastTo}.xlsx`);
        showToast('Excel downloaded.', 'success');
    } else {
        showToast('Excel library not loaded.', 'error');
    }
}

async function _exportPDF() {
    await loadJSPDF();
    if (_reportRows.length === 0) { showToast('No data to export. Run Analyze first.', 'info'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    if (typeof doc.autoTable !== 'function') { showToast('PDF table plugin not ready.', 'error'); return; }
    const name = _selectedRider?.name || 'Rider';
    doc.setFontSize(20);
    doc.text('Rider Performance Report', 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Rider: ${name}`, 14, 30);
    doc.text(`Period: ${_lastFrom} to ${_lastTo}`, 14, 38);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 46);
    doc.autoTable({
        startY: 52,
        head: [['Date', 'Order', 'Outlet', 'Payment', 'Fee', 'Total', 'Status']],
        body: _reportRows.map(o => [
            formatDate(o.createdAt),
            '#' + String(o.id).slice(-5),
            (o.outlet || '').toUpperCase(),
            o.paymentMethod || '',
            '₹' + (o.deliveryFee || 0),
            '₹' + Number(o.total || 0),
            o.status || ''
        ]),
        theme: 'grid',
        headStyles: { fillColor: [6, 95, 70] }
    });
    doc.save(`Rider_Report_${name.replace(/\s+/g, '_')}_${_lastFrom}_to_${_lastTo}.pdf`);
}
