/**
 * Onboarding Requests — #onboarding
 * Lists website signup applications. Supreme Admin approves (creates outlet
 * + Auth user via bot-control-api) or rejects (with reason).
 */
import { registerAction } from '/js/main.js';
import { isReadOnly } from '/js/data-store.js';
import { refreshIcons, escapeHtml, showConfirm, showToast } from '/js/utils.js';
import { statStrip } from '/js/table-tools.js';

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

    <div id="ob-kpis"></div>

    <div class="glass-card table-card">
      <table class="data-table" id="ob-table">
        <thead><tr><th scope="col">Business</th><th scope="col" class="col-sec">Outlet</th><th scope="col" class="col-sec">Contact</th><th scope="col" class="col-sec">Admin email</th><th scope="col" class="col-sec">Plan</th><th scope="col" class="col-sec">Date</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
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
  const expired = state.requests.filter((r) => r.status === 'expired').length;

  document.getElementById('ob-kpis').innerHTML = statStrip([
    { label: 'Pending', value: pending, tone: pending ? 'warn' : '', action: 'ob-filter', data: { filter: 'pending' }, active: state.filter === 'pending' },
    { label: 'Approved', value: approved, tone: approved ? 'good' : '', action: 'ob-filter', data: { filter: 'approved' }, active: state.filter === 'approved' },
    { label: 'Rejected', value: rejected, action: 'ob-filter', data: { filter: 'rejected' }, active: state.filter === 'rejected' },
    { label: 'Expired', value: expired, action: 'ob-filter', data: { filter: 'expired' }, active: state.filter === 'expired' },
    { label: 'Total', value: state.requests.length, action: 'ob-filter', data: { filter: 'all' }, active: state.filter === 'all' },
  ], 'ob-stats');
  const badge = document.getElementById('onboarding-badge');
  if (badge) {
    badge.textContent = pending;
    badge.style.display = pending > 0 ? '' : 'none';
  }

  const tbody = document.querySelector('#ob-table tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No ${state.filter === 'all' ? '' : state.filter + ' '}requests${state.filter === 'pending' ? ' waiting — you’re all caught up' : ''}.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((r) => {
    const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
    const statusColor = r.status === 'approved' ? 'var(--status-online,#16a34a)' : r.status === 'rejected' ? 'var(--status-offline,#dc2626)' : r.status === 'expired' ? 'var(--text-secondary,#6b7280)' : 'var(--status-degraded,#d97706)';
    return `
      <tr>
        <td><span class="cell-strong">${escapeHtml(r.businessName || '—')}</span><span class="sub">${escapeHtml(r.outletName || '—')} · ${escapeHtml(r.contactPhone || '—')} · ${date}</span></td>
        <td class="col-sec">${escapeHtml(r.outletName || '—')}</td>
        <td class="col-sec">${escapeHtml(r.contactPhone || '—')}${r.contactEmail ? `<div class="cell-meta">${escapeHtml(r.contactEmail)}</div>` : ''}</td>
        <td class="col-sec">${escapeHtml(r.adminEmail || '—')}</td>
        <td class="col-sec"><span class="transport-badge">${escapeHtml(r.plan || 'starter')}</span></td>
        <td class="col-sec" style="white-space:nowrap">${date}</td>
        <td><span class="transport-badge" style="color:${statusColor};background:${statusColor}18">${escapeHtml(r.status)}</span></td>
        <td class="ob-actions">
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
        ${r.expireReason ? `<br><strong>Expired:</strong> ${escapeHtml(r.expireReason)}` : ''}
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
        • Dashboard login for <strong>${escapeHtml(r.adminEmail)}</strong> (uses the password chosen at signup)<br>
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
          <strong>Password:</strong> the one the owner chose at signup (never stored or shown here)<br>
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
    // A rejection only changes the request's status. The signup Auth account is
    // deliberately NOT deleted: `authUid` is written by an unauthenticated page,
    // so deleting from it would let anyone destroy another user's login. The
    // applicant keeps their account and can resubmit.
    await firebase.database().ref(`onboardingRequests/${key}`).update({
      status: 'rejected',
      rejectReason: reasonText,
      reviewedAt: Date.now(),
      reviewedBy: firebase.auth().currentUser.uid,
      adminPassword: null, // burn a legacy inline password, if one survives
    });
    // Burn the write-only legacy secret too (delete-only rule).
    await firebase.database().ref(`onboardingSecrets/${key}`).set(null).catch(() => {});
    showToast('Application rejected.', 'success');
  } catch (err) {
    console.error('reject failed', err);
    showToast('Rejection failed — try again.', 'error');
  }
}
