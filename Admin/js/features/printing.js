import { Outlet, get, query, orderByChild, equalTo, limitToLast } from '../firebase.js';
import { updateStatus } from './orders.js';
import { standardizeOrderData, showToast, formatOrderId } from '../utils.js';
import { state } from '../state.js';
import { getRoles } from '../ui.js';

/**
 * Small receipt/report claim: "By {Role} — {Name}".
 * Shift staff (counterStaffUid) wins, then the logged-in admin. '' = omit line.
 */
export async function resolveOperatorClaim(staffUid) {
    try {
        const uid = staffUid || sessionStorage.getItem('counterStaffUid') || state.adminData?.uid;
        let name = '', role = '';
        if (uid) {
            const s = (await get(Outlet.staff(uid))).val();
            if (s && s.isActive !== false) { name = s.displayName || ''; role = s.role || ''; }
        }
        if (!name) { name = state.adminData?.name || state.adminData?.email || ''; role = state.adminData?.role || ''; }
        const label = getRoles()[String(role).toLowerCase().trim()]?.name || role;
        return (name && label) ? `${label} — ${name}` : '';
    } catch (e) {
        console.warn('[Print] Operator claim resolve failed:', e);
        return '';
    }
}

let _jspdfLoaded = false;
let _jspdfPromise = null;

export function loadJSPDF() {
    if (_jspdfLoaded) return Promise.resolve();
    if (_jspdfPromise) return _jspdfPromise;

    _jspdfPromise = new Promise((resolve, reject) => {
        const script1 = document.createElement('script');
        script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script1.crossOrigin = 'anonymous';
        script1.onload = () => {
            const script2 = document.createElement('script');
            script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js';
            script2.crossOrigin = 'anonymous';
            script2.onload = () => {
                _jspdfLoaded = true;
                resolve();
            };
            script2.onerror = reject;
            document.head.appendChild(script2);
        };
        script1.onerror = reject;
        document.head.appendChild(script1);
    });

    return _jspdfPromise;
}

// ==== MINIMAL REPORT CHROME (start) ====
// Professional A4 report kit: white bg, hairlines, neutral ink, no gradient/badge art.
// Pure jsPDF drawing — node-smoke-testable by extracting between the CHROME markers.
const R_INK = [15, 23, 42];
const R_MUTED = [100, 116, 139];
const R_FAINT = [148, 163, 184];
const R_LINE = [226, 232, 240];

/** Eyebrow title + date, report name headline, meta line(s), hairline. Returns KPI y. */
export function reportHead(doc, { title, subtitle, meta, meta2 }) {
    const pw = doc.internal.pageSize.getWidth(), M = 14;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
    doc.setTextColor(...R_FAINT);
    doc.text(String(title || '').toUpperCase(), M, 16, { charSpace: 1.2 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }), pw - M, 16, { align: 'right' });
    let sz = 17;
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...R_INK); doc.setFontSize(sz);
    const w = doc.getTextWidth(String(subtitle || ''));
    if (w > pw - 2 * M) sz = Math.max(11, sz * (pw - 2 * M) / w);
    doc.setFontSize(sz);
    doc.text(String(subtitle || ''), M, 27);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(...R_MUTED);
    doc.text(String(meta || ''), M, 33.5);
    if (meta2) doc.text(String(meta2), M, 38.5);
    doc.setDrawColor(...R_LINE); doc.setLineWidth(0.3);
    const ruleY = meta2 ? 43 : 39;
    doc.line(M, ruleY, pw - M, ruleY);
    return ruleY + 6;
}

/** 4 hairline KPI cards (white fill, no shadow). Returns section-gap y. */
export function reportKpis(doc, kpis, y) {
    const pw = doc.internal.pageSize.getWidth(), M = 14, gap = 6, cardH = 24;
    const cardW = (pw - 2 * M - 3 * gap) / 4;
    (kpis || []).forEach(([label, value], i) => {
        const x = M + i * (cardW + gap);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...R_LINE); doc.setLineWidth(0.25);
        doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
        doc.setTextColor(...R_FAINT);
        doc.text(String(label), x + 5, y + 8.5, { charSpace: 0.4 });
        doc.setFontSize(11.5); doc.setTextColor(...R_INK);
        doc.text(String(value), x + 5, y + 18);
    });
    return y + cardH + 8;
}

