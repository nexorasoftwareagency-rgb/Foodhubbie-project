/**
 * FoodHubbie ERP | REPORT EXPORT HELPERS (pure — no imports, runnable in node or browser)
 * Phase 5 (OrderRestro port §4): the spreadsheet-injection guard, CSV writer and
 * column-width auto-fit shared by every report export path (runner CSV/XLSX and
 * the Revenue analytics Excel export).
 *
 * Security: any cell STRING starting with = + - @ \t \r gets a `'` prefix so
 * Excel/LibreOffice never executes it as a formula (spreadsheet injection).
 * Applies to CSV AND XLSX cells alike.
 */

export function guardSpreadsheetCell(v) {
    if (typeof v !== 'string') return v;
    return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

// RFC-4180 CSV: guard first, then quote cells containing , " \n or \r.
// Returns the CSV body WITHOUT a BOM (callers prepend \uFEFF for Excel).
export function toCsvMatrix(columns, rows) {
    const cell = (v) => {
        const s = String(v == null ? '' : guardSpreadsheetCell(v));
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [(Array.isArray(columns) ? columns : []).map(cell).join(',')];
    const list = Array.isArray(rows) ? rows : [];
    for (const r of list) {
        // forgive scalar rows: wrap as a single cell; null/undefined → empty row
        const cells = Array.isArray(r) ? r : (r == null ? [] : [r]);
        lines.push(cells.map(cell).join(','));
    }
    return lines.join('\r\n');
}

// Auto-fit column widths: max(header, widest of the first `cap` data rows) + 2,
// clamped to min…max. Numbers are measured by their en-IN 2dp display length
// (plus 1 for the ₹ the renderer prefixes) so money columns fit formatted.
export function autoWidths(headers, rows, opts = {}) {
    const cap = opts.cap || 200;
    const min = opts.min != null ? opts.min : 10;
    const max = opts.max != null ? opts.max : 48;
    const measure = (v) => {
        if (v == null) return 0;
        if (typeof v === 'number') return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length + 1;
        return String(v).length;
    };
    const widths = (Array.isArray(headers) ? headers : []).map(h => measure(h));
    const list = Array.isArray(rows) ? rows.slice(0, cap) : [];
    for (const r of list) {
        const cells = Array.isArray(r) ? r : [];
        for (let c = 0; c < widths.length; c++) {
            const len = measure(cells[c]);
            if (len > widths[c]) widths[c] = len;
        }
    }
    return widths.map(w => Math.max(min, Math.min(max, w + 2)));
}

// PDF/print layout rule: landscape when the table is wider than 6 columns.
export function needsLandscape(columnCount) {
    return (Number(columnCount) || 0) > 6;
}

// ---------------------------------------------------------------------------
// Self-check: `node shared/report-export.js`
// ---------------------------------------------------------------------------
if (typeof process !== 'undefined' && process.argv?.[1]?.includes('report-export')) {
    import('node:assert').then(({ default: assert }) => {
        // guard: formula-leading strings prefixed, everything else untouched
        assert.strictEqual(guardSpreadsheetCell('=cmd|\' /C calc\'!A0'), "'=cmd|' /C calc'!A0");
        assert.strictEqual(guardSpreadsheetCell('+SUM(A1:A2)'), "'+SUM(A1:A2)");
        assert.strictEqual(guardSpreadsheetCell('-5 items'), "'-5 items");
        assert.strictEqual(guardSpreadsheetCell('@x'), "'@x");
        assert.strictEqual(guardSpreadsheetCell('\ttab'), "'\ttab");
        assert.strictEqual(guardSpreadsheetCell('\rcr'), "'\rcr");
        assert.strictEqual(guardSpreadsheetCell('normal text'), 'normal text');
        assert.strictEqual(guardSpreadsheetCell(''), '');
        assert.strictEqual(guardSpreadsheetCell(42), 42);       // numbers pass through
        assert.strictEqual(guardSpreadsheetCell(null), null);
        assert.strictEqual(guardSpreadsheetCell(500.5), 500.5);

        // csv: guard + quoting + header + CRLF
        const csv = toCsvMatrix(['Item', 'Qty'], [['=E2E_INJECT', 2], ['a,"b"', 1], ['line\nbreak', 3]]);
        const lines = csv.split('\r\n');
        assert.strictEqual(lines[0], 'Item,Qty');
        assert.strictEqual(lines[1], "'=E2E_INJECT,2");
        assert.strictEqual(lines[2], '"a,""b""",1');
        assert.strictEqual(lines[3], '"line\nbreak",3');

        // csv: empty + hostile input
        assert.strictEqual(toCsvMatrix([], []), '');
        assert.strictEqual(toCsvMatrix(['A'], [null, 'x']), 'A\r\n\r\nx');
        assert.strictEqual(toCsvMatrix(null, 'not-an-array'), '');

        // widths: header vs data, formatted money length, clamp + cap
        const w = autoWidths(['Item', 'Revenue'], [['Margherita', 398], ['=E2E_INJECT', 123456.7]], { min: 10, max: 48 });
        assert.strictEqual(w[0], '=E2E_INJECT'.length + 2);      // 13 — widest data cell wins
        assert.ok(w[1] > 'Revenue'.length);                            // money formatted is wider
        assert.strictEqual(w[1], '1,23,456.70'.length + 1 + 2);        // en-IN 2dp + ₹ + pad
        const clamped = autoWidths(['A'], [['x'.repeat(99)]], { min: 10, max: 48 });
        assert.strictEqual(clamped[0], 48);
        const floor = autoWidths(['A'], [['x']], { min: 10, max: 48 });
        assert.strictEqual(floor[0], 10);
        const capped = autoWidths(['A'], Array.from({ length: 500 }, (_, i) => [i === 499 ? 'WIDE'.repeat(20) : 'x']), { cap: 200 });
        assert.strictEqual(capped[0], 10); // row 499 is beyond the 200 cap → ignored

        // landscape rule
        assert.strictEqual(needsLandscape(6), false);
        assert.strictEqual(needsLandscape(7), true);
        assert.strictEqual(needsLandscape(0), false);

        console.log('report-export OK');
    }).catch(e => { console.error(e); process.exit(1); });
}
