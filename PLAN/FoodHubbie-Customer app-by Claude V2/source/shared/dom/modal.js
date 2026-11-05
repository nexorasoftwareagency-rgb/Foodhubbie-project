/**
 * SHARED TOAST — reusable UI primitive.
 *
 * Usage:
 *   import { showToast } from '../shared/dom/modal.js';
 *   showToast('Saved!', 'success');
 */

/**
 * Show a bottom-center toast notification.
 * @param {string} msg - Message text
 * @param {'info'|'success'|'error'|'warning'} type
 * @param {number} durationMs - Auto-dismiss delay (default 3000)
 */
export function showToast(msg, type = 'info', durationMs = 3000) {
    const toast = document.createElement('div');
    const colors = {
        error: '#EF4444',
        success: '#10B981',
        warning: '#F59E0B',
        info: '#1E293B'
    };
    const bg = colors[type] || colors.info;
    toast.style.cssText = `position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:${bg}; color:#fff; padding:12px 24px; border-radius:30px; font-weight:700; z-index:9999; text-transform:uppercase; text-align:center; white-space:nowrap; box-shadow:0 4px 15px rgba(0,0,0,0.2);`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), durationMs);
}
