import { Outlet, serverTimestamp, get, set, push, query, orderByChild, equalTo, limitToLast } from '../firebase.js';
import { state } from '../state.js';
import { showToast, showConfirm, escapeHtml, logAudit } from '../utils.js';
import { t } from '../l10n.js';

const LOG_PATH = 'inventory-log';
const HISTORY_LIMIT = 20;
const MAX_IMPORT_ROWS = 500;
const CSV_HEADERS = ['name', 'sku', 'stock', 'threshold', 'unit', 'supplier', 'cost'];
const LOW_STOCK_DEBOUNCE_MS = 5 * 60 * 1000;

let _pendingImportRows = [];
const _notifiedLowStock = new Set();
const _notifyTimers = new Map();

/**
 * Fire a low-stock toast only on the crossing transition (prevStock > threshold && newStock <= threshold).
 * Debounced per item for LOW_STOCK_DEBOUNCE_MS.
 */
export function maybeNotifyLowStock({ itemId, itemName, prevStock, newStock, threshold }) {
    if (!itemId) return;
    const thresh = threshold || 0;
    if (newStock > thresh) {
        clearLowStockNotify(itemId);
        return;
    }
    if (prevStock <= thresh) return;
    if (_notifiedLowStock.has(itemId)) return;

    _notifiedLowStock.add(itemId);
    showToast(t('inv.lowStockToast', '📦 Low Stock: {name} ({stock})', { name: itemName, stock: newStock }), 'warning');
    logAudit('Inventory', `Low stock: ${itemName} at ${newStock} (threshold ${thresh})`);

    if (_notifyTimers.has(itemId)) clearTimeout(_notifyTimers.get(itemId));
    _notifyTimers.set(itemId, setTimeout(() => {
        _notifiedLowStock.delete(itemId);
        _notifyTimers.delete(itemId);
    }, LOW_STOCK_DEBOUNCE_MS));
}

export function clearLowStockNotify(itemId) {
    if (!itemId) return;
    _notifiedLowStock.delete(itemId);
    if (_notifyTimers.has(itemId)) {
        clearTimeout(_notifyTimers.get(itemId));
        _notifyTimers.delete(itemId);
    }
}

/**
 * Push a single log entry. Non-blocking; failures are logged but do not roll back the transaction.
 */
