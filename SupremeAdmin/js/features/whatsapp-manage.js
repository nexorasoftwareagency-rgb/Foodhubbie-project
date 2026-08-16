/**
 * WhatsApp number wizard + management (plan G4).
 *
 * Rendered inside the profile's WhatsApp section. Two connection paths:
 *   - Path B "platform-managed" — pure Bot Control API calls (list/add/
 *     verify/register/deregister), no Meta popups. Least taps.
 *   - Path A "Meta account" — existing Embedded Signup popup + server-side
 *     /api/whatsapp/exchange.
 * Once connected, the same card becomes a manage view (display number,
 * verified name, deregister).
 */
import { registerAction } from '/js/main.js';
import { isReadOnly } from '/js/data-store.js';

let state = null; // { bid, oid, step, wabas, wabaId, numbers, busy, err }

const VIEW_STEPS = {
  pick: { title: 'Connect an Official WhatsApp number' },
  numbers: { title: 'Choose or add a number' },
  verify: { title: 'Verify the number' },
};

async function api(path, { method = 'GET', body } = {}) {
  const token = await firebase.auth().currentUser.getIdToken();
  const res = await fetch(`${TUNNEL_URL}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res;
}

function render() {
  const el = document.getElementById('whatsapp-manage');
  if (!el) return;
  const readOnly = isReadOnly();
  const wa = state.wa || {};
  const connected = wa.status === 'active';

  el.innerHTML = `
    <div class="glass-card accent-edge" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong style="display:block">Official WhatsApp number</strong>
        ${connected && !readOnly ? `<button class="btn btn-ghost btn-sm" data-action="wa-deregister">Deregister</button>` : ''}
      </div>
      ${renderBody(connected, readOnly)}
    </div>
  `;
  refreshIcons(el);
}

function renderBody(connected, readOnly) {
  if (connected) {
    const wa = state.wa;
    return `
      <div style="color:var(--text-primary);line-height:2;font-size:13px">
        <div>Number: <span class="mono">${escapeHtml(wa.displayPhoneNumber || wa.phoneNumberId)}</span></div>
        ${wa.verifiedName ? `<div>Verified name: ${escapeHtml(wa.verifiedName)}</div>` : ''}
        <div>Phone number ID: <span class="mono">${escapeHtml(wa.phoneNumberId || '—')}</span></div>
        ${wa.wabaId ? `<div>WABA ID: <span class="mono">${escapeHtml(wa.wabaId)}</span></div>` : ''}
      </div>`;
  }

  if (readOnly) {
    return `<div style="color:var(--text-secondary);font-size:13px">No Official WhatsApp number linked. View-only accounts can't connect one.</div>`;
  }

  if (state.err) {
    return `<div style="color:var(--status-offline,#f87171);font-size:13px;margin-bottom:10px">${escapeHtml(state.err)}</div>${renderActions()}`;
  }
  if (state.busy) {
    return `<div style="color:var(--text-secondary);font-size:13px">${escapeHtml(state.busy)}</div>`;
  }

  // Step machine
  if (!state.step) {
    return `
      <div style="color:var(--text-secondary);font-size:13px;line-height:1.8">
        Connect the restaurant's Official WhatsApp number. You can manage a number the platform already holds, or add a new one the restaurant owns.
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary" data-action="wa-pick">Connect a number</button>
        <button class="btn btn-ghost" data-action="wa-meta">Connect a Meta account (popup)</button>
      </div>`;
  }
  if (state.step === 'pick') {
    const wabas = state.wabas || [];
    return `
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">Step 1 of 3 — which WhatsApp Business account (WABA)?</div>
      ${wabas.length
        ? `<select class="text-input" id="wa-waba"><option value="">Select a WABA…</option>${wabas.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`).join('')}</select>
           <div style="margin-top:10px;display:flex;gap:8px">
             <button class="btn btn-primary btn-sm" data-action="wa-waba-next">Next</button>
             <button class="btn btn-ghost btn-sm" data-action="wa-reset">Back</button>
           </div>`
        : `<div style="color:var(--text-secondary)">No WABA found for this platform account. Set WABA_ID on the server, or use the Meta popup.</div>
           <button class="btn btn-ghost btn-sm" data-action="wa-reset" style="margin-top:10px">Back</button>`}`;
  }
  if (state.step === 'numbers') {
    const nums = state.numbers || [];
    return `
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">Step 2 of 3 — pick an existing number or add one the restaurant owns.</div>
      ${nums.length
        ? `<select class="text-input" id="wa-number"><option value="">Select a number…</option>${nums.map((n) => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.display_phone_number)}${n.verified_name ? ` · ${escapeHtml(n.verified_name)}` : ''}</option>`).join('')}</select>
           <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
             <button class="btn btn-primary btn-sm" data-action="wa-number-next">Use this number</button>
             <button class="btn btn-ghost btn-sm" data-action="wa-add-toggle">Add a new number</button>
             <button class="btn btn-ghost btn-sm" data-action="wa-reset">Back</button>
           </div>`
        : `<div style="font-size:13px;color:var(--text-secondary)">No numbers on this WABA yet.</div>
           <button class="btn btn-ghost btn-sm" data-action="wa-add-toggle" style="margin-top:10px">Add a number</button>`}
      ${state.addForm ? `
        <div style="margin-top:14px;border-top:1px solid var(--glass-border);padding-top:12px;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:12px;color:var(--text-secondary)">Add a number the restaurant owns (proves ownership via SMS/voice code after).</div>
          <input type="text" class="text-input" id="wa-verified-name" placeholder="Verified name (e.g. My Restaurant)" />
          <input type="text" class="text-input" id="wa-display-phone" placeholder="Display phone number (e.g. +91 98765 43210)" />
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" data-action="wa-add-do">Add number</button>
            <button class="btn btn-ghost btn-sm" data-action="wa-add-toggle">Cancel</button>
          </div>
        </div>` : ''}`;
  }
  if (state.step === 'verify') {
    return `
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.8;margin-bottom:10px">
        Step 3 of 3 — prove ownership of <span class="mono">${escapeHtml(state.displayPhoneNumber || state.phoneNumberId)}</span>.
        We'll send an SMS/voice code to that number, then you register it (this sets the 2FA pin).
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button class="btn btn-ghost btn-sm" data-action="wa-code-sms">Send SMS code</button>
        <button class="btn btn-ghost btn-sm" data-action="wa-code-voice">Send voice code</button>
      </div>
      <div style="display:flex;gap:8px">
        <input type="text" class="text-input" id="wa-code" placeholder="6-digit code" maxlength="6" style="max-width:120px" />
        <button class="btn btn-primary btn-sm" data-action="wa-code-verify">Verify</button>
        <button class="btn btn-ghost btn-sm" data-action="wa-reset">Back</button>
      </div>
      <div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">After verification the number registers with a 6-digit 2FA pin auto-generated by us.</div>`;
  }
  return '';
}

