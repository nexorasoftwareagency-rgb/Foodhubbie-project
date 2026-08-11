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
