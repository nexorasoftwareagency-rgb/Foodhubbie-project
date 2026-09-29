import { Outlet, get, query, orderByChild, push, set, update, remove } from '../firebase.js';
import { escapeHtml, showToast, formatDate, getISTDateString } from '../utils.js';
import { loadJSPDF } from './printing.js';
import { logger } from '../utils/logger.js';

let _expenseData = [];
let _sortField = 'date', _sortDir = 'desc';
let _categoryCache = [];
let _categoryCacheAt = 0; // timestamp for TTL
const CATEGORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let _currentSubTab = 'today';
let _historyFilters = { from: '', to: '', category: '', status: '', search: '' };
let _catSearch = ''; // Categories sub-tab search — survives list re-renders
let _chartInstances = {};
let _currency = 'Rs.';
let _modalsWired = false;   // static elements — wire listeners exactly once
let _subTabsWired = false;

function fmtMoney(n) {
    const v = Number(n || 0);
    return _currency + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
}

function _sortExpenses(arr) {
    return [...arr].sort((a, b) => {
        let av = a[_sortField], bv = b[_sortField];
        if (_sortField === 'amount' || _sortField === 'date') {
            av = _sortField === 'date' ? String(av || '') : Number(av || 0);
            bv = _sortField === 'date' ? String(bv || '') : Number(bv || 0);
        } else {
            av = String(av || '').toLowerCase();
            bv = String(bv || '').toLowerCase();
        }
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return _sortDir === 'asc' ? cmp : -cmp;
    });
}

export function initExpenseTable() {
    [['expenseTodayTable', _renderTodayView], ['expenseHistoryTable', _renderHistoryView]].forEach(([id, rerender]) => {
        const table = document.getElementById(id);
        if (!table || table.dataset.wired) return;
        table.dataset.wired = '1';
        table.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (_sortField === field) {
                    _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    _sortField = field;
                    _sortDir = field === 'amount' || field === 'date' ? 'desc' : 'asc';
                }
                table.querySelectorAll('th[data-sort]').forEach(h => h.classList.remove('mob-sort-asc', 'mob-sort-desc'));
                th.classList.add(_sortDir === 'asc' ? 'mob-sort-asc' : 'mob-sort-desc');
                rerender();
            });
        });
    });
}


// Sub-tab state and switching
async function _switchExpenseSubTab(subTab) {
    _currentSubTab = subTab;
    document.querySelectorAll('.expense-subtab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.expenseSubtab === subTab);
    });
    document.querySelectorAll('.expense-subtab-content').forEach(div => {
        div.classList.toggle('hidden', div.id !== `expense-subtab-${subTab}`);
    });
    // Data exports only make sense on data views (Reports has its own exports)
    document.querySelector('[data-action="expExportExcel"]')?.closest('.mob-export-row')
        ?.classList.toggle('hidden', !['today', 'history'].includes(subTab));

    // Load sub-tab specific content
    try {
        switch (subTab) {
            case 'today': _renderTodayView(); break;
            case 'history': _renderHistoryView(); break;
            case 'categories': await _renderCategoriesView(); break;
            case 'reports': await _renderReportsView(); break;
            case 'settings': await _loadSettingsView(); break;
        }
    } catch (e) {
        console.error(`[Expenses] Render sub-tab "${subTab}" failed:`, e);
        showToast(`Failed to load ${subTab} view`, 'error');
    }
}

// Initialize sub-tab listeners (static elements — guarded, wire once)
export function initExpenseSubTabs() {
    if (_subTabsWired) return;
    _subTabsWired = true;
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

    // Categories sub-tab search (static input — wire once)
    const catSearchEl = document.getElementById('ecatSearch');
    if (catSearchEl) catSearchEl.addEventListener('input', () => { _catSearch = catSearchEl.value; renderExpenseCategoryList(); });

    // Default range: current month in IST (getISTDateString = YYYY-MM-DD)
    const todayIST = getISTDateString();
    if (fromEl && !fromEl.value) fromEl.value = todayIST.slice(0, 7) + '01';
    if (toEl && !toEl.value) toEl.value = todayIST;
    _historyFilters.from = fromEl?.value || '';
    _historyFilters.to = toEl?.value || '';
}