/** Ink tick + section label, muted count right. Returns table startY. */
export function reportSection(doc, { label, right, y }) {
    const pw = doc.internal.pageSize.getWidth(), M = 14;
    doc.setFillColor(...R_INK);
    doc.rect(M, y, 3.5, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.setTextColor(...R_INK);
    doc.text(String(label || ''), M + 6, y + 4.5, { charSpace: 0.5 });
    if (right) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        doc.setTextColor(140, 136, 130);
        doc.text(String(right), pw - M, y + 4.5, { align: 'right' });
    }
    return y + 12;
}

/** Continuation-page header for autoTable didDrawPage (pages >= 2). */
export function reportContinued(doc, label, storeName) {
    const pw = doc.internal.pageSize.getWidth(), M = 14;
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pw, 20, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.setTextColor(...R_INK);
    doc.text(String(label || ''), M, 9);
    doc.setFontSize(7.5); doc.setTextColor(...R_MUTED);
    doc.text(String(storeName || ''), M, 14.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.setTextColor(...R_FAINT);
    doc.text('Continued', pw - M, 12, { align: 'right' });
    doc.setDrawColor(...R_LINE); doc.setLineWidth(0.3);
    doc.line(M, 18, pw - M, 18);
}

/** Footer post-pass: hairline + store left, Page X of Y right. */
export function reportFoot(doc, storeName) {
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const M = 14;
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
        doc.setPage(p);
        doc.setDrawColor(...R_LINE); doc.setLineWidth(0.3);
        doc.line(M, ph - 14, pw - M, ph - 14);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.setTextColor(...R_FAINT);
        doc.text(String(storeName || ''), M, ph - 9);
        doc.text(`Page ${p} of ${total}`, pw - M, ph - 9, { align: 'right' });
    }
}
// ==== MINIMAL REPORT CHROME (end) ====

// Settings Cache to reduce lag on subsequent prints
let settingsCache = {
    store: null,
    display: null,
    lastFetched: 0
};
const CACHE_DURATION = 300000; // 5 minutes

// Receipt preview state
let _previewHtml = null;

/**
 * Main function to print an order receipt
 * @param {Object} rawOrder - The raw order data from Firebase
 * @param {Boolean} isReprint - Whether this is a reprint (affects template branding)
 */
export async function printOrderReceipt(rawOrder, isReprint = false) {
    console.time('[Print] Receipt Generation');
    const o = standardizeOrderData(rawOrder);
    if (!o) return;

    // If it's the original print and we have saved HTML, use iframe (avoids popup blockers on mobile)
    if (!isReprint && rawOrder.receiptHtml) {
        printWithIframe(rawOrder.receiptHtml);
        return;
    }

    let store = {
        entityName: "",
        storeName: "Our Restaurant",
        address: "",
        gstin: "",
        fssai: "",
        tagline: "THANK YOU",
        poweredBy: "Powered by FoodHubbie",
        config: {
            showStoreName: true,
            showAddress: true,
            showGSTIN: false,
            showFSSAI: false,
            showTagline: true,
            showPoweredBy: true,
            showQR: true,
            showFeedbackQR: true
        }
    };

    try {
        const now = Date.now();
        if (!settingsCache.store || (now - settingsCache.lastFetched > CACHE_DURATION)) {
            const [storeSnap, dispSnap] = await Promise.all([
                get(Outlet.ref("settings/Store")),
                get(Outlet.ref("settings/Display"))
            ]);
            
            settingsCache.store = storeSnap.exists() ? storeSnap.val() : {};
            settingsCache.display = dispSnap.exists() ? dispSnap.val() : {};
            settingsCache.lastFetched = now;
        }

        if (settingsCache.store) {
            store = { ...store, ...settingsCache.store };
        }

        if (settingsCache.display) {
            const disp = settingsCache.display;
            const mapping = {
                'checkShowStoreName': 'showStoreName',
                'checkShowAddress': 'showAddress',
                'checkShowGSTIN': 'showGSTIN',
                'checkShowFSSAI': 'showFSSAI',
                'checkShowTagline': 'showTagline',
                'checkShowPoweredBy': 'showPoweredBy',
                'checkShowQR': 'showQR',
                'checkShowFeedbackQR': 'showFeedbackQR'
            };

            Object.entries(mapping).forEach(([checkKey, targetKey]) => {
                if (disp[checkKey] !== undefined) {
                    store.config[targetKey] = disp[checkKey];
                }
            });
        }
    } catch (e) {
        console.warn("Could not load settings for print:", e);
    }

    // Use cached receipt HTML if available (big desktop performance win)
    if (!isReprint && rawOrder.receiptHtml) {
        printWithIframe(rawOrder.receiptHtml);
        console.timeEnd('[Print] Receipt Generation');
        return;
    }

    // ReceiptTemplates is globally defined in receipt-templates.js
    if (!window.ReceiptTemplates) {
        console.error("ReceiptTemplates not found!");
        showToast("Printing templates not loaded. Please refresh.", "error");
        return;
    }

    o.claimBy = o.claimBy || await resolveOperatorClaim(rawOrder.counterStaffUid);
    const html = window.ReceiptTemplates.generateThermalReceipt(o, store, isReprint);
    
    // Cache the generated HTML for future reprints
    if (!isReprint) {
        rawOrder.receiptHtml = html;
    }

    // Show preview for user-initiated reprints; print directly for auto-prints
    if (isReprint) {
        showReceiptPreview(html);
    } else {
        printWithIframe(html);
    }
    console.timeEnd('[Print] Receipt Generation');
}

