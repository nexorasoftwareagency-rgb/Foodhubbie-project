import { Outlet, tenantRef, get, query, orderByChild, startAt, endAt, push, set, update, remove, runTransaction, serverTimestamp, ref as dbRef, BUSINESS_ID } from '../firebase.js';
import { escapeHtml, showToast, formatDate, getISTDateString } from '../utils.js';
import { loadJSPDF } from './printing.js';
import { logger } from '../utils/logger.js';

let _expenseData = [];
let _filteredData = [];
let _sortField = 'date', _sortDir = 'desc';
let _searchTerm = '';
let _categoryCache = [];
let _categoryCacheAt = 0; // timestamp for TTL
const CATEGORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let _currentSubTab = 'today';
let _historyFilters = { from: '', to: '', category: '', status: '', search: '' };
let _chartInstances = {};

function fmtMoney(n) {
    const v = Number(n || 0);
    return 'Rs.' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
}

function _renderExpenseTable() {
    const tbody = document.getElementById('expenseDataTableBody');
    const countEl = document.getElementById('expTableCount');
    if (!tbody) return;

    let data = _filteredData;
    const term = _searchTerm.trim().toLowerCase();
    if (term) {
        data = data.filter(e =>
            (e.categoryName || '').toLowerCase().includes(term) ||
            (e.description || '').toLowerCase().includes(term) ||
            (e.outletId || '').toLowerCase().includes(term) ||
            fmtMoney(e.amount || 0).includes(term)
        );
    }
    _filteredData = data;

    if (countEl) countEl.textContent = `${data.length} expense${data.length === 1 ? '' : 's'}`;

    const sorted = [...data].sort((a, b) => {
        let av = a[_sortField], bv = b[_sortField];
        if (_sortField === 'amount' || _sortField === 'date') {
            av = _sortField === 'date' ? (a[_sortField] || '') : Number(av || 0);
            bv = _sortField === 'date' ? (b[_sortField] || '') : Number(bv || 0);
        } else {
            av = String(av || '').toLowerCase();
            bv = String(bv || '').toLowerCase();
        }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _sortDir === 'asc' ? cmp : -cmp;
    });

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="mob-table-empty">${term ? 'No expenses match your search.' : 'No expenses found.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(e => {
        const statusBadge = e.status === 'approved'
            ? `<span class="mob-badge mob-badge-approved">Approved</span>`
            : e.status === 'pending'
                ? `<span class="mob-badge mob-badge-pending">Pending</span>`
                : `<span class="mob-badge mob-badge-rejected">Rejected</span>`;

        return `<tr>
            <td>${escapeHtml(formatDate(e.date || e.createdAt) || '—')}</td>
            <td>${escapeHtml(e.categoryName || '—')}</td>
            <td><span class="mob-addr-text" title="${escapeHtml(e.description || '—')}">${escapeHtml(e.description || '—')}</span></td>
            <td class="mob-th-right"><span class="mob-td-total">${fmtMoney(e.amount || 0)}</span></td>
            <td>${escapeHtml(e.outletId || '—')}</td>
            <td class="mob-th-center">${statusBadge}</td>
            <td class="mob-th-center">
                <div style="display:flex; gap:4px; justify-content:center;">
                    <button type="button" class="btn-icon-only" data-action="editExpense" data-id="${e.id}" title="Edit" aria-label="Edit expense"><i data-lucide="edit-2" style="width:14px;height:14px;"></i></button>
                    <button type="button" class="btn-icon-only btn-danger" data-action="deleteExpense" data-id="${e.id}" title="Delete" aria-label="Delete expense"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

export function filterExpenses(searchTerm) {
    _searchTerm = (searchTerm || '').trim();
    _renderExpenseTable();
}


export function initExpenseTable() {
    const table = document.getElementById('expenseDataTable');
    if (!table || table.dataset.wired) return;
    table.dataset.wired = '1';

    const ths = table.querySelectorAll('th[data-sort]');
    ths.forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (_sortField === field) {
                _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                _sortField = field;
                _sortDir = field === 'amount' || field === 'date' ? 'desc' : 'asc';
            }
            ths.forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
            th.classList.add(_sortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
            _renderExpenseTable();
        });
    });
}


// Sub-tab state and switching
function _switchExpenseSubTab(subTab) {
    _currentSubTab = subTab;
    document.querySelectorAll('.expense-subtab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.expenseSubtab === subTab);
    });
    document.querySelectorAll('.expense-subtab-content').forEach(div => {
        div.classList.toggle('hidden', div.id !== `expense-subtab-${subTab}`);
    });

    // Load sub-tab specific content
    switch (subTab) {
        case 'today': _renderTodayView(); break;
        case 'history': _renderHistoryView(); break;
        case 'categories': _renderCategoriesView(); break;
        case 'reports': _renderReportsView(); break;
        case 'settings': _loadSettingsView(); break;
    }
}

// Initialize sub-tab listeners
export function initExpenseSubTabs() {
    document.querySelectorAll('.expense-subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => _switchExpenseSubTab(btn.dataset.expenseSubtab));
    });

    // History filters
    const fromEl = document.getElementById('expenseHistoryFrom');
    const toEl = document.getElementById('expenseHistoryTo');
    const catEl = document.getElementById('expenseHistoryCategory');
    const statusEl = document.getElementById('expenseHistoryStatus');
    const searchEl = document.getElementById('expenseHistorySearch');

    if (fromEl) fromEl.addEventListener('change', () => { _historyFilters.from = fromEl.value; _renderHistoryView(); });
    if (toEl) toEl.addEventListener('change', () => { _historyFilters.to = toEl.value; _renderHistoryView(); });
    if (catEl) catEl.addEventListener('change', () => { _historyFilters.category = catEl.value; _renderHistoryView(); });
    if (statusEl) statusEl.addEventListener('change', () => { _historyFilters.status = statusEl.value; _renderHistoryView(); });
    if (searchEl) searchEl.addEventListener('input', () => { _historyFilters.search = searchEl.value; _renderHistoryView(); });

    // Set default date range to current month
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    if (fromEl && !fromEl.value) fromEl.value = firstDay.toISOString().split('T')[0];
    if (toEl && !toEl.value) toEl.value = new Date().toISOString().split('T')[0];
    _historyFilters.from = fromEl?.value || '';
    _historyFilters.to = toEl?.value || '';
}

// ===== TODAY VIEW =====
function _renderTodayView() {
    const today = new Date().toISOString().split('T')[0];
    const todayExpenses = _expenseData.filter(e => e.date === today);
    const total = todayExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);

    document.getElementById('expenseTodayTotal').textContent = fmtMoney(total);

    // Category chips
    const chipsContainer = document.getElementById('expenseCategoryChips');
    if (chipsContainer) {
        const cats = [...new Set(todayExpenses.map(e => e.categoryName || 'Other'))];
        chipsContainer.innerHTML = cats.map(cat => {
            const catData = _categoryCache.find(c => c.name === cat);
            const color = catData?.color || '#E84908';
            const icon = catData?.icon || 'dollar-sign';
            const catTotal = todayExpenses.filter(e => (e.categoryName || 'Other') === cat).reduce((s, e) => s + Number(e.amount || 0), 0);
            return `<span class="expense-category-chip" style="border-color:${color}; color:${color};" title="${cat}: ${fmtMoney(catTotal)}"><i data-lucide="${icon}" class="icon-12"></i> ${cat} <span class="chip-amount">${fmtMoney(catTotal)}</span></span>`;
        }).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: chipsContainer });
    }

    // Today table
    const tbody = document.getElementById('expenseTodayTableBody');
    if (!tbody) return;

    if (todayExpenses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="mob-table-empty">No expenses logged today</td></tr>`;
        return;
    }

    tbody.innerHTML = todayExpenses.map(e => {
        return `<tr>
            <td>${escapeHtml(formatDate(e.date || e.createdAt) || '—')}</td>
            <td>${escapeHtml(e.categoryName || '—')}</td>
            <td><span class="mob-addr-text" title="${escapeHtml(e.description || '—')}">${escapeHtml(e.description || '—')}</span></td>
            <td class="mob-th-right"><span class="mob-td-total">${fmtMoney(e.amount || 0)}</span></td>
            <td class="mob-th-center"><button type="button" class="btn-icon-only" data-action="editExpense" data-id="${e.id}" title="Edit"><i data-lucide="edit-2" style="width:14px;height:14px;"></i></button></td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ===== HISTORY VIEW =====
function _renderHistoryView() {
    let data = [..._expenseData];

    if (_historyFilters.from) data = data.filter(e => e.date >= _historyFilters.from);
    if (_historyFilters.to) data = data.filter(e => e.date <= _historyFilters.to);
    if (_historyFilters.category) data = data.filter(e => (e.categoryName || '') === _historyFilters.category);
    if (_historyFilters.status) data = data.filter(e => (e.status || 'pending') === _historyFilters.status);
    if (_historyFilters.search) {
        const term = _historyFilters.search.toLowerCase();
        data = data.filter(e =>
            (e.categoryName || '').toLowerCase().includes(term) ||
            (e.description || '').toLowerCase().includes(term) ||
            (e.outletId || '').toLowerCase().includes(term) ||
            fmtMoney(e.amount || 0).includes(term)
        );
    }

    data.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    // Update category filter dropdown
    const catSelect = document.getElementById('expenseHistoryCategory');
    if (catSelect && catSelect.options.length <= 1) {
        const cats = [...new Set(_expenseData.map(e => e.categoryName).filter(Boolean))];
        cats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            catSelect.appendChild(opt);
        });
    }

    const tbody = document.getElementById('expenseHistoryTableBody');
    if (!tbody) return;

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="mob-table-empty">No expenses match your filters</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(e => {
        const statusBadge = e.status === 'approved'
            ? `<span class="mob-badge mob-badge-approved">Approved</span>`
            : e.status === 'pending'
                ? `<span class="mob-badge mob-badge-pending">Pending</span>`
                : `<span class="mob-badge mob-badge-rejected">Rejected</span>`;
        return `<tr>
            <td>${escapeHtml(formatDate(e.date || e.createdAt) || '—')}</td>
            <td>${escapeHtml(e.categoryName || '—')}</td>
            <td><span class="mob-addr-text" title="${escapeHtml(e.description || '—')}">${escapeHtml(e.description || '—')}</span></td>
            <td class="mob-th-right"><span class="mob-td-total">${fmtMoney(e.amount || 0)}</span></td>
            <td>${escapeHtml(e.outletId || '—')}</td>
            <td class="mob-th-center">${statusBadge}</td>
            <td class="mob-th-center"><button type="button" class="btn-icon-only" data-action="editExpense" data-id="${e.id}" title="Edit"><i data-lucide="edit-2" style="width:14px;height:14px;"></i></button></td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();

}
// ===== CATEGORIES VIEW =====
async function _renderCategoriesView() {
    const container = document.getElementById('expenseCategoriesContainer');
    if (!container) return;
    // Reuse the category modal content
    await openExpenseCategoryModal();
}

// ===== REPORTS VIEW =====
async function _renderReportsView() {
    const { _loadChartJS } = await import('../utils.js');
    await _loadChartJS();

    // Compute report data
    const currentOutlet = window.currentOutlet || 'pizza';
    const expenses = _expenseData.filter(e => e.outletId === currentOutlet || currentOutlet === 'all');

    // Monthly summary
    const monthly = {};
    expenses.forEach(e => {
        const month = e.date?.substring(0, 7) || 'Unknown';
        if (!monthly[month]) monthly[month] = { total: 0, count: 0, byCat: {} };
        monthly[month].total += Number(e.amount || 0);
        monthly[month].count++;
        const cat = e.categoryName || 'Other';
        monthly[month].byCat[cat] = (monthly[month].byCat[cat] || 0) + Number(e.amount || 0);
    });

    const months = Object.keys(monthly).sort();
    const monthlyLabels = months.map(monthStr => {
        const [y, m] = monthStr.split('-');
        return new Date(y, m - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    });
    const monthlyTotals = months.map(m => monthly[m].total);
    const monthlyBudgets = months.map(m => {
        // Sum of category budgets for this month
        return _categoryCache.reduce((s, c) => s + (c.monthlyBudget || 0), 0);
    });

    // Monthly chart
    const monthlyCtx = document.getElementById('expenseMonthlyChart');
    if (monthlyCtx) {
        _destroyChart('monthly');
        _chartInstances.monthly = new Chart(monthlyCtx, {
            type: 'bar',
            data: { labels: monthlyLabels, datasets: [
                { label: 'Actual', data: monthlyTotals, backgroundColor: '#E84908' },
                { label: 'Budget', data: monthlyBudgets, backgroundColor: '#3B82F6' }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
        });
    }

    // Monthly table
    const monthlyBody = document.getElementById('expenseMonthlyTableBody');
    if (monthlyBody) {
        monthlyBody.innerHTML = months.map(m => {
            const total = monthly[m].total;
            const budget = _categoryCache.reduce((s, c) => s + (c.monthlyBudget || 0), 0);
            const variance = total - budget;
            const varianceClass = variance > 0 ? 'text-error' : 'text-success';
            return `<tr><td>${months.indexOf(m) + 1}/${m.split('-')[0].slice(2)}</td><td class="mob-th-right">${fmtMoney(total)}</td><td class="mob-th-right">${fmtMoney(budget)}</td><td class="mob-th-right ${varianceClass}">${variance >= 0 ? '+' : ''}${fmtMoney(variance)}</td></tr>`;
        }).join('');
    }

    // Category breakdown
    const catTotals = {};
    expenses.forEach(e => {
        const cat = e.categoryName || 'Other';
        catTotals[cat] = (catTotals[cat] || 0) + Number(e.amount || 0);
    });
    const totalAll = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const catLabels = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]);
    const catData = catLabels.map(c => catTotals[c]);
    const catColors = catLabels.map(c => {
        const cat = _categoryCache.find(x => x.name === c);
        return cat?.color || '#E84908';
    });

    const catCtx = document.getElementById('expenseCategoryChart');
    if (catCtx) {
        _destroyChart('category');
        _chartInstances.category = new Chart(catCtx, {
            type: 'doughnut',
            data: { labels: catLabels, datasets: [{ data: catData, backgroundColor: catColors }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
    }

    const catBody = document.getElementById('expenseCategoryBreakdownBody');
    if (catBody) {
        catBody.innerHTML = catLabels.map(c => {
            const amt = catTotals[c];
            const pct = totalAll ? ((amt / totalAll) * 100).toFixed(1) : 0;
            const cat = _categoryCache.find(x => x.name === c);
            const budget = cat?.monthlyBudget || 0;
            const status = budget && amt > budget ? '<span class="mob-badge mob-badge-rejected">Over Budget</span>' : '<span class="mob-badge mob-badge-approved">On Track</span>';
            return `<tr><td>${c}</td><td class="mob-th-right">${fmtMoney(amt)}</td><td class="mob-th-right">${pct}%</td><td class="mob-th-right">${fmtMoney(budget)}</td><td class="mob-th-center">${status}</td></tr>`;
        }).join('');
    }

    // Outlet comparison (if multi-outlet)
    const outletCtx = document.getElementById('expenseOutletChart');
    if (outletCtx) {
        const outlets = [...new Set(expenses.map(e => e.outletId))];
        const outletData = outlets.map(o => {
            const outExpenses = expenses.filter(e => e.outletId === o);
            return outExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        });
        _destroyChart('outlet');
        _chartInstances.outlet = new Chart(outletCtx, {
            type: 'bar',
            data: { labels: outlets, datasets: [{ label: 'Total Spend', data: outletData, backgroundColor: '#E84908' }] },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' }
        });
    }

    // Trend chart
    const trendCtx = document.getElementById('expenseTrendChart');
    if (trendCtx) {
        const days = [...new Set(expenses.map(e => e.date))].sort();
        const trendData = days.map(d => expenses.filter(e => e.date === d).reduce((s, e) => s + Number(e.amount || 0), 0));
        const trendLabels = days.map(d => d.split('-').slice(1).join('-'));
        _destroyChart('trend');
        _chartInstances.trend = new Chart(trendCtx, {
            type: 'line',
            data: { labels: trendLabels, datasets: [{ label: 'Daily Spend', data: trendData, borderColor: '#E84908', fill: false, tension: 0.3 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

function _destroyChart(name) {
    if (_chartInstances[name]) {
        _chartInstances[name].destroy();
        delete _chartInstances[name];
    }
}

// ===== SETTINGS VIEW =====
async function _loadSettingsView() {
    try {
        const { Outlet, get } = await import('../firebase.js');
        const snap = await get(Outlet.ref('settings/Expenses'));
        if (snap.exists()) {
            const s = snap.val();
            document.getElementById('expenseAutoApproveThreshold').value = s.autoApproveThreshold || 5000;
            document.getElementById('expenseCeilingPct').value = s.expenseCeilingPct || 10;
            document.getElementById('expenseCurrencyDisplay').value = s.currencyDisplay || 'Rs.';
            document.getElementById('expenseRetentionDays').value = s.retentionDays || 90;
            document.getElementById('expenseApprovalWorkflow').value = s.approvalWorkflow || 'single';
        }
    } catch (e) {
        console.error('[Expenses] Load settings error:', e);
    }
}

export async function saveExpenseSettings() {
    try {
        const { Outlet, set } = await import('../firebase.js');
        const settings = {
            autoApproveThreshold: Number(document.getElementById('expenseAutoApproveThreshold').value) || 5000,
            expenseCeilingPct: Number(document.getElementById('expenseCeilingPct').value) || 10,
            currencyDisplay: document.getElementById('expenseCurrencyDisplay').value,
            retentionDays: Number(document.getElementById('expenseRetentionDays').value) || 90,
            approvalWorkflow: document.getElementById('expenseApprovalWorkflow').value,
            updatedAt: Date.now(),
            updatedBy: (await import('../firebase.js')).auth.currentUser?.uid
        };
        await set(Outlet.ref('settings/Expenses'), settings);
        showToast('Settings saved', 'success');
    } catch (e) {
        console.error('[Expenses] Save settings error:', e);
        showToast('Failed to save settings', 'error');
    }
}


export async function seedExpenseCategories() {
    if (!confirm('This will create 7 default system categories (Rent, Utilities, Payroll, Supplies, Marketing, Maintenance, Misc) with budgets and alerts. Continue?')) return;
    try {
        const { Outlet, get, push, set } = await import('../firebase.js');
        const currentOutlet = window.currentOutlet || 'pizza';
        
        // Check if categories already exist
        const catSnap = await get(Outlet.ref('expenseCategories'));
        if (catSnap.exists() && Object.keys(catSnap.val() || {}).length > 0) {
            if (!confirm('Categories already exist. This will add default categories alongside existing ones. Continue?')) return;
        }

        const DEFAULT_CATEGORIES = [
            { name: 'Rent', color: '#3B82F6', icon: 'home', monthlyBudget: 50000, alertThreshold: 80, isSystem: true, displayOrder: 1 },
            { name: 'Utilities', color: '#F59E0B', icon: 'zap', monthlyBudget: 10000, alertThreshold: 80, isSystem: true, displayOrder: 2 },
            { name: 'Payroll', color: '#10B981', icon: 'credit-card', monthlyBudget: 200000, alertThreshold: 80, isSystem: true, displayOrder: 3 },
            { name: 'Supplies', color: '#8B5CF6', icon: 'utensils', monthlyBudget: 5000, alertThreshold: 80, isSystem: true, displayOrder: 4 },
            { name: 'Marketing', color: '#EC4899', icon: 'megaphone', monthlyBudget: 10000, alertThreshold: 80, isSystem: true, displayOrder: 5 },
            { name: 'Maintenance', color: '#64748B', icon: 'wrench', monthlyBudget: 3000, alertThreshold: 80, isSystem: true, displayOrder: 6 },
            { name: 'Misc', color: '#6B7280', icon: 'dollar-sign', monthlyBudget: 2000, alertThreshold: 80, isSystem: true, displayOrder: 7 },
        ];

        showToast('Seeding default categories...', 'info');
        for (const cat of DEFAULT_CATEGORIES) {
            const ref = push(Outlet.ref('expenseCategories'));
            await set(ref, cat);
        }
        
        showToast('7 default categories seeded successfully!', 'success');
        await renderExpenseCategoryList();
        await loadExpenseCategories();
    } catch (e) {
        console.error('[Expenses] Seed categories error:', e);
        showToast('Failed to seed categories: ' + e.message, 'error');
    }
}

// Update loadExpenses to initialize sub-tabs
export async function loadExpenses() {
    try {
        const { Outlet, get, query, orderByChild, equalTo } = await import('../firebase.js');
        const currentOutlet = window.currentOutlet || 'pizza';
        const expenseRef = Outlet.ref('expenses');
        // Query by outletId server-side to avoid fetching other outlets' data
        // Note: RTDB doesn't support compound queries, so we filter by outletId server-side
        // and sort by date client-side
        const snap = await get(query(expenseRef, orderByChild('outletId'), equalTo(currentOutlet)));
        
        _expenseData = [];
        if (snap.exists()) {
            snap.forEach(child => {
                const val = child.val();
                if (val) {
                    _expenseData.push({ id: child.key, ...val });
                }
            });
        }
        
        // Sort by date descending (newest first) - client-side since we ordered by outletId
        _expenseData.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        
        _renderExpenseTable();
        _updateTabCounts();
        
        // Initialize sub-tabs
        initExpenseSubTabs();
        _switchExpenseSubTab('today');
    } catch (e) {
        console.error('[Expenses] Load error:', e);
        showToast('Failed to load expenses', 'error');
    }
}

export function downloadExpenseExcel() {
    if (_filteredData.length === 0) { showToast('No expense data to export.', 'info'); return; }
    showToast('Generating Excel...', 'info');

    const data = _filteredData.map(e => ({
        Date: formatDate(e.date || e.createdAt),
        Category: e.categoryName || '',
        Description: e.description || '',
        Amount: e.amount || 0,
        Outlet: e.outletId || '',
        Status: e.status || ''
    }));

    if (typeof XLSX !== 'undefined') {
        setTimeout(() => {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
            XLSX.writeFile(wb, `Expenses_${new Date().toISOString().split('T')[0]}.xlsx`);
        }, 50);
    } else {
        showToast('Excel library not loaded.', 'error');
    }
}

export async function downloadExpensePDF() {
    await loadJSPDF();
    if (_filteredData.length === 0) { showToast('No expense data to export.', 'warning'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    if (typeof doc.autoTable !== 'function') { showToast('PDF table plugin not ready.', 'error'); return; }

    showToast('Generating PDF...', 'info');

    let storeName = 'FoodHubbie';
    try {
        const snap = await get(Outlet.ref('settings/Store'));
        if (snap.exists() && snap.val().storeName) storeName = snap.val().storeName;
    } catch (_) {}

    const primary = [232, 73, 8];
    const ink = [15, 23, 42];
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const M = 14;
    const rs = n => 'Rs.' + Math.round(Number(n || 0)).toLocaleString('en-IN');
    const mix = (a, b, t) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return a;
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
};

    const rows = _filteredData;
    const totalAmount = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalCount = rows.length;

    // Hero band
    const heroH = 54, steps = 54;
    const A = [176, 47, 6], B = [232, 73, 8], C = [255, 132, 56];
    for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        doc.setFillColor(...(t < 0.5 ? mix(A, B, t * 2) : mix(B, C, (t - 0.5) * 2)));
        doc.rect(0, heroH * i / steps, pw, heroH / steps + 0.6, 'F');
    }
    doc.setGState(new doc.GState({ opacity: 0.1 }));
    doc.setFillColor(255, 255, 255);
    doc.circle(pw - 26, 14, 28, 'F');
    doc.circle(pw - 74, 47, 13, 'F');
    doc.circle(20, 52, 20, 'F');
    doc.setGState(new doc.GState({ opacity: 1 }));

    // FH badge + brand block
    doc.setFillColor(255, 255, 255);
    doc.circle(M + 13, 22, 12.5, 'F');
    doc.setTextColor(...primary);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('FH', M + 13, 27, { align: 'center' });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text('FOODHUBBIE', M + 30, 13.5, { charSpace: 2.2 });
    let nameSize = 21;
    doc.setFontSize(nameSize);
    const nameW = doc.getTextWidth(storeName);
    const nameMax = pw - (M + 30) - M;
    if (nameW > nameMax) nameSize = Math.max(12, nameSize * nameMax / nameW);
    doc.setFontSize(nameSize);
    doc.text(storeName, M + 30, 27);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 220, 205);
    doc.text(`Expense Report  ·  ${rows.length} expenses  ·  Generated ${new Date().toLocaleString('en-IN')}`, M + 30, 35);

    // KPI cards
    const cardY = 46, cardH = 26, gap = 6;
    const cardW = (pw - 2 * M - 3 * gap) / 4;
    const kpis = [
        ['TOTAL EXPENSES', rs(totalAmount)],
        ['TOTAL ENTRIES', String(totalCount)],
        ['AVG EXPENSE', rs(totalCount ? totalAmount / totalCount : 0)],
        ['THIS MONTH', rs(0)] // placeholder
    ];
    kpis.forEach(([label, value], i) => {
        const x = M + i * (cardW + gap);
        doc.setFillColor(234, 228, 224);
        doc.roundedRect(x + 0.7, cardY + 0.9, cardW, cardH, 3, 3, 'F');
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, cardY, cardW, cardH, 3, 3, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(150, 145, 140);
        doc.text(label, x + 5, cardY + 10, { charSpace: 0.3 });
        doc.setFontSize(12);
        doc.setTextColor(...ink);
        doc.text(value, x + 5, cardY + 21);
    });

    // Section label
    doc.setFillColor(...primary);
    doc.rect(M, 85, 3.5, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...ink);
    doc.text('EXPENSE DETAILS', M + 6, 89.5, { charSpace: 0.5 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 136, 130);
    doc.text(`${rows.length} entries`, pw - M, 89.5, { align: 'right' });

    const tableData = rows.map(e => [
        formatDate(e.date || e.createdAt) || '—',
        e.categoryName || '—',
        e.description || '—',
        rs(e.amount || 0),
        e.outletId || '—',
        (e.status || 'pending').toUpperCase()
    ]);

    doc.autoTable({
        head: [['Date', 'Category', 'Description', 'Amount', 'Outlet', 'Status']],
        body: tableData,
        foot: [['Grand Total', '', '', rs(totalAmount), '', '']],
        showFoot: 'lastPage',
        rowPageBreak: 'avoid',
        theme: 'grid',
        headStyles: { fillColor: ink, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, lineColor: ink, lineWidth: 0.2 },
        bodyStyles: {
            fontSize: 8, textColor: [30, 41, 59], lineColor: [236, 231, 227], lineWidth: 0.2, valign: 'middle',
            cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 }
        },
        alternateRowStyles: { fillColor: [255, 247, 243] },
        footStyles: { fillColor: ink, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, lineColor: ink, lineWidth: 0.2 },
        columnStyles: {
            0: { cellWidth: 26 },
            1: { cellWidth: 24 },
            2: { cellWidth: 48 },
            3: { cellWidth: 22, halign: 'right' },
            4: { cellWidth: 20 },
            5: { cellWidth: 16, halign: 'center' }
        },
        margin: { top: 26, left: M, right: M, bottom: 18 },
        startY: 96,
        didDrawPage: () => {
            if (doc.internal.getCurrentPageInfo().pageNumber === 1) return;
            doc.setFillColor(255, 249, 246);
            doc.rect(0, 0, pw, 22, 'F');
            doc.setFillColor(...primary);
            doc.rect(0, 0, pw, 2.6, 'F');
            doc.circle(M + 7, 13, 7, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text('FH', M + 7, 16.2, { align: 'center' });
            doc.setTextColor(...ink);
            doc.setFontSize(10);
            doc.text('Expense Report', M + 18, 12);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8.5);
            doc.setTextColor(...primary);
            doc.text(storeName, M + 18, 17.5);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(140, 136, 130);
            doc.text('Continued', pw - M, 14.5, { align: 'right' });
        },
    });

    // Footer post-pass
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setDrawColor(236, 231, 227);
        doc.setLineWidth(0.3);
        doc.line(M, ph - 14, pw - M, ph - 14);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 143, 138);
        doc.text(`Powered by FoodHubbie ERP  ·  ${storeName}`, M, ph - 9);
        doc.text(`Page ${p} of ${totalPages}`, pw - M, ph - 9, { align: 'right' });
    }

    doc.setProperties({
        title: `Expense Report - ${storeName}`,
        subject: 'Expense export',
        author: storeName,
        creator: 'FoodHubbie ERP'
    });

    doc.save(`Expenses_${new Date().toISOString().split('T')[0]}.pdf`);
}

export async function createExpenseModal() {
    // Placeholder for future modal implementation
    showToast('Add Expense modal - coming soon', 'info');
}

export async function initExpenses() {
    // Check if Expense feature is enabled
    const { state } = await import('../state.js');
    if (!state.features?.expense) {
        showToast('Expense feature is disabled. Enable it in Settings > Features.', 'info');
        return;
    }
    await loadExpenses();
}

export function openAddExpenseModal() {
    const modal = document.getElementById('expenseModal');
    if (!modal) return;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('expenseDate').value = today;
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseDescription').value = '';
    document.getElementById('expenseCategory').value = '';
    document.getElementById('expenseModalTitle').textContent = 'Add Expense';
    document.getElementById('expenseForm').dataset.editId = '';
    loadExpenseCategories();
    modal.classList.add('active', 'flex');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

export function closeExpenseModal() {
    const modal = document.getElementById('expenseModal');
    if (!modal) return;
    modal.classList.remove('active', 'flex');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
}

async function loadExpenseCategories() {
    const select = document.getElementById('expenseCategory');
    if (!select) return;
    
    // Use cached categories if fresh
    const now = Date.now();
    if (_categoryCache.length > 0 && (now - _categoryCacheAt) < CATEGORY_CACHE_TTL) {
        populateCategorySelect(select, _categoryCache);
        return;
    }
    
    try {
        const { Outlet, get } = await import('../firebase.js');
        const snap = await get(Outlet.ref('expenseCategories'));
        const categories = [];
        snap.forEach(c => {
            const cat = c.val();
            categories.push({ id: c.key, ...cat });
        });
        _categoryCache = categories;
        _categoryCacheAt = Date.now();
        populateCategorySelect(select, categories);
    } catch (e) {
        console.error('[Expenses] Failed to load categories:', e);
    }
}

function populateCategorySelect(select, categories) {
    select.innerHTML = '<option value="">Select Category...</option>';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name || cat.id;
        if (cat.color) opt.style.color = cat.color;
        select.appendChild(opt);
    });
}

export async function openExpenseCategoryModal() {
    const modal = document.getElementById('expenseCategoryModal');
    if (!modal) return;
    await renderExpenseCategoryList();
    modal.classList.add('active', 'flex');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

export function closeExpenseCategoryModal() {
    const modal = document.getElementById('expenseCategoryModal');
    if (!modal) return;
    modal.classList.remove('active', 'flex');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
}

async function renderExpenseCategoryList() {
    const list = document.getElementById('expenseCategoryList');
    if (!list) return;
    try {
        const { Outlet, get } = await import('../firebase.js');
        const snap = await get(Outlet.ref('expenseCategories'));
        list.innerHTML = '';
        snap.forEach(c => {
            const cat = c.val();
            const div = document.createElement('div');
            div.className = 'expense-category-item';
            div.innerHTML = `
                <div class="flex-row flex-center flex-gap-10">
                    <span style="color:${cat.color || '#E84908'}; font-size:1.2rem;">${cat.icon || '💰'}</span>
                    <span class="flex-1">${escapeHtml(cat.name || c.key)}</span>
                    ${cat.monthlyBudget ? `<span class="text-muted-small">Budget: ${fmtMoney(cat.monthlyBudget)}</span>` : ''}
                </div>
                <div class="flex-row flex-gap-6 mt-6">
                    <button type="button" class="btn-secondary btn-small" data-action="editExpenseCategory" data-id="${c.key}">Edit</button>
                    <button type="button" class="btn-danger btn-small" data-action="deleteExpenseCategory" data-id="${c.key}">Delete</button>
                </div>
            `;
            list.appendChild(div);
        });
    } catch (e) {
        console.error('[Expenses] Failed to render category list:', e);
    }
}

export async function addExpenseCategory() {
    const name = document.getElementById('expCatName')?.value?.trim();
    if (!name) { showToast('Category name required', 'error'); return; }
    const color = document.getElementById('expCatColor')?.value || '#E84908';
    const icon = document.getElementById('expCatIcon')?.value || 'dollar-sign';
    const budget = Number(document.getElementById('expCatBudget')?.value || 0);
    const alertPct = Number(document.getElementById('expCatAlert')?.value || 80);
    try {
        const { Outlet, push, set } = await import('../firebase.js');
        const ref = push(Outlet.ref('expenseCategories'));
        await set(ref, { name, color, icon, monthlyBudget: budget, alertThreshold: alertPct, isSystem: false, displayOrder: Date.now() });
        showToast('Category added', 'success');
        document.getElementById('expCatName').value = '';
        document.getElementById('expCatBudget').value = '';
        _categoryCache = []; _categoryCacheAt = 0; // Invalidate cache
        await renderExpenseCategoryList();
        await loadExpenseCategories();
    } catch (e) {
        console.error('[Expenses] Failed to add category:', e);
        showToast('Failed to add category', 'error');
    }
}

export async function initExpenseModals() {
    // Add Expense Form
    const form = document.getElementById('expenseForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const date = document.getElementById('expenseDate').value;
            const categoryId = document.getElementById('expenseCategory').value;
            const amount = Number(document.getElementById('expenseAmount').value);
            const description = document.getElementById('expenseDescription').value;
            const editId = form.dataset.editId;
            if (!date || !categoryId || !amount) { showToast('Fill required fields', 'error'); return; }

            // Expense ceiling check: if enabled, check if new expense + today's expenses exceed ceiling % of projected daily revenue
            try {
                const { Outlet, get } = await import('../firebase.js');
                const currentOutlet = window.currentOutlet || 'pizza';
                const settingsSnap = await get(Outlet.ref('settings/Expenses'));
                const expenseSettings = settingsSnap.exists() ? settingsSnap.val() : {};
                const ceilingPct = Number(expenseSettings?.expenseCeilingPct) || 0;
                
                if (ceilingPct > 0) {
                    // Calculate today's total expenses for this outlet - fetch fresh from server
                    const todayStr = new Date().toISOString().split('T')[0];
                    const { Outlet, get, query, orderByChild, equalTo } = await import('../firebase.js');
                    const expenseRef = Outlet.ref('expenses');
                    const todaySnap = await get(query(expenseRef, orderByChild('date'), equalTo(todayStr)));
                    let todayTotal = 0;
                    if (todaySnap.exists()) {
                        todaySnap.forEach(child => {
                            const val = child.val();
                            if (val && (val.outletId === currentOutlet || currentOutlet === 'all')) {
                                todayTotal += Number(val.amount || 0);
                            }
                        });
                    }
                    
                    // Get projected daily revenue from dineinSettings
                    const dineinSnap = await get(Outlet.ref('dineinSettings'));
                    const dineinSettings = dineinSnap.val() || {};
                    let projectedDailyRevenue = Number(dineinSettings.projectedDailyRevenue);
                    if (!projectedDailyRevenue || projectedDailyRevenue <= 0) {
                        showToast('Projected daily revenue not configured in Dine In settings. Ceiling check skipped.', 'warning');
                        return;
                    }
                    
                    const ceilingAmount = (projectedDailyRevenue * ceilingPct) / 100;
                    const projectedTotal = todayTotal + amount;
                    
                    if (projectedTotal > ceilingAmount) {
                        // Exceeds ceiling - require manager PIN
                        const { gateManagerPin } = await import('../utils.js');
                        const ok = await gateManagerPin({
                            message: `This expense (₹${amount.toLocaleString('en-IN')}) would bring today's total to ₹${projectedTotal.toLocaleString('en-IN')}, exceeding the ${ceilingPct}% ceiling (₹${ceilingAmount.toLocaleString('en-IN')}) of projected daily revenue (₹${projectedDailyRevenue.toLocaleString('en-IN')}). Manager approval required.`,
                            auditAction: 'expense.ceiling.approved',
                            auditDetails: {
                                expenseAmount: amount,
                                todayTotal: todayTotal,
                                projectedTotal: projectedTotal,
                                ceilingPct: ceilingPct,
                                ceilingAmount: ceilingAmount,
                                projectedRevenue: projectedDailyRevenue
                            }
                        });
                        if (!ok) return; // User cancelled or PIN failed
                    }
                }
            } catch (e) {
                console.warn('[Expenses] Ceiling check failed, failing open:', e);
            }

            try {
                const { Outlet, get, push, set, update } = await import('../firebase.js');
                const currentOutlet = window.currentOutlet || 'pizza';
                const catSnap = await get(Outlet.ref(`expenseCategories/${categoryId}`));
                const catName = catSnap.val()?.name || categoryId;
                if (editId) {
                    await update(Outlet.ref(`expenses/${editId}`), { date, categoryId, categoryName: catName, amount, description, editedAt: Date.now(), editedBy: (await import('../firebase.js')).auth.currentUser?.uid });
                    showToast('Expense updated', 'success');
                } else {
                    const ref = push(Outlet.ref('expenses'));
                    await set(ref, { date, categoryId, categoryName: catName, amount, description, outletId: currentOutlet, status: 'pending', createdAt: Date.now(), createdBy: (await import('../firebase.js')).auth.currentUser?.uid });
                    showToast('Expense logged', 'success');
                }
                closeExpenseModal();
                loadExpenses();
            } catch (e) {
                console.error('[Expenses] Save error:', e);
                showToast('Failed to save expense', 'error');
            }
        });
    }

    // Add Expense Category
    const addCatBtn = document.getElementById('btnAddExpenseCategory');
    if (addCatBtn) {
        addCatBtn.addEventListener('click', addExpenseCategory);
    }

    // Open Add Expense
    document.querySelectorAll('[data-action="openAddExpense"]').forEach(btn => {
        btn.addEventListener('click', openAddExpenseModal);
    });

    // Close Expense Modal
    document.querySelectorAll('[data-action="closeExpenseModal"]').forEach(btn => {
        btn.addEventListener('click', closeExpenseModal);
    });

    // Open Category Modal
    document.querySelectorAll('[data-action="openExpenseCategories"]').forEach(btn => {
        btn.addEventListener('click', openExpenseCategoryModal);
    });

    // Close Category Modal
    document.querySelectorAll('[data-action="closeExpenseCategoryModal"]').forEach(btn => {
        btn.addEventListener('click', closeExpenseCategoryModal);
    });

    // Edit/Delete Expense Category (event delegation)
    document.getElementById('expenseCategoryList')?.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('[data-action="editExpenseCategory"]');
        const delBtn = e.target.closest('[data-action="deleteExpenseCategory"]');
        if (editBtn) {
            const catId = editBtn.dataset.id;
            await editExpenseCategory(catId);
        } else if (delBtn) {
            const catId = delBtn.dataset.id;
            if (confirm('Delete this category? Expenses using it will be reassigned to "Misc".')) {
                await deleteExpenseCategory(catId);
            }
        }
    });

    // Edit/Delete Expense (event delegation on table)
    document.getElementById('expenseDataTableBody')?.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('[data-action="editExpense"]');
        const delBtn = e.target.closest('[data-action="deleteExpense"]');
        if (editBtn) {
            await editExpense(editBtn.dataset.id);
        } else if (delBtn) {
            if (confirm('Delete this expense?')) {
                await deleteExpense(delBtn.dataset.id);
            }
        }
    });
}

// Edit Expense Category
async function editExpenseCategory(catId) {
    try {
        const { Outlet, get, update } = await import('../firebase.js');
        const snap = await get(Outlet.ref(`expenseCategories/${catId}`));
        const cat = snap.val();
        if (!cat) { showToast('Category not found', 'error'); return; }

        document.getElementById('expCatName').value = cat.name || '';
        document.getElementById('expCatColor').value = cat.color || '#E84908';
        document.getElementById('expCatIcon').value = cat.icon || 'dollar-sign';
        document.getElementById('expCatBudget').value = cat.monthlyBudget || '';
        document.getElementById('expCatAlert').value = cat.alertThreshold || 80;
        document.getElementById('expCatBudget').dataset.editId = catId;

        // Change button text
        const btn = document.getElementById('btnAddExpenseCategory');
        btn.textContent = 'Update Category';
        btn.dataset.editId = catId;

        // Open modal
        await openExpenseCategoryModal();
    } catch (e) {
        console.error('[Expenses] Edit category error:', e);
        showToast('Failed to load category', 'error');
    }
}

async function deleteExpenseCategory(catId) {
    try {
        const { Outlet, get, update, runTransaction, query, orderByChild, startAt, endAt } = await import('../firebase.js');
        
        // Use transaction on the outlet root to atomically handle everything
        await runTransaction(dbRef(`businesses/${BUSINESS_ID()}/outlets/${Outlet.current}`), (currentData) => {
            const data = currentData.val() || {};
            const categories = data.expenseCategories || {};
            
            // Find or create Misc category
            let miscId = null;
            for (const [key, cat] of Object.entries(categories)) {
                if (cat.name === 'Misc') {
                    miscId = key;
                    break;
                }
            }
            if (!miscId) {
                const newKey = `misc_${Date.now()}`;
                categories[newKey] = { name: 'Misc', color: '#6B7280', icon: 'dollar-sign', isSystem: true, displayOrder: 999 };
                miscId = newKey;
            }
            
            // Reassign expenses to Misc category
            const expenses = data.expenses || {};
            for (const [key, exp] of Object.entries(expenses)) {
                if (exp.categoryId === catId) {
                    expenses[key] = { ...exp, categoryId: miscId, categoryName: 'Misc' };
                }
            }
            
            // Delete the category
            delete categories[catId];
            
            data.expenseCategories = categories;
            data.expenses = expenses;
            return data;
        });
        
        showToast('Category deleted, expenses reassigned to Misc', 'success');
        _categoryCache = []; _categoryCacheAt = 0; // Invalidate cache
        await renderExpenseCategoryList();
        await loadExpenseCategories();
    } catch (e) {
        console.error('[Expenses] Delete category error:', e);
        showToast('Failed to delete category', 'error');
    }
}

// Edit Expense
async function editExpense(expenseId) {
    try {
        const { Outlet, get } = await import('../firebase.js');
        const snap = await get(Outlet.ref(`expenses/${expenseId}`));
        const exp = snap.val();
        if (!exp) { showToast('Expense not found', 'error'); return; }

        document.getElementById('expenseDate').value = exp.date || '';
        document.getElementById('expenseCategory').value = exp.categoryId || '';
        document.getElementById('expenseAmount').value = exp.amount || '';
        document.getElementById('expenseDescription').value = exp.description || '';
        document.getElementById('expenseModalTitle').textContent = 'Edit Expense';
        document.getElementById('expenseForm').dataset.editId = expenseId;

        await loadExpenseCategories();
        openAddExpenseModal();
    } catch (e) {
        console.error('[Expenses] Edit expense error:', e);
        showToast('Failed to load expense', 'error');
    }
}

async function deleteExpense(expenseId) {
    try {
        const { Outlet, remove } = await import('../firebase.js');
        await remove(Outlet.ref(`expenses/${expenseId}`));
        showToast('Expense deleted', 'success');
        loadExpenses();
    } catch (e) {
        console.error('[Expenses] Delete expense error:', e);
        showToast('Failed to delete expense', 'error');
    }
}

export function cleanupExpenses() {
    _expenseData = [];
    _filteredData = [];
    _searchTerm = '';
    _sortField = 'date';
    _sortDir = 'desc';
    _categoryCache = [];
    _categoryCacheAt = 0;
    const table = document.getElementById('expenseDataTable');
    if (table) table.dataset.wired = '';
    const todayTable = document.getElementById('expenseTodayTable');
    if (todayTable) todayTable.dataset.wired = '';
    const historyTable = document.getElementById('expenseHistoryTable');
    if (historyTable) historyTable.dataset.wired = '';
    Object.values(_chartInstances).forEach(chart => chart.destroy?.());
    _chartInstances = {};
}