// ===== TODAY VIEW =====
function _renderTodayView() {
    const today = getISTDateString();
    const todayExpenses = _sortExpenses(_expenseData.filter(e => e.date === today));
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
            return `<span class="expense-category-chip" style="border-color:${escapeHtml(color)}; color:${escapeHtml(color)};" title="${escapeHtml(cat)}: ${fmtMoney(catTotal)}"><i data-lucide="${escapeHtml(icon)}" class="icon-12"></i> ${escapeHtml(cat)} <span class="chip-amount">${fmtMoney(catTotal)}</span></span>`;
        }).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: chipsContainer });
    }

    // Today table
    const tbody = document.getElementById('expenseTodayTableBody');
    if (!tbody) return;

    if (todayExpenses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="mob-table-empty">No expenses logged today <button type="button" class="btn-primary btn-small" data-action="openAddExpense" style="margin-left:8px;"><i data-lucide="plus" class="icon-14"></i> Add Expense</button></td></tr>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    tbody.innerHTML = todayExpenses.map(e => {
        const time = e.createdAt
            ? new Date(e.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
            : (formatDate(e.date) || '—');
        return `<tr>
            <td>${escapeHtml(time)}</td>
            <td>${escapeHtml(e.categoryName || '—')}</td>
            <td><span class="mob-addr-text" title="${escapeHtml(e.description || '—')}">${escapeHtml(e.description || '—')}</span></td>
            <td class="mob-th-right"><span class="mob-td-total">${fmtMoney(e.amount || 0)}</span></td>
            <td class="mob-th-center" style="white-space:nowrap;">
                ${_approvalActions(e)}
                <button type="button" class="btn-icon-only" data-action="editExpense" data-id="${e.id}" title="Edit" aria-label="Edit expense"><i data-lucide="edit-2" style="width:14px;height:14px;"></i></button>
                <button type="button" class="btn-icon-only btn-danger" data-action="deleteExpense" data-id="${e.id}" title="Delete" aria-label="Delete expense"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
            </td>
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

    data = _sortExpenses(data);

    // Category filter options come from the category cache (all categories, incl. unused)
    if (!_categoryCache.length || Date.now() - _categoryCacheAt >= CATEGORY_CACHE_TTL) {
        loadExpenseCategories().then(() => { if (_currentSubTab === 'history') _renderHistoryView(); });
    }
    const catSelect = document.getElementById('expenseHistoryCategory');
    if (catSelect) {
        const cur = catSelect.value;
        if (cur && !['', ..._categoryCache.map(c => c.name)].includes(cur)) _historyFilters.category = '';
        const names = ['All Categories', ..._categoryCache.map(c => c.name).filter(Boolean)];
        catSelect.innerHTML = names.map((n, i) => `<option value="${i ? escapeHtml(n) : ''}">${escapeHtml(n)}</option>`).join('');
        if ([...catSelect.options].some(o => o.value === _historyFilters.category)) catSelect.value = _historyFilters.category;
    }

    const tbody = document.getElementById('expenseHistoryTableBody');
    if (!tbody) return;

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="mob-table-empty">No expenses match your filters <button type="button" class="btn-secondary btn-small" data-action="clearExpenseFilters" style="margin-left:8px;">Clear filters</button></td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(e => {
        const st = e.status || 'pending';
        const statusBadge = st === 'approved'
            ? `<span class="mob-badge mob-badge-approved">Approved</span>`
            : st === 'pending'
                ? `<span class="mob-badge mob-badge-pending">Pending</span>`
                : `<span class="mob-badge mob-badge-rejected">Rejected</span>`;
        return `<tr>
            <td>${escapeHtml(formatDate(e.date || e.createdAt) || '—')}</td>
            <td>${escapeHtml(e.categoryName || '—')}</td>
            <td><span class="mob-addr-text" title="${escapeHtml(e.description || '—')}">${escapeHtml(e.description || '—')}</span></td>
            <td class="mob-th-right"><span class="mob-td-total">${fmtMoney(e.amount || 0)}</span></td>
            <td>${escapeHtml(e.outletId || '—')}</td>
            <td class="mob-th-center">${statusBadge}</td>
            <td class="mob-th-center" style="white-space:nowrap;">
                ${_approvalActions(e)}
                <button type="button" class="btn-icon-only" data-action="editExpense" data-id="${e.id}" title="Edit" aria-label="Edit expense"><i data-lucide="edit-2" style="width:14px;height:14px;"></i></button>
                <button type="button" class="btn-icon-only btn-danger" data-action="deleteExpense" data-id="${e.id}" title="Delete" aria-label="Delete expense"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
            </td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();

}
// ===== CATEGORIES VIEW (list ⇄ in-page form — no modal) =====
async function _renderCategoriesView() {
    const list = document.getElementById('expenseCategoryListInline');
    if (!list) return;
    // Entering the tab always lands on the list view (the form is a transient page state)
    document.getElementById('ecatFormView')?.classList.add('hidden');
    document.getElementById('ecatListView')?.classList.remove('hidden');
    const search = document.getElementById('ecatSearch');
    if (search && search.value !== _catSearch) search.value = _catSearch;
    // Warm the category cache (budgets on the cards) — same TTL pattern as Reports
    if (!_categoryCache.length || Date.now() - _categoryCacheAt >= CATEGORY_CACHE_TTL) {
        await loadExpenseCategories().catch(() => {});
    }
    await renderExpenseCategoryList();
}

// ===== REPORTS VIEW =====
async function _renderReportsView() {
    const { _loadChartJS } = await import('../utils.js');
    await _loadChartJS();

    // Budgets/colors need the category cache — warm it, then re-render once
    if (!_categoryCache.length || Date.now() - _categoryCacheAt >= CATEGORY_CACHE_TTL) {
        loadExpenseCategories().then(() => { if (_currentSubTab === 'reports') _renderReportsView(); });
    }

    // Report data (shared with Excel/PDF exports)
    const R = _buildReportData();

    // Monthly chart
    const monthlyCtx = document.getElementById('expenseMonthlyChart');
    if (monthlyCtx) {
        _destroyChart('monthly');
        _chartInstances.monthly = new Chart(monthlyCtx, {
            type: 'bar',
            data: { labels: R.monthlyRows.map(r => r.label), datasets: [
                { label: 'Actual', data: R.monthlyRows.map(r => r.total), backgroundColor: '#E84908' },
                { label: 'Budget', data: R.monthlyRows.map(r => r.budget), backgroundColor: '#3B82F6' }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
        });
    }

    // Monthly table
    const monthlyBody = document.getElementById('expenseMonthlyTableBody');
    if (monthlyBody) {
        monthlyBody.innerHTML = R.monthlyRows.map(r => {
            const varianceClass = r.variance > 0 ? 'text-error' : 'text-success';
            return `<tr><td>${r.label}</td><td class="mob-th-right">${fmtMoney(r.total)}</td><td class="mob-th-right">${fmtMoney(r.budget)}</td><td class="mob-th-right ${varianceClass}">${r.variance >= 0 ? '+' : ''}${fmtMoney(r.variance)}</td></tr>`;
        }).join('');
    }

    // Category breakdown chart — current month scope so Amount vs Budget is apples-to-apples
    const catCtx = document.getElementById('expenseCategoryChart');
    if (catCtx) {
        _destroyChart('category');
        _chartInstances.category = new Chart(catCtx, {
            type: 'doughnut',
            data: { labels: R.breakdownRows.map(r => r.cat), datasets: [{ data: R.breakdownRows.map(r => r.amount), backgroundColor: R.breakdownRows.map(r => _categoryCache.find(x => x.name === r.cat)?.color || '#E84908') }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
        });
    }

    const catBody = document.getElementById('expenseCategoryBreakdownBody');
    if (catBody) {
        catBody.innerHTML = R.breakdownRows.map(r => {
            const status = r.status === 'No budget'
                ? '<span class="text-muted-small">No budget</span>'
                : r.status === 'Over Budget'
                    ? '<span class="mob-badge mob-badge-rejected">Over Budget</span>'
                    : '<span class="mob-badge mob-badge-approved">On Track</span>';
            return `<tr><td>${escapeHtml(r.cat)}</td><td class="mob-th-right">${fmtMoney(r.amount)}</td><td class="mob-th-right">${r.pct}%</td><td class="mob-th-right">${fmtMoney(r.budget)}</td><td class="mob-th-center">${status}</td></tr>`;
        }).join('');
    }

    // Outlet comparison chart (if multi-outlet)
    const outletCtx = document.getElementById('expenseOutletChart');
    if (outletCtx) {
        _destroyChart('outlet');
        _chartInstances.outlet = new Chart(outletCtx, {
            type: 'bar',
            data: { labels: R.outletRows.map(r => r.outlet), datasets: [{ label: 'Total Spend', data: R.outletRows.map(r => r.total), backgroundColor: '#E84908' }] },
            options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y' }
        });
    }

    // Outlet comparison table (Total / This Month / Last Month)
    const outletBody = document.getElementById('expenseOutletTableBody');
    if (outletBody) {
        outletBody.innerHTML = R.outletRows.length === 0
            ? `<tr><td colspan="4" class="mob-table-empty">No expense data</td></tr>`
            : R.outletRows.map(r => `<tr><td>${escapeHtml(r.outlet)}</td><td class="mob-th-right">${fmtMoney(r.total)}</td><td class="mob-th-right">${fmtMoney(r.thisMonth)}</td><td class="mob-th-right">${fmtMoney(r.lastMonth)}</td></tr>`).join('');
    }

    // Trend chart
    const trendCtx = document.getElementById('expenseTrendChart');
    if (trendCtx) {
        _destroyChart('trend');
        _chartInstances.trend = new Chart(trendCtx, {
            type: 'line',
            data: { labels: R.trendRows.map(r => r.date.split('-').slice(1).join('-')), datasets: [{ label: 'Daily Spend', data: R.trendRows.map(r => r.total), borderColor: '#E84908', fill: false, tension: 0.3 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
}

// Pure computation shared by the Reports view and report exports — no DOM access
function _buildReportData() {
    const currentOutlet = window.currentOutlet || 'pizza';
    const expenses = _expenseData.filter(e => e.outletId === currentOutlet || currentOutlet === 'all');
    const budgetTotal = _categoryCache.reduce((s, c) => s + (c.monthlyBudget || 0), 0);

    const monthly = {};
    expenses.forEach(e => {
        const month = e.date?.substring(0, 7) || 'Unknown';
        if (!monthly[month]) monthly[month] = { total: 0, count: 0 };
        monthly[month].total += Number(e.amount || 0);
        monthly[month].count++;
    });
    const monthlyRows = Object.keys(monthly).sort().map(m => {
        const [y, mo] = m.split('-');
        const total = monthly[m].total;
        return {
            month: m,
            label: new Date(y, mo - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
            total,
            budget: budgetTotal,
            variance: total - budgetTotal
        };
    });

    // Category breakdown — current month scope so Amount vs Budget is apples-to-apples
    const monthKey = getISTDateString().slice(0, 7);
    const catTotals = {};
    let totalAll = 0;
    expenses.forEach(e => {
        if (!(e.date || '').startsWith(monthKey)) return;
        const cat = e.categoryName || 'Other';
        catTotals[cat] = (catTotals[cat] || 0) + Number(e.amount || 0);
        totalAll += Number(e.amount || 0);
    });
    const breakdownRows = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]).map(c => {
        const catDef = _categoryCache.find(x => x.name === c);
        const budget = catDef?.monthlyBudget || 0;
        const amount = catTotals[c];
        return {
            cat: c,
            amount,
            pct: totalAll ? ((amount / totalAll) * 100).toFixed(1) : '0.0',
            budget,
            status: !budget ? 'No budget' : amount > budget ? 'Over Budget' : 'On Track'
        };
    });

    const thisYm = getISTDateString().slice(0, 7);
    const lastMonthDate = new Date();
    lastMonthDate.setDate(1);
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastYm = getISTDateString(lastMonthDate).slice(0, 7);
    const outletRows = [...new Set(expenses.map(e => e.outletId))].filter(Boolean).map(o => {
        const mine = expenses.filter(e => e.outletId === o);
        return {
            outlet: o,
            total: mine.reduce((s, e) => s + Number(e.amount || 0), 0),
            thisMonth: mine.filter(e => (e.date || '').startsWith(thisYm)).reduce((s, e) => s + Number(e.amount || 0), 0),
            lastMonth: mine.filter(e => (e.date || '').startsWith(lastYm)).reduce((s, e) => s + Number(e.amount || 0), 0)
        };
    });

    const trendRows = [...new Set(expenses.map(e => e.date))].sort().map(d => ({
        date: d,
        total: expenses.filter(e => e.date === d).reduce((s, e) => s + Number(e.amount || 0), 0)
    }));

    return { monthlyRows, breakdownRows, outletRows, trendRows, monthKey };
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
        const s = snap.exists() ? snap.val() : {};
        document.getElementById('expenseAutoApproveThreshold').value = s.autoApproveThreshold ?? 5000;
        document.getElementById('expenseCeilingPct').value = s.expenseCeilingPct ?? 10;
        const cur = document.getElementById('expenseCurrencyDisplay');
        if (cur) cur.value = s.currencyDisplay || 'Rs.';
        _currency = s.currencyDisplay || 'Rs.';
    } catch (e) {
        console.error('[Expenses] Load settings error:', e);
    }
}

export async function saveExpenseSettings() {
    try {
        const { Outlet, set } = await import('../firebase.js');
        const thresholdRaw = document.getElementById('expenseAutoApproveThreshold').value;
        const ceilingRaw = document.getElementById('expenseCeilingPct').value;
        const currencyEl = document.getElementById('expenseCurrencyDisplay');
        const settings = {
            autoApproveThreshold: thresholdRaw === '' ? 5000 : Number(thresholdRaw),
            expenseCeilingPct: ceilingRaw === '' ? 10 : Number(ceilingRaw),
            updatedAt: Date.now(),
            updatedBy: (await import('../firebase.js')).auth.currentUser?.uid
        };
        if (currencyEl) settings.currencyDisplay = currencyEl.value;
        await set(Outlet.ref('settings/Expenses'), settings);
        if (currencyEl) _currency = currencyEl.value;
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
        // Loading row only when the table is empty (don't flash over existing data on reload)
        const lt = document.getElementById('expenseTodayTableBody');
        if (lt && !lt.children.length) lt.innerHTML = '<tr><td colspan="5" class="mob-table-empty">Loading\u2026</td></tr>';
        const lh = document.getElementById('expenseHistoryTableBody');
        if (lh && !lh.children.length) lh.innerHTML = '<tr><td colspan="7" class="mob-table-empty">Loading\u2026</td></tr>';
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

        // Wire sort headers + sub-tabs (both guarded — once per session)
        initExpenseTable();
        initExpenseSubTabs();
        // Currency for fmtMoney — otherwise Today/History/Reports show default until Settings visited
        try { _currency = ((await get(Outlet.ref('settings/Expenses'))).val() || {}).currencyDisplay || 'Rs.'; } catch (_) {}
        // Re-render the sub-tab the user is actually on (don't bounce to Today after save)
        _switchExpenseSubTab(_currentSubTab);
    } catch (e) {
        console.error('[Expenses] Load error:', e);
        showToast('Failed to load expenses', 'error');
    }
}

export function downloadExpenseExcel() {
    if (_expenseData.length === 0) { showToast('No expense data to export.', 'info'); return; }
    showToast('Generating Excel...', 'info');

    const data = _expenseData.map(e => ({
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
            XLSX.writeFile(wb, `Expenses_${getISTDateString()}.xlsx`);
        }, 50);
    } else {
        showToast('Excel library not loaded.', 'error');
    }
}

export async function downloadExpensePDF() {
    await loadJSPDF();
    if (_expenseData.length === 0) { showToast('No expense data to export.', 'warning'); return; }
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
    const rs = n => _currency + Math.round(Number(n || 0)).toLocaleString('en-IN');
    const mix = (a, b, t) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return a;
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
};

    const rows = _expenseData;
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

    doc.save(`Expenses_${getISTDateString()}.pdf`);
}

export function downloadReportExcel() {
    const d = _buildReportData();
    if (!d.monthlyRows.length && !d.breakdownRows.length) { showToast('No expense data to export.', 'info'); return; }
    if (typeof XLSX === 'undefined') { showToast('Excel library not loaded.', 'error'); return; }
    showToast('Generating report...', 'info');
    setTimeout(() => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.monthlyRows.map(r => ({ Month: r.label, Total: r.total, Budget: r.budget, Variance: r.variance }))), 'Monthly Summary');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.breakdownRows.map(r => ({ Category: r.cat, Amount: r.amount, 'Percent': r.pct, Budget: r.budget, Status: r.status }))), 'Category Breakdown');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.outletRows.map(r => ({ Outlet: r.outlet, Total: r.total, 'This Month': r.thisMonth, 'Last Month': r.lastMonth }))), 'Outlet Comparison');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.trendRows.map(r => ({ Date: r.date, Total: r.total }))), 'Daily Trend');
        XLSX.writeFile(wb, `ExpenseReport_${getISTDateString()}.xlsx`);
    }, 50);
}

export async function downloadReportPDF() {
    await loadJSPDF();
    const d = _buildReportData();
    if (!d.monthlyRows.length && !d.breakdownRows.length) { showToast('No expense data to export.', 'info'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    if (typeof doc.autoTable !== 'function') { showToast('PDF table plugin not ready.', 'error'); return; }

    showToast('Generating report...', 'info');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Expense Report', 14, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Outlet: ${window.currentOutlet || 'pizza'}   |   Generated: ${getISTDateString()}`, 14, 22);

    let y = 30;
    const section = (title, head, rows) => {
        if (!rows.length) return;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text(title, 14, y);
        doc.autoTable({
            startY: y + 3,
            head: [head],
            body: rows,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [232, 73, 8] }
        });
        y = doc.lastAutoTable.finalY + 10;
    };
    section('Monthly Summary', ['Month', 'Total', 'Budget', 'Variance'],
        d.monthlyRows.map(r => [r.label, fmtMoney(r.total), fmtMoney(r.budget), (r.variance >= 0 ? '+' : '') + fmtMoney(r.variance)]));
    section(`Category Breakdown (${d.monthKey})`, ['Category', 'Amount', '% of Total', 'Budget', 'Status'],
        d.breakdownRows.map(r => [r.cat, fmtMoney(r.amount), r.pct + '%', fmtMoney(r.budget), r.status]));
    section('Outlet Comparison', ['Outlet', 'Total', 'This Month', 'Last Month'],
        d.outletRows.map(r => [r.outlet, fmtMoney(r.total), fmtMoney(r.thisMonth), fmtMoney(r.lastMonth)]));
    section('Daily Trend', ['Date', 'Total'],
        d.trendRows.map(r => [r.date, fmtMoney(r.total)]));
    doc.save(`ExpenseReport_${getISTDateString()}.pdf`);
}

// Pending-only Approve/Reject (manager PIN via shared gate; feature off = direct action)
function _approvalActions(e) {
    if (e.status !== 'pending') return '';
    return `<button type="button" class="btn-icon-only" style="color:#10B981" data-action="approveExpense" data-id="${e.id}" title="Approve" aria-label="Approve expense"><i data-lucide="check" style="width:14px;height:14px;"></i></button>
                <button type="button" class="btn-icon-only btn-danger" data-action="rejectExpense" data-id="${e.id}" title="Reject" aria-label="Reject expense"><i data-lucide="x" style="width:14px;height:14px;"></i></button>`;
}

async function _setExpenseStatus(id, status, toastMsg, auditAction) {
    const { gateManagerPin } = await import('../utils.js');
    const verb = status === 'approved' ? 'approve' : 'reject';
    const ok = await gateManagerPin({ message: `Manager approval required to ${verb} this expense.`, auditAction, auditDetails: { expenseId: id, status } });
    if (!ok) return;
    try {
        const { Outlet, update, auth } = await import('../firebase.js');
        await update(Outlet.ref(`expenses/${id}`), { status, statusAt: Date.now(), statusBy: auth.currentUser?.uid });
        showToast(toastMsg, 'success');
        loadExpenses();
    } catch (e) {
        console.error(`[Expenses] Status change error:`, e);
        showToast(`Failed to ${verb} expense`, 'error');
    }
}

export async function approveExpense(id) {
    await _setExpenseStatus(id, 'approved', 'Expense approved', 'expense.approved');
}

export async function rejectExpense(id) {
    await _setExpenseStatus(id, 'rejected', 'Expense rejected', 'expense.rejected');
}

export function clearExpenseHistoryFilters() {
    _historyFilters = { from: '', to: '', category: '', status: '', search: '' };
    ['expenseHistoryFrom', 'expenseHistoryTo', 'expenseHistoryCategory', 'expenseHistoryStatus', 'expenseHistorySearch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    _renderHistoryView();
}

export async function openAddExpenseModal() {
    const modal = document.getElementById('expenseModal');
    if (!modal) return;
    document.getElementById('expenseDate').value = getISTDateString();
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseDescription').value = '';
    document.getElementById('expenseCategory').value = '';
    document.getElementById('expenseModalTitle').textContent = 'Add Expense';
    document.getElementById('expenseForm').dataset.editId = '';
    await loadExpenseCategories(); // awaited so callers can set field values after this
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

// In-page Add/Edit form: swap list ⇄ form view (replaces the old modal flow)
function _resetCategoryForm() {
    const btn = document.getElementById('btnAddExpenseCategory');
    if (btn) { btn.textContent = 'Add Category'; delete btn.dataset.editId; }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('expCatName', '');
    set('expCatBudget', '');
    set('expCatColor', '#E84908');
    set('expCatIcon', 'zap');
    set('expCatAlert', '80');
    const heading = document.getElementById('expCatFormHeading');
    if (heading) heading.textContent = 'Add Category';
}

export function openExpenseCategoryForm() {
    // Always start clean — a cancelled/abandoned edit must never leak into a new Add
    _resetCategoryForm();
    document.getElementById('ecatListView')?.classList.add('hidden');
    document.getElementById('ecatFormView')?.classList.remove('hidden');
    document.getElementById('expCatName')?.focus();
}

export function closeExpenseCategoryForm() {
    _resetCategoryForm();
    document.getElementById('ecatFormView')?.classList.add('hidden');
    document.getElementById('ecatListView')?.classList.remove('hidden');
}

// Renders the Categories sub-tab card grid (budget usage from _expenseData + _categoryCache)
async function renderExpenseCategoryList() {
    const grid = document.getElementById('expenseCategoryListInline');
    if (!grid) return;
    try {
        const { Outlet, get } = await import('../firebase.js');
        const snap = await get(Outlet.ref('expenseCategories'));
        const cats = [];
        // ponytail: CDN firebase forEach aborts on truthy callback return (push returns length) — block body, no return
        snap.forEach(c => { cats.push({ id: c.key, ...(c.val() || {}) }); });
        cats.sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999) || String(a.name || '').localeCompare(String(b.name || '')));

        // Month-to-date spend per category name (_expenseData is already outlet-scoped by loadExpenses)
        const monthKey = getISTDateString().slice(0, 7);
        const spend = {};
        _expenseData.forEach(e => {
            if ((e.date || '').startsWith(monthKey)) {
                const k = e.categoryName || 'Other';
                spend[k] = (spend[k] || 0) + Number(e.amount || 0);
            }
        });

        const q = _catSearch.trim().toLowerCase();
        const shown = q ? cats.filter(c => String(c.name || '').toLowerCase().includes(q)) : cats;

        grid.innerHTML = shown.map(c => {
            const color = /^#[0-9A-Fa-f]{6}$/.test(c.color || '') ? c.color : '#E84908';
            const icon = c.icon || 'dollar-sign';
            // lucide names are ASCII; anything else (emoji) renders as text
            const iconHtml = /^[\w-]+$/.test(icon)
                ? `<i data-lucide="${escapeHtml(icon)}"></i>`
                : `<span>${escapeHtml(icon)}</span>`;
            const budget = Number(c.monthlyBudget || 0);
            const used = spend[c.name] || 0;
            const pct = budget ? Math.min(100, Math.round((used / budget) * 100)) : 0;
            const over = budget > 0 && used > budget;
            const warn = budget > 0 && !over && pct >= Number(c.alertThreshold || 80);
            const barColor = over ? '#EF4444' : warn ? '#F59E0B' : color;
            const usage = budget
                ? `<div class="ecat-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
                       <span class="ecat-bar-fill" style="width:${pct}%;background:${barColor}"></span>
                   </div>
                   <div class="ecat-spend-row"><span${over ? ' class="ecat-over"' : ''}>${over ? 'Over by ' + fmtMoney(used - budget) : fmtMoney(used) + ' spent'}</span><span>of ${fmtMoney(budget)}/mo</span></div>`
                : `<div class="ecat-spend-row"><span class="ecat-muted">No budget set</span><span class="ecat-muted">${fmtMoney(used)} this month</span></div>`;
            return `
                <div class="ecat-card" data-cat-id="${c.id}">
                    <div class="ecat-card-top">
                        <span class="ecat-icon" style="background:${color}1F;color:${color}">${iconHtml}</span>
                        <span class="ecat-name">${escapeHtml(c.name || c.id)}</span>
                        ${c.isSystem ? '<span class="ecat-sys" title="System category">System</span>' : ''}
                    </div>
                    ${usage}
                    <div class="ecat-actions">
                        <button type="button" class="btn-secondary btn-small" data-action="editExpenseCategory" data-id="${c.id}">Edit</button>
                        <button type="button" class="btn-danger btn-small" data-action="deleteExpenseCategory" data-id="${c.id}">Delete</button>
                    </div>
                </div>`;
        }).join('');

        // Count + empty states (no categories at all vs no search match)
        const countEl = document.getElementById('ecatCount');
        if (countEl) countEl.textContent = shown.length === cats.length ? `${cats.length} categories` : `${shown.length} of ${cats.length}`;
        const emptyEl = document.getElementById('ecatEmpty');
        const emptyText = document.getElementById('ecatEmptyText');
        if (emptyEl) {
            const noneAtAll = cats.length === 0;
            emptyEl.classList.toggle('hidden', shown.length > 0);
            if (emptyText) emptyText.textContent = noneAtAll ? 'No categories yet — create your first one.' : `No categories match "${_catSearch.trim()}"`;
            if (!emptyEl.classList.contains('hidden') && typeof lucide !== 'undefined') lucide.createIcons({ root: emptyEl });
        }
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: grid });
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
    const btn = document.getElementById('btnAddExpenseCategory');
    const editId = btn?.dataset.editId;
    try {
        const { Outlet, push, set, update } = await import('../firebase.js');
        if (editId) {
            await update(Outlet.ref(`expenseCategories/${editId}`), { name, color, icon, monthlyBudget: budget, alertThreshold: alertPct });
            showToast('Category updated', 'success');
        } else {
            const ref = push(Outlet.ref('expenseCategories'));
            await set(ref, { name, color, icon, monthlyBudget: budget, alertThreshold: alertPct, isSystem: false, displayOrder: Date.now() });
            showToast('Category added', 'success');
        }
        _categoryCacheAt = 0; // Force refill on next loadExpenseCategories call
        closeExpenseCategoryForm(); // back to list view (also resets edit state + fields)
        await renderExpenseCategoryList();
        await loadExpenseCategories();
    } catch (e) {
        console.error('[Expenses] Failed to add category:', e);
        showToast('Failed to add category', 'error');
    }
}

export function initExpenseModals() {
    // Static DOM — wire listeners exactly once (re-binding on every tab visit stacked duplicate submits)
    if (_modalsWired) return;
    _modalsWired = true;

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

            // Settings for ceiling + auto-approve (fail-open on read errors)
            let expenseSettings = {};
            try {
                const { Outlet, get } = await import('../firebase.js');
                const settingsSnap = await get(Outlet.ref('settings/Expenses'));
                expenseSettings = settingsSnap.exists() ? settingsSnap.val() : {};
            } catch (e) {
                console.warn('[Expenses] Settings unreadable, failing open:', e);
            }

            // Expense ceiling check: % of projected daily revenue
            // Uses RTDB transaction for atomic read+write to prevent race conditions
            try {
                const ceilingPct = Number(expenseSettings?.expenseCeilingPct) || 0;
                if (ceilingPct > 0) {
                    const currentOutlet = window.currentOutlet || 'pizza';
                    const { Outlet, get, query, orderByChild, equalTo, ref, runTransaction } = await import('../firebase.js');
                    const todayStr = getISTDateString();
                    const todaySnap = await get(query(Outlet.ref('expenses'), orderByChild('date'), equalTo(todayStr)));
                    let todayTotal = 0;
                    if (todaySnap.exists()) {
                        todaySnap.forEach(child => {
                            const val = child.val();
                            if (val && (val.outletId === currentOutlet || currentOutlet === 'all')) {
                                // When editing, exclude the old amount of the expense being modified
                                if (!editId || child.key !== editId) {
                                    todayTotal += Number(val.amount || 0);
                                }
                            }
                        });
                    }

                    const dineinSnap = await get(Outlet.ref('dineinSettings'));
                    const projectedDailyRevenue = Number((dineinSnap.val() || {}).projectedDailyRevenue);
                    if (!projectedDailyRevenue || projectedDailyRevenue <= 0) {
                        // Config missing: warn and fall through — never silently discard the entry
                        showToast('Projected daily revenue not configured in Dine In settings. Ceiling check skipped.', 'warning');
                    } else {
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
                    // Auto-approve at/below threshold (settings help text), else pending
                    const threshold = Number(expenseSettings?.autoApproveThreshold);
                    const status = amount <= (Number.isFinite(threshold) ? threshold : 5000) ? 'approved' : 'pending';
                    const ref = push(Outlet.ref('expenses'));
                    await set(ref, { date, categoryId, categoryName: catName, amount, description, outletId: currentOutlet, status, createdAt: Date.now(), createdBy: (await import('../firebase.js')).auth.currentUser?.uid });
                    showToast(status === 'approved' ? 'Expense logged & auto-approved' : 'Expense logged', 'success');
                }
                closeExpenseModal();
                loadExpenses();
            } catch (e) {
                console.error('[Expenses] Save error:', e);
                showToast('Failed to save expense', 'error');
            }
        });
    }

    // Add Expense Category (no data-action on this button — bind directly)
    document.getElementById('btnAddExpenseCategory')?.addEventListener('click', addExpenseCategory);
    // Everything else (open/close modals, edit/delete rows & categories) routes through
    // main.js's global [data-action] dispatcher — single wiring, keyboard Enter included.
}