/** Fast desktop-friendly print using hidden iframe (avoids popup lag) */
function printWithIframe(html) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            console.error("Iframe print error:", e);
        }
        setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 400);
}

/**
 * RECEIPT PREVIEW MODAL — Inline responsive renderer
 * Renders receipt HTML directly into modal (no iframe scaling hacks),
 * fills viewport, maintains 80mm aspect ratio.
 */
function showReceiptPreview(html) {
    _previewHtml = html;
    const modal = document.getElementById('receiptPreviewModal');
    const frame = document.getElementById('receiptPreviewFrame');
    if (!modal || !frame) {
        printWithIframe(html);
        return;
    }

    // Extract body content from full HTML document
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const bodyContent = doc.body.innerHTML;
    const styles = Array.from(doc.head.querySelectorAll('style, link[rel="stylesheet"]'))
        .map(el => el.outerHTML).join('');

    // Inject styles + body into iframe (keeps print() working)
    frame.src = 'about:blank';
    frame.onload = () => {
        const fDoc = frame.contentDocument;
        fDoc.open();
        fDoc.write(`<!DOCTYPE html><html><head>${styles}</head><body>${bodyContent}</body></html>`);
        fDoc.close();

        // Responsive: scale to fit viewport while maintaining 80mm aspect ratio
        const container = document.getElementById('receiptPreviewContainer');
        const receipt = fDoc.querySelector('body > *') || fDoc.body;
        const maxW = container.clientWidth * 0.95;
        const maxH = container.clientHeight * 0.95;
        const scale = Math.min(
            maxW / 304,  // 80mm ≈ 304px at 96dpi
            maxH / receipt.scrollHeight
        );
        if (scale < 1) {
            receipt.style.transform = `scale(${scale})`;
            receipt.style.transformOrigin = 'top center';
            receipt.style.width = '304px'; // lock 80mm width
        } else {
            receipt.style.transform = 'none';
            receipt.style.width = 'auto';
        }
    };
    // Fallback if onload already fired
    if (frame.contentDocument?.readyState === 'complete') {
        frame.onload();
    }

    modal.classList.remove('hidden');
    modal.classList.add('active', 'flex');
    if (!modal.__backdropWired) {
        modal.__backdropWired = 1;
        modal.addEventListener('click', (e) => { if (e.target === modal) closeReceiptPreview(); });
    }
}

export function closeReceiptPreview() {
    _previewHtml = null;
    const modal = document.getElementById('receiptPreviewModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('active', 'flex');
    }
}

export function printReceiptFromPreview() {
    const html = _previewHtml;
    closeReceiptPreview();
    if (html) {
        printWithIframe(html);
    }
}

export async function downloadReceiptPdf() {
    await loadJSPDF();
    const html = _previewHtml;
    if (!html) return;

    const { jsPDF } = window.jspdf;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body.cloneNode(true);

    // Remove QR images for cleaner PDF
    body.querySelectorAll('img').forEach(img => img.remove());

    const pdf = new jsPDF({ unit: 'mm', format: [80, 297], orientation: 'p' }); // 80mm x 297mm
    await pdf.html(body, {
        callback: (pdf) => {
            pdf.save(`receipt-${Date.now()}.pdf`);
            closeReceiptPreview();
        },
        x: 3, y: 3
    });
}

