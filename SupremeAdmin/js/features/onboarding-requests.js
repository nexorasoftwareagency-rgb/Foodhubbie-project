/**
 * Onboarding Requests — #onboarding
 * Lists website signup applications. Supreme Admin approves (creates outlet
 * + Auth user via bot-control-api) or rejects (with reason).
 */
import { registerAction } from '/js/main.js';
import { isReadOnly } from '/js/data-store.js';
import { refreshIcons, escapeHtml, showConfirm, showToast } from '/js/utils.js';

const mainEl = document.getElementById('app-main');
let state = null;

export function render() {
  state = { filter: 'pending', requests: [] };

  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Onboarding Requests</h1>
        <div class="panel-sub">Website signup applications — approve to create the outlet</div>
      </div>
    </div>

    <div class="table-kpi-grid" id="ob-kpis"></div>

    <div class="glass-card" style="margin-bottom:16px;padding:12px 16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm ob-filter" data-action="ob-filter" data-filter="pending">Pending</button>
      <button class="btn btn-ghost btn-sm ob-filter" data-action="ob-filter" data-filter="approved">Approved</button>
      <button class="btn btn-ghost btn-sm ob-filter" data-action="ob-filter" data-filter="rejected">Rejected</button>
      <button class="btn btn-ghost btn-sm ob-filter" data-action="ob-filter" data-filter="all">All</button>
    </div>

    <div class="glass-card" style="overflow-x:auto">
      <table class="data-table" id="ob-table">
        <thead><tr><th>Business</th><th>Outlet</th><th>Contact</th><th>Admin Email</th><th>Plan</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  refreshIcons(mainEl);

  registerAction('ob-filter', (btn) => setFilter(btn.dataset.filter));
  registerAction('ob-view', (btn) => viewRequest(btn.dataset.key));
  registerAction('ob-approve', (btn) => approveRequest(btn.dataset.key));
  registerAction('ob-reject', (btn) => rejectRequest(btn.dataset.key));

  const ref = firebase.database().ref('onboardingRequests');
  const onValue = (snap) => {
    const reqs = snap.val() || {};
    state.requests = Object.entries(reqs).map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderAll();
  };
  ref.once('value', onValue);
  const interval = setInterval(() => ref.once('value', onValue), 5000);
  return () => clearInterval(interval);
}

function setFilter(f) {
  state.filter = f;
  renderAll();
}

function renderAll() {
  const filtered = state.filter === 'all'
    ? state.requests
    : state.requests.filter((r) => r.status === state.filter);

  const pending = state.requests.filter((r) => r.status === 'pending').length;
  const approved = state.requests.filter((r) => r.status === 'approved').length;
  const rejected = state.requests.filter((r) => r.status === 'rejected').length;

  document.getElementById('ob-kpis').innerHTML = `
    <div class="glass-card kpi-tile">
      <div class="kpi-label">Pending</div>
      <div class="kpi-value">${pending}</div>
    </div>
    <div class="glass-card kpi-tile">
      <div class="kpi-label">Approved</div>
      <div class="kpi-value">${approved}</div>
    </div>
    <div class="glass-card kpi-tile">
      <div class="kpi-label">Rejected</div>
      <div class="kpi-value">${rejected}</div>
    </div>
    <div class="glass-card kpi-tile">
      <div class="kpi-label">Total</div>
      <div class="kpi-value">${state.requests.length}</div>
    </div>
  `;

  const badge = document.getElementById('onboarding-badge');
  if (badge) {
    badge.textContent = pending;
    badge.style.display = pending > 0 ? '' : 'none';
  }

  const tbody = document.querySelector('#ob-table tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No ${state.filter === 'all' ? '' : state.filter + ' '}requests.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((r) => {
    const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const statusColor = r.status === 'approved' ? 'var(--status-online,#16a34a)' : r.status === 'rejected' ? 'var(--status-offline,#dc2626)' : 'var(--status-degraded,#d97706)';
    return `
      <tr>
        <td><strong>${escapeHtml(r.businessName || '—')}</strong></td>
        <td>${escapeHtml(r.outletName || '—')}</td>
        <td>${escapeHtml(r.contactPhone || '—')}${r.contactEmail ? `<br><span style="color:var(--text-secondary);font-size:12px">${escapeHtml(r.contactEmail)}</span>` : ''}</td>
        <td>${escapeHtml(r.adminEmail || '—')}</td>
        <td><span class="transport-badge">${escapeHtml(r.plan || 'starter')}</span></td>
        <td style="white-space:nowrap">${date}</td>
        <td><span class="transport-badge" style="color:${statusColor};background:${statusColor}18">${escapeHtml(r.status)}</span></td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-action="ob-view" data-key="${r.key}">View</button>
          ${r.status === 'pending' && !isReadOnly() ? `
            <button class="btn btn-primary btn-sm" data-action="ob-approve" data-key="${r.key}">Approve</button>
            <button class="btn btn-ghost btn-sm" data-action="ob-reject" data-key="${r.key}">Reject</button>
          ` : ''}
        </td>
      </tr>`;
  }).join('');
}