// Edit Expense Category
export async function editExpenseCategory(catId) {
    try {
        const { Outlet, get, update } = await import('../firebase.js');
        const snap = await get(Outlet.ref(`expenseCategories/${catId}`));
        const cat = snap.val();
        if (!cat) { showToast('Category not found', 'error'); return; }

        // Open FIRST (it resets the form), then populate — order matters since open() clears fields
        openExpenseCategoryForm();

        document.getElementById('expCatName').value = cat.name || '';
        document.getElementById('expCatColor').value = cat.color || '#E84908';
        document.getElementById('expCatIcon').value = cat.icon || 'dollar-sign';
        document.getElementById('expCatBudget').value = cat.monthlyBudget || '';
        document.getElementById('expCatAlert').value = cat.alertThreshold || 80;

        // Relabel heading + submit for edit mode
        const btn = document.getElementById('btnAddExpenseCategory');
        btn.textContent = 'Update Category';
        btn.dataset.editId = catId;
        const heading = document.getElementById('expCatFormHeading');
        if (heading) heading.textContent = 'Edit Category';
    } catch (e) {
        console.error('[Expenses] Edit category error:', e);
        showToast('Failed to load category', 'error');
    }
}

export async function deleteExpenseCategory(catId) {
    if (!confirm('Delete this category? Expenses using it will be reassigned to "Misc".')) return;
    try {
        const { Outlet, get, push, set } = await import('../firebase.js');

        // Targeted multi-path update: only the category + expenses referencing it
        // (a transaction on the outlet root would rewrite orders/menu/sessions too)
        const [catSnap, expSnap] = await Promise.all([
            get(Outlet.ref('expenseCategories')),
            get(Outlet.ref('expenses'))
        ]);
        const cats = catSnap.val() || {};
        let miscId = Object.keys(cats).find(k => cats[k]?.name === 'Misc');
        const updates = {};
        if (!miscId) {
            miscId = push(Outlet.ref('expenseCategories')).key;
            updates[`expenseCategories/${miscId}`] = { 
                name: 'Misc', 
                color: '#6B7280', 
                icon: 'dollar-sign', 
                monthlyBudget: 2000, 
                alertThreshold: 80, 
                isSystem: true, 
                displayOrder: 999 
            };
        }
        updates[`expenseCategories/${catId}`] = null;
        const exps = expSnap.val() || {};
        for (const [key, exp] of Object.entries(exps)) {
            if (exp && exp.categoryId === catId) {
                updates[`expenses/${key}/categoryId`] = miscId;
                updates[`expenses/${key}/categoryName`] = 'Misc';
            }
        }
        await Outlet.multiUpdate(updates);

        showToast('Category deleted, expenses reassigned to Misc', 'success');
        _categoryCacheAt = 0; // Force refill on next loadExpenseCategories call
        await renderExpenseCategoryList();
        await loadExpenseCategories();
    } catch (e) {
        console.error('[Expenses] Delete category error:', e);
        showToast('Failed to delete category', 'error');
    }
}

