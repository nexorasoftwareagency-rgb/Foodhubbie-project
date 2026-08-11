/**
 * PIZZA ERP | RECEIPT TEMPLATES
 * Standardized templates for order printing.
 */

window.ReceiptTemplates = {
    /**
     * Generates HTML for a thermal receipt (76mm/80mm)
     * @param {Object} order Standardized order object
     * @param {Object} store Store settings (name, address, etc)
     * @param {Boolean} isReprint Whether this is a reprint
     * @returns {String} Full HTML document string
     */
    generateThermalReceipt: function(order, store, isReprint = false) {
        const itemsHtml = order.items.map(i => `
            <tr>
                <td style="padding: 4px 0;">
                    ${this.escapeHtml(i.name)} ${i.size && i.size !== "Regular" ? `<br><small style="font-size:0.7rem; opacity:0.8;">(${this.escapeHtml(i.size)})</small>` : ""}
                </td>
                <td style="text-align:center;">${i.quantity}</td>
                <td style="text-align:right;">${(i.price * i.quantity).toFixed(2)}</td>
            </tr>
        `).join('');

        // Generate dynamic feedback link using base URL from settings or default
        const baseUrl = store.reviewUrl || `https://roshanipizza.web.app/feedback`;
        const feedbackUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}order=${order.orderId}&outlet=${window.currentOutlet || 'default'}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(feedbackUrl)}`;

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Bill - ${order.orderId}</title>
                <style>
                    @page { margin: 0; }
                    * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
                    body { 
                        font-family: 'Courier New', Courier, monospace; 
                        width: 100%; 
                        max-width: 80mm; 
                        margin: 0 auto; 
                        padding: 5mm 3mm;
                        color: #000;
                        line-height: 1.2;
                        font-size: 12px;
                    }
                    .center { text-align: center; }
                    .bold { font-weight: bold; }
                    .mt-5 { margin-top: 5px; }
                    .mt-10 { margin-top: 10px; }
                    .mb-5 { margin-bottom: 5px; }
                    .hr { border-top: 1px dashed #000; margin: 6px 0; }
                    
                    .store-name { font-size: 1.5rem; font-weight: 900; margin: 0; letter-spacing: 1px; }
                    .store-entity { font-size: 0.8rem; text-transform: uppercase; margin-bottom: 2px; }
                    .address-text { font-size: 0.75rem; margin: 5px 0; max-width: 90%; margin-left: auto; margin-right: auto; }
                    
                    table { width: 100%; border-collapse: collapse; margin-top: 5px; }
                    th { border-bottom: 1px dashed #000; padding: 5px 0; border-top: 1px dashed #000; font-size: 0.7rem; text-transform: uppercase; }
                    td { vertical-align: top; font-size: 0.85rem; }
                    
                    .summary { margin-top: 8px; }
                    .summary-row { display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 0.9rem; }
                    .grand-total { 
                        font-size: 1.2rem; 
                        border-top: 1px double #000; 
                        border-bottom: 1px double #000; 
                        padding: 6px 0; 
                        margin-top: 8px;
                        font-weight: 900;
                    }
                    
                    .qr-section { margin-top: 20px; border: 1px solid #000; padding: 10px; border-radius: 8px; }
                    .qr-code { width: 120px; height: 120px; margin-bottom: 5px; }
                    .qr-text { font-size: 0.7rem; font-weight: bold; }
                    
                    .footer { font-size: 0.75rem; margin-top: 20px; border-top: 1px dashed #000; padding-top: 10px; }
                    .reprint-tag { background: #000; color: #fff; padding: 2px 8px; font-size: 0.7rem; display: inline-block; margin-bottom: 5px; }
                </style>
            </head>
            <body>
                <div class="center">
                    ${isReprint ? `<div class="reprint-tag bold">REPRINTED BILL</div>` : ''}
                    
                    <!-- Store Branding -->
                    ${(!store.config || store.config.showStoreName !== false) ? `
                        ${store.entityName ? `<div class="store-entity bold">${this.escapeHtml(store.entityName)}</div>` : ''}
                        <h1 class="store-name">${this.escapeHtml(store.storeName || (window.currentOutlet === 'pizza' ? 'ROSHANI PIZZA' : 'ROSHANI CAKES'))}</h1>
                    ` : ''}
                    
                    ${(!store.config || store.config.showAddress !== false) ? `<div class="address-text">${this.escapeHtml(store.address || '')}</div>` : ''}
                    
                    ${(!store.config || (store.config.showGSTIN !== false && store.gstin)) ? `<div class="bold" style="font-size:0.75rem;">GSTIN: ${this.escapeHtml(store.gstin || '')}</div>` : ''}
                    ${(!store.config || (store.config.showFSSAI !== false && store.fssai)) ? `<div style="font-size:0.7rem;">FSSAI: ${this.escapeHtml(store.fssai || '')}</div>` : ''}
                    
                    <div class="hr"></div>
                    <div class="bold" style="font-size:1.1rem; letter-spacing: 2px;">${(order.type === 'walkin' || order.type === 'Dine-in') ? 'CASH MEMO' : 'ORDER INVOICE'}</div>
                    <div class="hr"></div>
                </div>

                <div style="font-size: 0.8rem;">
                    <div class="summary-row"><span>ORDER: #${order.orderId.slice(-5).toUpperCase()}</span> <span>${order.time || ''}</span></div>
                    <div class="summary-row"><span>DATE: ${order.date || ''}</span> <span>${order.paymentMethod || 'Cash'}</span></div>
                    ${order.tableNo ? `<div class="summary-row"><span class="bold">TABLE NO: ${order.tableNo}</span></div>` : ''}
                </div>
                
                <div class="hr"></div>

                <table>
                    <thead>
                        <tr>
                            <th style="text-align:left;">Item Description</th>
                            <th style="text-align:center; width: 15%;">Qty</th>
                            <th style="text-align:right; width: 25%;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                </table>

                <div class="hr"></div>
                
                <div class="summary">
                    <div class="summary-row">
                        <span>Items Count:</span>
                        <span>${order.items.reduce((sum, i) => sum + i.quantity, 0)}</span>
                    </div>
                    <div class="summary-row">
                        <span>Subtotal:</span>
                        <span>₹${Number(order.subtotal || 0).toFixed(2)}</span>
                    </div>
                    ${order.taxItems && Array.isArray(order.taxItems) && order.taxItems.length > 0 ? order.taxItems.map(t => `<div class="summary-row"><span>${this.escapeHtml(t.name)} (${t.rate}%):</span> <span>₹${Number(t.amount).toFixed(2)}</span></div>`).join('') : (order.tax > 0 ? `<div class="summary-row"><span>${this.escapeHtml(order.taxName || 'Tax')}:</span> <span>₹${Number(order.tax).toFixed(2)}</span></div>` : '')}
                    ${order.serviceCharge > 0 ? `<div class="summary-row"><span>${this.escapeHtml(order.serviceChargeName || 'Service Charge')}${order.serviceChargeRate ? ` (${String(order.serviceChargeRate)}%)` : ''}:</span> <span>₹${Number(order.serviceCharge).toFixed(2)}</span></div>` : ''}
                    ${order.deliveryFee > 0 ? `<div class="summary-row"><span>Delivery:</span> <span>₹${Number(order.deliveryFee).toFixed(2)}</span></div>` : ''}
                    ${order.discount > 0 ? `<div class="summary-row"><span class="bold">Discount${order.discountLabel ? ` (${this.escapeHtml(order.discountLabel)})` : ''}:</span> <span class="bold">-₹${Number(order.discount).toFixed(2)}</span></div>` : ''}
                    
                    <div class="summary-row grand-total">
                        <span style="font-size: 1rem;">NET PAYABLE</span>
                        <span style="font-size: 1.4rem;">₹${Number(order.total || 0).toFixed(2)}</span>
                    </div>
                </div>

                <div class="mt-10" style="font-size: 0.85rem;">
                    <div class="bold">Customer: ${this.escapeHtml(order.customerName || 'Guest')}</div>
                    ${order.phone && order.phone !== "Walk-in" ? `<div>Contact: ${this.escapeHtml(order.phone)}</div>` : ''}
                    ${order.customerNote ? `<div style="margin-top:8px; padding: 8px; border: 1px dashed #000; font-size: 0.7rem; line-height:1.4;"><strong>NOTE:</strong> ${this.escapeHtml(order.customerNote)}</div>` : ''}
                </div>

                ${isReprint ? `
                <div class="center bold" style="border: 1px solid #000; padding: 4px; margin: 10px 0; font-size: 1.1rem;">
                    DUPLICATE / REPRINT
                </div>` : ''}

                <!-- PAYMENT QR SECTION -->
                ${(store.config && store.config.showQR !== false && store.paymentQR) ? `
                <div class="qr-section center" style="border-style: dashed; margin-top: 15px;">
                    <img class="qr-code" src="${store.paymentQR}" alt="Payment QR">
                    <div class="qr-text">SCAN TO PAY ONLINE</div>
                    <div style="font-size:0.6rem; margin-top:2px;">Fast & Secure Digital Payment</div>
                </div>` : ''}

                <!-- FEEDBACK QR SECTION -->
                ${(store.config && store.config.showFeedbackQR !== false) ? `
                <div class="qr-section center">
                    <img class="qr-code" src="${qrUrl}" alt="Feedback QR">
                    <div class="qr-text">SCAN TO GIVE FEEDBACK</div>
                    <div style="font-size:0.6rem; margin-top:2px;">Win a surprise on your next visit!</div>
                </div>` : ''}

                <div class="footer center">
                    ${(!store.config || store.config.showTagline !== false) ? `<div class="bold">${this.escapeHtml(store.tagline || 'Thank You! Visit Again')}</div>` : ''}
                    ${(!store.config || store.config.showPoweredBy !== false) ? `
                    <div style="margin-top:5px; font-size: 0.65rem; opacity:0.7;">
                        ${this.escapeHtml(store.poweredBy || 'Powered by Roshani ERP')}
                    </div>` : ''}
                    <div style="font-size: 0.6rem; margin-top:5px;">*** This is a computer generated bill ***</div>
                </div>
            </body>
            </html>
        `;
    },

    escapeHtml: function(text) {
        if (!text) return "";
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.toString().replace(/[&<>"']/g, m => map[m]);
    }
};
