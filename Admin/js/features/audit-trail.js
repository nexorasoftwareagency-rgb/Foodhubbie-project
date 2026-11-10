/**
 * FoodHubbie ERP | AUDIT TRAIL MODULE
 * Tracks who changed what and when across the Customer APP sub-tabs.
 *
 * RTDB path: businesses/{bid}/outlets/{oid}/auditLog/{pushId}
 * Shape: { action, target, targetId, oldValue, newValue, by, byName, at }
 *
 * Exports:
 *  - logChange(action, target, targetId, oldValue, newValue) — write audit entry
 *  - loadAuditLog(limit) — read recent audit entries
 *  - renderAuditLog(containerId) — render audit log UI
 */

import { db, auth, Outlet, BUSINESS_ID, ref, get, push, set, query, orderByKey, limitToLast } from '../firebase.js';
import { state } from '../state.js';
import { showToast } from '../ui-utils.js';
import { formatDate } from '../utils.js';

const $ = (id) => document.getElementById(id);

/**
 * Write an audit log entry. Fire-and-forget (never blocks the UI).
 */
export async function logChange(action, target, targetId, oldValue, newValue) {
    try {
        const user = auth.currentUser;
        const by = user ? user.uid : 'unknown';
        const byName = (state.adminData && state.adminData.name) || (user ? user.email : 'unknown');
        const at = Date.now();
        const entry = {
            action,
            target,
            targetId: targetId || '',
            oldValue,
            newValue,
            by,
            byName,
            at
        };
        await push(Outlet.ref('auditLog'), entry);
    } catch (e) {
        // Audit logging must never break the user flow.
        console.error('[AuditTrail] Failed to write audit entry:', e);
    }
}

/**
 * Load recent audit log entries (newest first).
 */
export async function loadAuditLog(limit = 50) {
    try {
        const snap = await get(query(
            Outlet.ref('auditLog'),
            orderByKey(),
            limitToLast(limit)
        ));
        const raw = snap.val() || {};
        return Object.entries(raw)
            .map(([key, v]) => ({ key, ...v }))
            .sort((a, b) => (b.at || 0) - (a.at || 0));
    } catch (e) {
        console.error('[AuditTrail] Failed to load audit log:', e);
        return [];
    }
}

/**
 * Render audit log UI into a container element.
 */
export async function renderAuditLog(containerId) {
    const wrap = $(containerId);
    if (!wrap) return;
    const entries = await loadAuditLog(50);
    if (entries.length === 0) {
        wrap.innerHTML = '<div style="padding:24px;color:var(--text-tertiary);text-align:center;">No audit activity yet.</div>';
        return;
    }
    wrap.innerHTML = entries.map(e => {
        const at = formatDate(e.at || 0);
        const actionLabel = {
            create: 'Created', update: 'Updated', delete: 'Deleted',
            archive: 'Archived', restore: 'Restored', toggle: 'Toggled',
            reorder: 'Reordered', feature: 'Featured', unfeature: 'Unfeatured'
        }[e.action] || e.action;
        const oldStr = e.oldValue != null ? JSON.stringify(e.oldValue).slice(0, 60) : '—';
        const newStr = e.newValue != null ? JSON.stringify(e.newValue).slice(0, 60) : '—';
        return `
            <div class="audit-row" style="padding:8px 12px;border-bottom:1px solid var(--border,#eef0f3);display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;color:var(--text-primary);">${_escHtml(e.target)} ${actionLabel}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">${e.targetId ? `ID: ${_escHtml(e.targetId)}` : ''}</div>
                </div>
                <div style="font-size:11px;color:var(--text-tertiary);text-align:right;line-height:1.4;">
                    <div>${at}</div>
                    <div>${_escHtml(e.byName || e.by)}</div>
                    <div style="margin-top:4px;">
                        <span style="font-size:10px;color:var(--text-tertiary);">Old: ${oldStr}</span>
                        <div style="font-size:10px;color:var(--text-tertiary);">New: ${newStr}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function _escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Helper: create an audit-logged update wrapper.
 * Usage: await auditedUpdate(ref(path), updates, 'update', 'discounts', id, oldVal, newVal)
 */
export async function auditedUpdate(refPath, updates, action, target, targetId, oldValue, newValue) {
    await set(refPath, updates);
    await logChange(action, target, targetId, oldValue, newValue);
}