// Edit Expense
export async function editExpense(expenseId) {
    try {
        const { Outlet, get } = await import('../firebase.js');
        const snap = await get(Outlet.ref(`expenses/${expenseId}`));
        const exp = snap.val();
        if (!exp) { showToast('Expense not found', 'error'); return; }

        // Open first (it resets the form and loads category options), then populate
        await openAddExpenseModal();
        document.getElementById('expenseDate').value = exp.date || '';
        document.getElementById('expenseCategory').value = exp.categoryId || '';
        document.getElementById('expenseAmount').value = exp.amount || '';
        document.getElementById('expenseDescription').value = exp.description || '';
        document.getElementById('expenseModalTitle').textContent = 'Edit Expense';
        document.getElementById('expenseForm').dataset.editId = expenseId;
    } catch (e) {
        console.error('[Expenses] Edit expense error:', e);
        showToast('Failed to load expense', 'error');
    }
}

export async function deleteExpense(expenseId) {
    if (!confirm('Delete this expense?')) return;
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
    _sortField = 'date';
    _sortDir = 'desc';
    _categoryCacheAt = 0; // Force refill on next loadExpenseCategories call
    // NOTE: wired flags intentionally NOT reset — sort-header/sub-tab/modal listeners are
    // bound once to static elements; clearing them stacked duplicate listeners per revisit.
    Object.values(_chartInstances).forEach(chart => chart.destroy?.());
    _chartInstances = {};
}