export async function pushLog({ itemId, delta, prevStock, newStock, user }) {
    if (!state.currentOutlet || !itemId) return;
    try {
        const ref = push(Outlet.ref(LOG_PATH));
        await set(ref, {
            itemId,
            delta,
            prevStock,
            newStock,
            user: user || 'unknown',
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.warn('[Inventory] pushLog failed', e);
    }
}

/**
 * Open the stock-history modal and load the last HISTORY_LIMIT entries for an item.
 */
export async function viewStockHistory(itemId, itemName) {
    closeHistoryModal();

    const overlay = document.createElement('div');
    overlay.className = 'dynamic-modal-overlay';
    overlay.id = 'stockHistoryOverlay';
    overlay.innerHTML = `
        <div class="dynamic-modal-box wide" role="dialog" aria-modal="true" aria-labelledby="shTitle">
            <h3 class="dynamic-modal-title" id="shTitle">📜 Stock History — ${escapeHtml(itemName || '')}</h3>
            <div id="stockHistoryBody" class="dynamic-modal-scroll">
                <div class="text-center p-20 text-muted">Loading history...</div>
            </div>
            <div class="dynamic-modal-actions">
                <button class="btn-confirm" data-action="closeStockHistory">Close</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.dataset.action === 'closeStockHistory') {
            closeHistoryModal();
        }
    });

    if (!state.currentOutlet) {
        overlay.querySelector('#stockHistoryBody').innerHTML = '<div class="text-center p-20 text-danger">No outlet selected.</div>';
        return;
    }

    try {
        const logRef = query(
            Outlet.ref(LOG_PATH),
            orderByChild('itemId'),
            equalTo(itemId),
            limitToLast(HISTORY_LIMIT)
        );
        const snap = await get(logRef);
        const entries = [];
        snap.forEach(child => entries.push({ id: child.key, ...child.val() }));
        entries.reverse();

        const body = overlay.querySelector('#stockHistoryBody');
        if (entries.length === 0) {
            body.innerHTML = '<div class="text-center p-20 text-muted">No history yet.</div>';
            return;
        }

        body.innerHTML = `
            <table class="premium-table-v4 compact">
                <thead>
                    <tr>
                        <th>When</th>
                        <th>Change</th>
                        <th>Stock</th>
                        <th>By</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.map(e => {
                        const sign = e.delta > 0 ? '+' : '';
                        const color = e.delta > 0 ? 'text-success' : (e.delta < 0 ? 'text-danger' : '');
                        return `<tr>
                            <td>${formatTimestamp(e.timestamp)}</td>
                            <td class="${color} font-700">${sign}${e.delta}</td>
                            <td>${e.prevStock} → ${e.newStock}</td>
                            <td>${escapeHtml(e.user || '—')}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
    } catch (e) {
        console.error('[Inventory] viewStockHistory failed', e);
        const body = overlay.querySelector('#stockHistoryBody');
        if (body) body.innerHTML = '<div class="text-center p-20 text-danger">Failed to load history.</div>';
    }
}

function closeHistoryModal() {
    document.getElementById('stockHistoryOverlay')?.remove();
}

function formatTimestamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString();
}

/**
 * Export current inventory as a CSV download.
 */
export async function exportInventoryCSV() {
    if (!state.currentOutlet) {
        showToast('No outlet selected', 'warning');
        return;
    }
    try {
        const snap = await get(Outlet.ref('inventory'));
        const data = snap.val() || {};
        const rows = [CSV_HEADERS.join(',')];
        Object.values(data).forEach(item => {
            rows.push(CSV_HEADERS.map(h => csvCell(item[h])).join(','));
        });
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `inventory-${date}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(t('inv.exported', '📦 Exported {n} items', { n: Object.keys(data).length }), 'success');
        logAudit('Inventory', `CSV export: ${Object.keys(data).length} items`);
    } catch (e) {
        console.error('[Inventory] CSV export failed', e);
        showToast(t('inv.exportFailed', '📦 Export failed'), 'error');
    }
}

function csvCell(value) {
    if (value === undefined || value === null) return '';
    const s = String(value);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * Trigger the hidden file input for CSV import.
 */
export function triggerInventoryImport() {
    document.getElementById('inventoryImportInput')?.click();
}

/**
 * Parse and preview a CSV file. Opens the import preview modal.
 */
export function handleInventoryImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = String(e.target.result || '');
        const parsed = parseCSV(text);
        if (parsed.error) {
            showToast(t('inv.importError', '📦 Import error: {msg}', { msg: parsed.error }), 'error');
            return;
        }
        _pendingImportRows = parsed.rows;
        showImportPreview(parsed.rows, parsed.skipped);
    };
    reader.onerror = () => showToast(t('inv.importReadError', '📦 Could not read file'), 'error');
    reader.readAsText(file);
}

function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return { error: 'CSV is empty or has no data rows' };
    const header = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const missing = CSV_HEADERS.filter(h => h !== 'name' && h !== 'stock' && h !== 'threshold' && !header.includes(h));
    if (!header.includes('name')) return { error: 'CSV must include a "name" column' };

    const rows = [];
    const skipped = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCSVLine(lines[i]);
        const row = {};
        header.forEach((h, idx) => { row[h] = cells[idx]; });
        const name = (row.name || '').trim();
        if (!name) {
            skipped.push({ line: i + 1, reason: 'Missing name' });
            continue;
        }
        rows.push({
            name,
            sku: (row.sku || '').trim(),
            stock: parseFloat(row.stock) || 0,
            threshold: parseFloat(row.threshold) || 5,
            unit: (row.unit || 'each').trim(),
            supplier: (row.supplier || '').trim(),
            cost: parseFloat(row.cost) || 0
        });
        if (rows.length >= MAX_IMPORT_ROWS) break;
    }
    if (rows.length === 0) return { error: 'No valid data rows found' };
    return { rows, skipped };
}

function splitCSVLine(line) {
    const cells = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') { inQ = false; }
            else { cur += c; }
        } else {
            if (c === ',') { cells.push(cur); cur = ''; }
            else if (c === '"') { inQ = true; }
            else { cur += c; }
        }
    }
    cells.push(cur);
    return cells;
}