/**
 * Fetch an order by ID and print it
 * @param {String} orderId - The order ID to print
 */
export async function printReceiptById(orderId) {
    await loadJSPDF();
    try {
        const snap = await get(query(Outlet.ref("orders"), orderByChild("orderId"), equalTo(orderId)));
        let order;

        if (snap.exists()) {
            snap.forEach(s => { order = s.val(); });
        } else {
            const snap2 = await get(Outlet.ref(`orders/${orderId}`));
            order = snap2.val();
        }

        if (!order) {
            showToast("Order not found!", "error");
            return;
        }

        printOrderReceipt(order, true);

    } catch (e) {
        console.error("Print Error:", e);
        showToast("Failed to fetch order for printing.", "error");
    }
}

/**
 * Reprint the most recent Dine-in (POS) order
 */
/**
 * Print a Kitchen Order Ticket (KOT) — no prices, just items for kitchen staff
 */
export async function printKotById(orderId) {
    await loadJSPDF();
    try {
        const snap = await get(Outlet.ref(`orders/${orderId}`));
        if (!snap.exists()) { showToast("Order not found!", "error"); return; }
        const o = snap.val();
        const items = Array.isArray(o.items) ? o.items : (o.cart || []);
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const storeName = "Our Restaurant";
        const itemRows = items.map(i => {
            const addons = [];
            if (i.addon && i.addon !== 'None') addons.push(i.addon);
            if (i.addons) i.addons.forEach(a => { if (a.name) addons.push(a.name); });
            return `<tr><td style="font-size:14px;font-weight:700;padding:4px 0;">${i.qty || 1}x</td><td style="font-size:14px;padding:4px 0 4px 8px;">${i.name || 'Item'} ${i.size && i.size !== '- Default -' ? `(${i.size})` : ''}${addons.length ? `<br><span style="font-size:11px;color:#666;">+ ${addons.join(', ')}</span>` : ''}</td></tr>`;
        }).join('');

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
            body{width:80mm;margin:0;padding:8mm 3mm;font-family:'Courier New',monospace;font-size:13px;color:#222;}
            h2{text-align:center;font-size:18px;margin:0 0 4px;}
            .sub{text-align:center;font-size:11px;color:#666;margin:0 0 8px;}
            .divider{border-top:1px dashed #999;margin:8px 0;}
            table{width:100%;border-collapse:collapse;}
            .note{margin-top:8px;padding:6px;border:1px dashed #999;font-size:12px;color:#555;}
            .footer{text-align:center;font-size:11px;color:#999;margin-top:12px;}
        </style></head><body>
            <h2>${storeName}</h2>
            <div class="sub">KITCHEN ORDER TICKET</div>
            <div class="divider"></div>
            <div style="font-size:12px;"><b>Order:</b> #${formatOrderId(o.orderId || orderId)}</div>
            <div style="font-size:12px;"><b>Date:</b> ${dateStr} ${timeStr}</div>
            ${o.tableNo ? `<div style="font-size:12px;"><b>Table:</b> ${o.tableNo}</div>` : ''}
            ${o.customerName ? `<div style="font-size:12px;"><b>Customer:</b> ${o.customerName}</div>` : ''}
            <div class="divider"></div>
            <table>${itemRows}</table>
            ${o.customerNote ? `<div class="note"><b>Notes:</b> ${o.customerNote}</div>` : ''}
            <div class="divider"></div>
            <div class="footer">--- KOT ---</div>
        </body></html>`;
        printWithIframe(html);
    } catch (e) {
        console.error("KOT Print Error:", e);
        showToast("Failed to print KOT.", "error");
    }
}

export async function reprintLastPosReceipt() {
    try {
        const snap = await get(query(Outlet.ref("orders"), orderByChild("type"), equalTo("Dine-in"), limitToLast(1)));

        let lastOrder = null;
        snap.forEach(child => {
            lastOrder = child.val();
        });

        if (lastOrder) {
            printOrderReceipt(lastOrder, true);
        } else {
            showToast("No POS orders found to reprint.", "info");
        }
    } catch (e) {
        console.error("Reprint Error:", e);
        showToast("Failed to reprint last receipt.", "error");
    }
}
