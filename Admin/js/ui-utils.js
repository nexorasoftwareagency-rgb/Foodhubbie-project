// TODO: showToast and showAlert (notifications.js) share #alertContainer.
// They serve different purposes (toast = transient status, alert = order notification)
// but stack in the same container. Visually distinct via .toast vs .alert-box classes.
// If you need to refactor, consider giving alerts a dedicated container like #orderAlertContainer.

const _toastMap = {};

export const showToast = (message, type = 'success', durationMs = 3000, id = null) => {
    const container = document.getElementById('alertContainer');
    if (!container) return;

    // If an ID is given and a toast with that ID already exists, update it in place
    if (id && _toastMap[id]) {
        const existing = _toastMap[id];
        existing.toast.innerText = message;
        existing.toast.className = `toast toast-${type}`;
        // Reset the dismiss timer
        if (existing.timer) clearTimeout(existing.timer);
        if (existing.removeTimer) clearTimeout(existing.removeTimer);
        existing.timer = setTimeout(() => {
            existing.toast.style.opacity = '0';
            existing.toast.style.transform = 'translateX(100%)';
            existing.toast.style.transition = 'all 0.3s ease';
            existing.removeTimer = setTimeout(() => {
                existing.toast.remove();
                delete _toastMap[id];
            }, 300);
        }, durationMs);
        return id;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerText = message;

    container.appendChild(toast);

    const entry = { toast, timer: null, removeTimer: null };
    if (id) _toastMap[id] = entry;

    entry.timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        entry.removeTimer = setTimeout(() => {
            toast.remove();
            if (id) delete _toastMap[id];
        }, 300);
    }, durationMs);

    return id;
};

// Update an existing toast by ID (created with showToast's `id` parameter)
export const __updateToast = (id, message, type = 'success', durationMs = 3000) => {
    if (id && _toastMap[id]) {
        showToast(message, type, durationMs, id);
    }
};
window.__updateToast = __updateToast;

export const showConfirm = (message, title = "Confirm Action") => {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dynamic-modal-overlay';

        overlay.innerHTML = `
            <div class="dynamic-modal-box">
                <h3 class="dynamic-modal-title"></h3>
                <p class="dynamic-modal-text"></p>
                <div class="dynamic-modal-actions">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-confirm">Confirm</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('.dynamic-modal-title').innerText = title;
        overlay.querySelector('.dynamic-modal-text').innerText = message;

        const cleanup = (val) => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                resolve(val);
            }, 200);
        };

        overlay.querySelector('.btn-confirm').onclick = () => cleanup(true);
        overlay.querySelector('.btn-cancel').onclick = () => cleanup(false);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    });
};

export const showDeleteConfirm = (itemName, message = "This action cannot be undone.") => {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dynamic-modal-overlay';

        overlay.innerHTML = `
            <div class="dynamic-modal-box danger">
                <div class="dynamic-modal-icon">🗑️</div>
                <h3 class="dynamic-modal-title">Delete <span class="highlight-name"></span>?</h3>
                <p class="dynamic-modal-text"></p>
                <div class="dynamic-modal-actions">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-confirm danger">Delete</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('.highlight-name').innerText = itemName;
        overlay.querySelector('.dynamic-modal-text').innerText = message;

        const cleanup = (val) => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                resolve(val);
            }, 200);
        };

        overlay.querySelector('.btn-confirm').onclick = () => cleanup(true);
        overlay.querySelector('.btn-cancel').onclick = () => cleanup(false);
        overlay.querySelector('.btn-cancel').focus();
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    });
};

export const showBulkDeleteConfirm = (bulkLabel) => {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dynamic-modal-overlay';

        overlay.innerHTML = `
            <div class="dynamic-modal-box danger wide">
                <div class="dynamic-modal-icon">⚠️</div>
                <h3 class="dynamic-modal-title">Clear all <span class="highlight-name"></span>?</h3>
                <p class="dynamic-modal-text">This will permanently delete all records.</p>
                <p class="dynamic-modal-text warning">Type <strong>CONFIRM</strong> to proceed.</p>
                <input type="text" class="dynamic-modal-input" placeholder="Type CONFIRM">
                <div class="dynamic-modal-actions">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-confirm danger" disabled>Delete</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('.highlight-name').innerText = bulkLabel;

        const input = overlay.querySelector('.dynamic-modal-input');
        const deleteBtn = overlay.querySelector('.btn-confirm');
        input.focus();

        input.addEventListener('input', () => {
            const match = input.value.trim().toUpperCase() === 'CONFIRM';
            deleteBtn.disabled = !match;
            deleteBtn.style.opacity = match ? '1' : '0.4';
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !deleteBtn.disabled) {
                cleanup(true);
            }
            if (e.key === 'Escape') {
                cleanup(false);
            }
        });

        const cleanup = (val) => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                resolve(val);
            }, 200);
        };

        deleteBtn.onclick = () => cleanup(true);
        overlay.querySelector('.btn-cancel').onclick = () => cleanup(false);
        overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    });
};

export const showPaymentPicker = (total) => {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dynamic-modal-overlay';

        overlay.innerHTML = `
            <div class="dynamic-modal-box wide">
                <h3 class="dynamic-modal-title" style="font-size:20px;">Record Payment</h3>
                <p class="dynamic-modal-text">Confirm payment method for <b>₹${total}</b></p>
                <div class="dynamic-payment-grid">
                    <button data-method="Cash" class="pay-btn">💵 Cash</button>
                    <button data-method="UPI" class="pay-btn">📱 UPI</button>
                    <button data-method="Card" class="pay-btn">💳 Card</button>
                    <button id="cancelPay" class="pay-btn pay-btn-cancel">Cancel</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        const cleanup = (val) => {
            overlay.remove();
            resolve(val);
        };

        overlay.querySelectorAll('button[data-method]').forEach(btn => {
            btn.onclick = () => cleanup(btn.getAttribute('data-method'));
        });
        overlay.querySelector('#cancelPay').onclick = () => cleanup(null);
    });
};

