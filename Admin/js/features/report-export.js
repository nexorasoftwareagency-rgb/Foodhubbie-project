/**
 * FoodHubbie ERP | REPORT EXPORT RENDERER  (Admin/js/features/report-export.js)
 * ============================================================================
 * Phase 5 (OrderRestro port §4): ONE renderReport(result, format, meta) entry
 * that turns a ReportResult { columns, rows, colTypes } into csv | xlsx | pdf.
 * The UI never knows the difference — the runner's CSV/Excel/Print buttons and
 * the Revenue analytics Excel export all funnel through here.
 *
 * - csv: RFC-4180 via shared/report-export.js (BOM + spreadsheet-injection guard)
 * - xlsx: ExcelJS (lazy CDN) — styled title/subtitle/header, brand fill, frozen
 *   panes at row 4, auto-fit widths, money numFmt. SheetJS can't style, so the
 *   spec's brand header needs exceljs; Admin/js/xlsx.js stays untouched.
 * - pdf: styled print view filled into #reportPrintArea → window.print().
 *   Landscape @page is injected only while printing, and only for wide tables.
 */

import { guardSpreadsheetCell, toCsvMatrix, autoWidths, needsLandscape } from '../../shared/report-export.js';

const EXCELJS_CDN = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const BRAND_ARGB = 'FFE84908';           // Foodhubbie primary #E84908
const GREY_ARGB = 'FF666666';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let _exceljsPending = null;

/** Lazy-load ExcelJS once; resolves window.ExcelJS (same pattern as xlsx.js). */
export function ensureExcelJS() {
    if (typeof window.ExcelJS !== 'undefined') return Promise.resolve(window.ExcelJS);
    if (_exceljsPending) return _exceljsPending;
    _exceljsPending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = EXCELJS_CDN;
        script.crossOrigin = 'anonymous';
        script.onload = () => {
            if (window.ExcelJS) resolve(window.ExcelJS);
            else { _exceljsPending = null; reject(new Error('Excel library did not initialise')); }
        };
        script.onerror = () => {
            _exceljsPending = null;
            reject(new Error('Excel library failed to load — check your connection'));
        };
        document.head.appendChild(script);
    });
    return _exceljsPending;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function _download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// Excel sheet names: max 31 chars, no : \ / ? * [ ]
const _sheetName = (title) => (String(title || 'Report').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31)) || 'Report';

function _subtitle(result, meta) {
    if (meta.subtitle != null) return meta.subtitle;
    const range = (meta.from || meta.to) ? `${meta.from || '…'} \u2192 ${meta.to || '…'}` : '';
    return `${result.rows.length} rows${range ? ' \u00B7 ' + range : ''}`;
}

/** The one entry point. result = { columns, rows, colTypes }; meta = { key, title, from, to, subtitle? }. */
export async function renderReport(result, format, meta) {
    const m = meta || {};
    if (format === 'csv') return _csv(result, m);
    if (format === 'xlsx') return _xlsx(result, m);
    if (format === 'pdf') return _pdf(result, m);
    throw new Error(`Unknown report format: ${format}`);
}

function _csv(result, meta) {
    // BOM so Excel opens ₹ correctly; the shared writer emits the raw body.
    const blob = new Blob(['\uFEFF' + toCsvMatrix(result.columns, result.rows)], { type: 'text/csv;charset=utf-8' });
    _download(blob, `${meta.key}_${meta.from}_${meta.to}.csv`);
}

async function _xlsx(result, meta) {
    const ExcelJS = await ensureExcelJS();
    const { columns, rows, colTypes } = result;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(_sheetName(meta.title));

    // Row 1 title (bold 14) · Row 2 subtitle (grey) · Row 3 blank spacer · Row 4 header
    const titleRow = ws.addRow([meta.title || 'Report']);
    titleRow.getCell(1).font = { bold: true, size: 14 };
    const subRow = ws.addRow([_subtitle(result, meta)]);
    subRow.getCell(1).font = { color: { argb: GREY_ARGB }, size: 10 };
    ws.addRow([]);
    const headRow = ws.addRow(columns);
    headRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_ARGB } };
    });

    for (const r of rows) {
        const row = ws.addRow((r || []).map(v => typeof v === 'string' ? guardSpreadsheetCell(v) : v));
        row.eachCell((cell, c) => {
            if (colTypes?.[c - 1] === 'money' && typeof cell.value === 'number') cell.numFmt = '#,##0.00';
        });
    }

    // Auto-fit widths (200-row cap inside the helper), freeze the header block.
    autoWidths(columns, rows).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', ySplit: 4 }];

    const buf = await wb.xlsx.writeBuffer();
    _download(new Blob([buf], { type: XLSX_MIME }), `${meta.key}_${meta.from}_${meta.to}.xlsx`);
}

function _pdf(result, meta) {
    const area = document.getElementById('reportPrintArea');
    if (!area) { window.print(); return; } // container missing → bare print, never crash
    const { columns, rows, colTypes } = result;

    // Landscape @page applies only while this print view is up.
    let pageStyle = document.getElementById('rpPageStyle');
    if (!pageStyle) {
        pageStyle = document.createElement('style');
        pageStyle.id = 'rpPageStyle';
        document.head.appendChild(pageStyle);
    }
    pageStyle.textContent = `@media print { @page { size: A4 ${needsLandscape(columns.length) ? 'landscape' : 'portrait'}; margin: 12mm; } }`;

    const head = columns.map(c => `<th>${esc(c)}</th>`).join('');
    const body = rows.map(r => '<tr>' + (r || []).map((v, i) => {
        const t = colTypes?.[i] || 'text';
        const cls = t === 'money' ? ' class="rp-money"' : (t === 'num' ? ' class="rp-num"' : '');
        const txt = v == null ? '\u2014' : (t === 'money' ? fmtMoney(v) : esc(v));
        return `<td${cls}>${txt}</td>`;
    }).join('') + '</tr>').join('');

    area.innerHTML =
        `<h1 class="rp-title">${esc(meta.title || 'Report')}</h1>` +
        `<p class="rp-meta">${esc(_subtitle(result, meta))}</p>` +
        `<table class="rp-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

    document.body.classList.add('printing-report');
    const cleanup = () => {
        document.body.classList.remove('printing-report');
        pageStyle.textContent = '';
        window.removeEventListener('afterprint', cleanup);
        clearTimeout(fallback);
    };
    window.addEventListener('afterprint', cleanup);
    const fallback = setTimeout(cleanup, 5000); // browsers that never fire afterprint
    window.print();
}