function renderActions() {
  return `<button class="btn btn-ghost btn-sm" data-action="wa-reset">Back</button>`;
}

function setState(patch, rerender = true) {
  state = { ...state, ...patch };
  if (rerender) render();
}

export function mount(bid, oid, wa) {
  // Called on every live re-render (30s tick + writes). Preserve any wizard
  // state already in flight for this outlet; only reset when the outlet or
  // the connected state changes.
  const sameOutlet = state && state.bid === bid && state.oid === oid;
  const connected = wa?.status === 'active';
  if (sameOutlet && state.connected === connected) {
    state = { ...state, wa };
    render();
    return;
  }
  state = { bid, oid, wa, connected, step: null, wabas: null, numbers: null, addForm: false, busy: null, err: null };
  render();
}

export async function loadNumbers(bid, oid) {
  const res = await api(`/whatsapp/numbers/${bid}/${oid}`);
  return res.ok ? res.json() : { numbers: [], wabaId: null };
}

let actionsRegistered = false;

export function registerActions() {
  if (actionsRegistered) return;
  actionsRegistered = true;
  const s = () => state;

  registerAction('wa-pick', async () => {
    setState({ busy: 'Listing WhatsApp accounts…', err: null });
    try {
      const res = await api(`/whatsapp/accounts/${s().bid}/${s().oid}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `bot-control-api returned ${res.status}`);
      }
      const { wabas } = await res.json();
      setState({ wabas, step: 'pick', busy: null });
    } catch (err) {
      setState({ busy: null, err: err.message });
    }
  });

  registerAction('wa-meta', () => {
    import('/js/features/whatsapp-linking.js').then(({ launchWhatsAppSignup }) => {
      launchWhatsAppSignup(s().bid, s().oid, {});
    });
  });

  registerAction('wa-waba-next', async () => {
    const wabaId = document.getElementById('wa-waba')?.value;
    if (!wabaId) return showToast('Select a WABA first.', 'error');
    setState({ wabaId, step: 'numbers', busy: null, err: null });
    await refreshNumbers();
  });

  registerAction('wa-number-next', () => {
    const pnid = document.getElementById('wa-number')?.value;
    if (!pnid) return showToast('Select a number first.', 'error');
    setState({ phoneNumberId: pnid, step: 'verify', busy: null });
  });

  registerAction('wa-add-toggle', () => setState({ addForm: !s().addForm }));

  registerAction('wa-add-do', async () => {
    const verified_name = document.getElementById('wa-verified-name')?.value.trim();
    const display_phone_number = document.getElementById('wa-display-phone')?.value.trim();
    if (!verified_name || !display_phone_number) return showToast('Verified name and phone number are required.', 'error');
    setState({ busy: 'Adding number to the WABA…' });
    try {
      const res = await api(`/whatsapp/numbers/${s().bid}/${s().oid}`, {
        method: 'POST',
        body: { verified_name, display_phone_number, wabaId: s().wabaId },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `bot-control-api returned ${res.status}`);
      }
      const { phoneNumberId } = await res.json();
      setState({ phoneNumberId, addForm: false, busy: null, step: 'verify' });
    } catch (err) {
      setState({ busy: null, err: err.message });
    }
  });

  registerAction('wa-code-sms', () => sendCode('sms'));
  registerAction('wa-code-voice', () => sendCode('voice'));

  registerAction('wa-code-verify', async () => {
    const code = document.getElementById('wa-code')?.value.trim();
    if (!code) return showToast('Enter the code you received.', 'error');
    setState({ busy: 'Verifying code…' });
    try {
      const res = await api(`/whatsapp/numbers/${s().bid}/${s().oid}/${s().phoneNumberId}/verify-code`, {
        method: 'POST',
        body: { code },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `bot-control-api returned ${res.status}`);
      }
      setState({ busy: 'Registering number…' });
      const pin = String(Math.floor(100000 + Math.random() * 900000));
      const reg = await api(`/whatsapp/numbers/${s().bid}/${s().oid}/${s().phoneNumberId}/register`, {
        method: 'POST',
        body: { pin, wabaId: s().wabaId },
      });
      if (!reg.ok) {
        const body = await reg.json().catch(() => ({}));
        throw new Error(body.error || `bot-control-api returned ${reg.status}`);
      }
      setState({ busy: null, step: null });
      showToast('WhatsApp number connected. The bot will restart on the Official API.', 'success');
    } catch (err) {
      setState({ busy: null, err: err.message });
    }
  });

  registerAction('wa-deregister', async () => {
    const ok = await showConfirm({
      title: 'Deregister this WhatsApp number?',
      body: 'Stops Cloud API usage for this number and removes it from this outlet. The restaurant\'s WhatsApp Web pairing (if any) is unaffected.',
      confirmLabel: 'Deregister',
      danger: true,
    });
    if (!ok) return;
    setState({ busy: 'Deregistering…' });
    try {
      const res = await api(`/whatsapp/numbers/${s().bid}/${s().oid}/${s().wa.phoneNumberId}/deregister`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `bot-control-api returned ${res.status}`);
      }
      setState({ busy: null, step: null, wa: {} });
      showToast('Number deregistered.', 'success');
    } catch (err) {
      setState({ busy: null, err: err.message });
    }
  });

  registerAction('wa-reset', () => {
    setState({ step: null, wabas: null, numbers: null, addForm: false, busy: null, err: null });
  });

  async function sendCode(method) {
    setState({ busy: `Sending ${method.toUpperCase()} code…` });
    try {
      const res = await api(`/whatsapp/numbers/${s().bid}/${s().oid}/${s().phoneNumberId}/request-code`, {
        method: 'POST',
        body: { method },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `bot-control-api returned ${res.status}`);
      }
      setState({ busy: null });
      showToast(`${method.toUpperCase()} code sent.`, 'success');
    } catch (err) {
      setState({ busy: null, err: err.message });
    }
  }

  async function refreshNumbers() {
    setState({ busy: 'Loading numbers…' });
    try {
      const res = await api(`/whatsapp/numbers/${s().bid}/${s().oid}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `bot-control-api returned ${res.status}`);
      }
      const { numbers } = await res.json();
      setState({ numbers, busy: null });
    } catch (err) {
      setState({ busy: null, err: err.message });
    }
  }
}