/**
 * Split payment picker — allows multiple payment methods to sum to total.
 * Returns array of { method, amount } or null if cancelled.
 */
export const showSplitPaymentPicker = (total) => {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dynamic-modal-overlay';

        const methods = [
            { id: 'Cash', label: '💵 Cash', color: '#22c55e' },
            { id: 'UPI', label: '📱 UPI', color: '#1d4ed8' },
            { id: 'Card', label: '💳 Card', color: '#f59e0b' },
        ];

        let entries = [];

        const render = () => {
            const enteredTotal = entries.reduce((s, e) => s + e.amount, 0);
            const remaining = Math.max(0, total - enteredTotal);
            const isComplete = enteredTotal >= total;

            overlay.innerHTML = `
                <div class="dynamic-modal-box wide" style="max-width:420px;">
                    <h3 class="dynamic-modal-title" style="font-size:18px;">Record Payment</h3>
                    <div class="split-payment-header">
                        <div class="split-total-row">
                            <span>Bill Total</span>
                            <strong>₹${total.toLocaleString('en-IN')}</strong>
                        </div>
                        <div class="split-total-row" style="color:${enteredTotal >= total ? '#22c55e' : '#ef4444'};">
                            <span>Entered</span>
                            <strong>₹${entries.reduce((s, e) => s + e.amount, 0).toLocaleString('en-IN')}</strong>
                        </div>
                        <div class="split-total-row" style="color:${total - entries.reduce((s, e) => s + e.amount, 0) > 0 ? '#ef4444' : '#22c55e'};">
                            <span>Remaining</span>
                            <strong>₹${Math.max(0, total - entries.reduce((s, e) => s + e.amount, 0)).toLocaleString('en-IN')}</strong>
                        </div>
                    </div>

                    <div class="split-entries" id="splitEntries">
                        ${entries.length === 0
                            ? '<p class="split-empty">No payment methods added yet</p>'
                            : entries.map((e, i) => `
                                <div class="split-entry-row">
                                    <span class="split-entry-method" style="background:${methods.find(m => m.id === e.method)?.color || '#64748b'}">${methods.find(m => m.id === e.method)?.label || e.method}</span>
                                    <span class="split-entry-amount">₹${e.amount.toLocaleString('en-IN')}</span>
                                    <button type="button" class="split-entry-remove" data-index="${i}" title="Remove">×</button>
                                </div>
                            `).join('')}
                    </div>

                    <div class="split-add-row">
                        <select id="splitMethodSelect" class="split-select" ${entries.reduce((s, e) => s + e.amount, 0) >= total ? 'disabled' : ''}>
                            <option value="">Select payment method</option>
                            ${methods.map(m => `<option value="${m.id}">${m.label}</option>`).join('')}
                        </select>
                        <input type="number" id="splitAmountInput" class="split-input" placeholder="Amount" min="1" max="${Math.max(1, total - entries.reduce((s, e) => s + e.amount, 0))}" ${entries.reduce((s, e) => s + e.amount, 0) >= total ? 'disabled' : ''}>
                        <button type="button" id="splitAddBtn" class="btn-primary split-add-btn" ${entries.reduce((s, e) => s + e.amount, 0) >= total ? 'disabled' : ''}>Add</button>
                    </div>

                    <div class="dynamic-payment-grid" style="margin-top:16px;">
                        <button id="splitConfirmBtn" class="pay-btn pay-btn-confirm" ${entries.reduce((s, e) => s + e.amount, 0) >= total ? '' : 'disabled'}>Confirm Payment</button>
                        <button id="splitCancelBtn" class="pay-btn pay-btn-cancel">Cancel</button>
                    </div>
                </div>`;

            // Attach events after render
            overlay.querySelectorAll('.split-entry-remove').forEach(btn => {
                btn.onclick = () => {
                    entries.splice(Number(btn.dataset.index), 1);
                    render();
                };
            });

            const addBtn = overlay.querySelector('#splitAddBtn');
            const methodSelect = overlay.querySelector('#splitMethodSelect');
            const amountInput = overlay.querySelector('#splitAmountInput');

            if (addBtn) {
                addBtn.onclick = () => {
                    const method = methodSelect.value;
                    let amount = Number(amountInput.value);
                    if (!method || !amount || amount <= 0) return;
                    const remaining = total - entries.reduce((s, e) => s + e.amount, 0);
                    if (amount > remaining) amount = remaining;
                    entries.push({ method, amount });
                    methodSelect.value = '';
                    amountInput.value = '';
                    render();
                };
            }

            if (amountInput) {
                amountInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') addBtn?.click();
                });
            }

            overlay.querySelector('#splitConfirmBtn').onclick = () => cleanup(entries);
            overlay.querySelector('#splitCancelBtn').onclick = () => cleanup(null);
        };

        const cleanup = (val) => {
            overlay.remove();
            resolve(val);
        };

        document.body.appendChild(overlay);
        render();
    });
};