function viewRequest(key) {
  const r = state.requests.find((x) => x.key === key);
  if (!r) return;
  const date = r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
  showConfirm({
    title: r.businessName || 'Onboarding Request',
    body: `
      <div style="text-align:left;font-size:14px;line-height:1.8">
        <strong>Business:</strong> ${escapeHtml(r.businessName || '—')}<br>
        <strong>Outlet:</strong> ${escapeHtml(r.outletName || '—')}<br>
        <strong>Phone:</strong> ${escapeHtml(r.contactPhone || '—')}<br>
        <strong>Email:</strong> ${escapeHtml(r.contactEmail || '—')}<br>
        <strong>Admin Email:</strong> ${escapeHtml(r.adminEmail || '—')}<br>
        <strong>Plan:</strong> ${escapeHtml(r.plan || 'starter')}<br>
        <strong>WhatsApp:</strong> ${escapeHtml(r.whatsappConnect || 'qr')}<br>
        <strong>Template:</strong> ${escapeHtml(r.template || 'none')}<br>
        <strong>Date:</strong> ${date}<br>
        <strong>Status:</strong> ${escapeHtml(r.status)}
        ${r.rejectReason ? `<br><strong>Reject Reason:</strong> ${escapeHtml(r.rejectReason)}` : ''}
      </div>
    `,
    confirmLabel: 'Close',
    showCancel: false,
  });
}

async function approveRequest(key) {
  const r = state.requests.find((x) => x.key === key);
  if (!r) return;

  const ok = await showConfirm({
    title: 'Approve Onboarding',
    body: `
      <div style="text-align:left;font-size:14px;line-height:1.8">
        This will create a new outlet for <strong>${escapeHtml(r.businessName)}</strong>:<br><br>
        • Firebase Auth user for <strong>${escapeHtml(r.adminEmail)}</strong><br>
        • Outlet record with billing defaults<br>
        • 15 free welcome tokens<br>
        • Locked state (admin can log in but can't use until unlocked)<br><br>
        The admin will need to be unlocked separately after approval.
      </div>
    `,
    confirmLabel: 'Approve & Create Outlet',
  });
  if (!ok) return;

  try {
    const token = await firebase.auth().currentUser.getIdToken();
    const res = await fetch(`${TUNNEL_URL}/api/admin/approve-onboarding`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reqKey: r.key,
        businessName: r.businessName,
        outletName: r.outletName,
        contactPhone: r.contactPhone,
        contactEmail: r.contactEmail,
        adminEmail: r.adminEmail,
        adminPassword: r.adminPassword,
        plan: r.plan,
        template: r.template,
        whatsappConnect: r.whatsappConnect,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Approval failed');

    showConfirm({
      title: 'Outlet Created ✅',
      body: `
        <div style="text-align:left;font-size:14px;line-height:1.8">
          <strong>Business:</strong> ${escapeHtml(r.businessName)}<br>
          <strong>Outlet:</strong> ${escapeHtml(r.outletName)}<br>
          <strong>Admin Email:</strong> ${escapeHtml(data.email)}<br>
          <strong>Password:</strong> <code>${escapeHtml(data.password)}</code><br>
          <strong>Login URL:</strong> <a href="${data.loginUrl}" target="_blank">${data.loginUrl}</a><br><br>
          <span style="color:var(--status-degraded,#d97706)">⚠️ The outlet is locked. Unlock it from the restaurant profile to grant access.</span>
        </div>
      `,
      confirmLabel: 'Done',
      showCancel: false,
    });
    showToast(`Outlet created for ${r.businessName}`, 'success');
  } catch (err) {
    console.error('approve failed', err);
    showToast(err.message || 'Approval failed — try again.', 'error');
  }
}

async function rejectRequest(key) {
  const r = state.requests.find((x) => x.key === key);
  if (!r) return;

  const reason = await showConfirm({
    title: 'Reject Application',
    body: `
      <div style="text-align:left">
        <p style="margin-bottom:12px">Reject <strong>${escapeHtml(r.businessName)}</strong>?</p>
        <label class="field-label" for="reject-reason">Reason (required)</label>
        <input class="text-input" id="reject-reason" placeholder="e.g. Duplicate registration, incomplete details…" style="width:100%" />
      </div>
    `,
    confirmLabel: 'Reject',
  });
  if (!reason) return;

  const reasonText = document.getElementById('reject-reason')?.value?.trim();
  if (!reasonText) {
    showToast('Rejection reason is required.', 'error');
    return;
  }

  try {
    await firebase.database().ref(`onboardingRequests/${key}`).update({
      status: 'rejected',
      rejectReason: reasonText,
      reviewedAt: Date.now(),
      reviewedBy: firebase.auth().currentUser.uid,
    });
    showToast('Application rejected.', 'success');
  } catch (err) {
    console.error('reject failed', err);
    showToast('Rejection failed — try again.', 'error');
  }
}