function showImportPreview(rows, skipped) {
    closeImportPreview();

    const overlay = document.createElement('div');
    overlay.className = 'dynamic-modal-overlay';
    overlay.id = 'csvImportPreviewOverlay';
    overlay.innerHTML = `
        <div class="dynamic-modal-box wide" role="dialog" aria-modal="true" aria-labelledby="ipTitle">
            <h3 class="dynamic-modal-title" id="ipTitle">📥 Import Preview</h3>
            <p class="dynamic-modal-text">Ready to import <strong>${rows.length}</strong> item${rows.length === 1 ? '' : 's'}.${skipped.length ? ` Skipped ${skipped.length} invalid row(s).` : ''}</p>
            <div class="dynamic-modal-scroll">
                <table class="premium-table-v4 compact">
                    <thead>
                        <tr><th>Name</th><th>Stock</th><th>Threshold</th><th>SKU</th></tr>
                    </thead>
                    <tbody>
                        ${rows.slice(0, 50).map(r => `<tr>
                            <td>${escapeHtml(r.name)}</td>
                            <td>${r.stock}</td>
                            <td>${r.threshold}</td>
                            <td>${escapeHtml(r.sku || '—')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${rows.length > 50 ? `<p class="text-muted text-center p-10">…and ${rows.length - 50} more</p>` : ''}
                ${skipped.length ? `<details class="p-10"><summary>${skipped.length} skipped row(s)</summary><ul>${skipped.map(s => `<li>Line ${s.line}: ${s.reason}</li>`).join('')}</ul></details>` : ''}
            </div>
            <div class="dynamic-modal-actions">
                <button class="btn-cancel" data-action="cancelImport">Cancel</button>
                <button class="btn-confirm" data-action="confirmImport">Import ${rows.length} item${rows.length === 1 ? '' : 's'}</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeImportPreview();
        if (e.target.dataset.action === 'cancelImport') closeImportPreview();
        if (e.target.dataset.action === 'confirmImport') confirmInventoryImport();
    });
}

function closeImportPreview() {
    document.getElementById('csvImportPreviewOverlay')?.remove();
}

async function confirmInventoryImport() {
    const rows = _pendingImportRows;
    if (!rows || rows.length === 0) {
        closeImportPreview();
        return;
    }
    const overlay = document.getElementById('csvImportPreviewOverlay');
    const confirmBtn = overlay?.querySelector('[data-action="confirmImport"]');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Importing…';
    }

    try {
        const existingSnap = await get(Outlet.ref('inventory'));
        const existing = existingSnap.val() || {};
        const existingNames = new Set(Object.values(existing).map(v => (v.name || '').toLowerCase()));
        const existingSkus = new Set(Object.values(existing).map(v => (v.sku || '').toLowerCase()).filter(Boolean));

        let added = 0, skippedDup = 0;
        const batchSize = 25;
        for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            await Promise.all(batch.map(async (row) => {
                if (existingNames.has(row.name.toLowerCase())) { skippedDup++; return; }
                if (row.sku && existingSkus.has(row.sku.toLowerCase())) { skippedDup++; return; }
                const ref = push(Outlet.ref('inventory'));
                await set(ref, {
                    name: row.name,
                    sku: row.sku,
                    stock: row.stock,
                    threshold: row.threshold,
                    unit: row.unit,
                    supplier: row.supplier,
                    cost: row.cost,
                    updatedAt: serverTimestamp()
                });
                existingNames.add(row.name.toLowerCase());
                if (row.sku) existingSkus.add(row.sku.toLowerCase());
                added++;
            }));
        }

        showToast(t('inv.imported', '📦 Imported {n} items', { n: added }) + (skippedDup ? t('inv.importSkipped', ', skipped {n} duplicate(s)', { n: skippedDup }) : ''), 'success');
        logAudit('Inventory', `CSV import: ${added} added, ${skippedDup} skipped`);
        _pendingImportRows = [];
        closeImportPreview();
    } catch (e) {
        console.error('[Inventory] confirmInventoryImport failed', e);
        showToast(t('inv.importFailed', '📦 Import failed'), 'error');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Retry import';
        }
    }
}
