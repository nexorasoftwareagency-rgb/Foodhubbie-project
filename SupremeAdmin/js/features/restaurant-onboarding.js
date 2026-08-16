import { navigate, registerAction } from '/js/main.js';

const mainEl = document.getElementById('app-main');

export async function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Add Restaurant</h1>
        <div class="panel-sub">Creates the business + outlet record, then connects WhatsApp</div>
      </div>
    </div>

    <div class="section-two-col">
      <div class="glass-card">
        <form id="onboard-form">
          <div class="field-group">
            <label class="field-label">Business name</label>
            <input class="text-input" name="businessName" required placeholder="e.g. My Restaurant" />
          </div>
          <div class="field-group">
            <label class="field-label">Outlet name</label>
            <input class="text-input" name="outletName" required placeholder="e.g. My Restaurant — Boring Road" />
          </div>
          <div class="field-group">
            <label class="field-label">Contact phone</label>
            <input class="text-input" name="contactPhone" required placeholder="+91…" />
          </div>
          <div class="field-group">
            <label class="field-label">Contact email</label>
            <input class="text-input" type="email" name="contactEmail" placeholder="owner@restaurant.com" />
          </div>
          <div class="field-group">
            <label class="field-label">Start from a template</label>
            <select class="text-input" name="template" id="onboard-template">
              <option value="">Loading templates…</option>
            </select>
            <div id="template-hint" style="font-size:12px;color:var(--text-secondary);margin-top:6px"></div>
          </div>
          <div class="field-group">
            <label class="field-label">Plan / tier</label>
            <select class="text-input" name="plan">
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div class="field-group">
            <label class="field-label">WhatsApp connection</label>
            <div style="display:flex;flex-direction:column;gap:8px">
              <label class="radio-option">
                <input type="radio" name="connect" value="qr" checked />
                <span><strong>WhatsApp Web (QR)</strong> — fastest. Reuses the restaurant's existing WhatsApp number; scan a QR to pair. No Meta account needed.</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="connect" value="meta" />
                <span><strong>Official API (Meta)</strong> — needs a WhatsApp Business number and the Meta signup popup.</span>
              </label>
            </div>
          </div>
          <button class="btn btn-primary" type="submit" id="onboard-submit">
            <svg data-lucide="arrow-right"></svg> Create restaurant
          </button>
        </form>
      </div>

      <div class="glass-card" style="font-size:13px;color:var(--text-secondary)">
        <strong style="color:var(--text-primary);display:block;margin-bottom:8px">What happens next</strong>
        <ol style="margin:0;padding-left:18px;line-height:1.9">
          <li>This writes <span class="mono">businesses/&#123;bid&#125;</span> and <span class="mono">outlets/&#123;oid&#125;</span> to Firebase.</li>
          <li>QR path: a bot worker is created on EC2 automatically, then a QR appears to scan on the restaurant's WhatsApp.</li>
          <li>Meta path: the Embedded Signup popup opens to link the restaurant's WhatsApp Business number.</li>
          <li>You land on the restaurant's profile where the remaining connection steps continue.</li>
        </ol>
      </div>
    </div>
  `;
  refreshIcons(mainEl);

  loadTemplates();

  document.getElementById('onboard-template').addEventListener('change', (e) => {
    const hint = document.getElementById('template-hint');
    const tpl = templateCache[e.target.value];
    hint.textContent = tpl ? `${tpl.name} — ${tpl.description || ''}` : '';
  });

  document.getElementById('onboard-form').addEventListener('submit', handleSubmit);
}

// Templates live at appTemplates/{key} (seeded by tools/seed-templates.cjs).
// Load once per render; the select is rebuilt from what Firebase returns so a
// new template added on the server shows up without a dashboard redeploy.
let templateCache = {};
async function loadTemplates() {
  templateCache = {};
  try {
    const snap = await firebase.database().ref('appTemplates').once('value');
    const data = snap.val() || {};
    const sel = document.getElementById('onboard-template');
    if (!sel) return;
    // Only restaurant-shape templates (those carrying `defaults`) are pickable
    // on onboarding; the WhatsApp template library is a different shape used
    // by the profile card and must not appear here.
    const opts = Object.entries(data)
      .filter(([, tpl]) => tpl && tpl.defaults)
      .map(([key, tpl]) => `<option value="${escapeHtml(key)}">${escapeHtml(tpl.name || key)}</option>`)
      .join('');
    sel.innerHTML = `<option value="">Custom (no template)</option>${opts}`;
    templateCache = Object.fromEntries(Object.entries(data).filter(([, tpl]) => tpl && tpl.defaults));
  } catch (err) {
    console.error('load templates failed', err);
    const sel = document.getElementById('onboard-template');
    if (sel) sel.innerHTML = `<option value="">Custom (no template)</option>`;
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('onboard-submit');
  const data = Object.fromEntries(new FormData(form).entries());

  if (!data.businessName?.trim() || !data.outletName?.trim() || !data.contactPhone?.trim()) {
    showToast('Business name, outlet name, and contact phone are required.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="btn-spinner"></span> Creating…`;
  refreshIcons(submitBtn);

  try {
    const db = firebase.database();
    const bizRef = db.ref('businesses').push();
    const bid = bizRef.key;
    const outletRef = db.ref(`businesses/${bid}/outlets`).push();
    const oid = outletRef.key;

    // Single atomic multi-path update — either both the business and its
    // outlet land together, or neither does. The previous version did two
    // separate .set() calls; a failure between them left an orphaned
    // businesses/{bid} record with no outlet under it, and no rollback.
    await db.ref().update({
      [`businesses/${bid}`]: {
        name: data.businessName.trim(),
        contactPhone: data.contactPhone.trim(),
        contactEmail: data.contactEmail?.trim() || null,
        plan: data.plan,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      },
      [`businesses/${bid}/outlets/${oid}`]: {
        name: data.outletName.trim(),
        contactPhone: data.contactPhone.trim(),
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        whatsapp: { status: 'pending' },
        ...(data.template && templateCache[data.template]?.defaults
          ? templateCache[data.template].defaults
          : {}),
      },
    });

    showToast('Restaurant created. Connecting WhatsApp…', 'success');

    if (data.connect === 'meta') {
      const { launchWhatsAppSignup } = await import('/js/features/whatsapp-linking.js');
      await launchWhatsAppSignup(bid, oid, { onComplete: () => navigate(`profile/${bid}/${oid}`) });
    } else {
      // QR path: provision the EC2 bot worker right away (idempotent), then
      // land on the profile where the QR pair flow continues. The profile's
      // "Scan WhatsApp Web QR" button opens the modal.
      try {
        const token = await firebase.auth().currentUser.getIdToken();
        const res = await fetch(`${TUNNEL_URL}/api/bot/provision/${bid}/${oid}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          let detail = '';
          try { const body = await res.json(); detail = body.error || ''; } catch (_) {}
          showToast(`Bot worker start failed — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
        } else {
          showToast('Bot worker created on EC2.', 'success');
        }
      } catch (err) {
        console.error('provision failed during onboarding', err);
        showToast('Bot worker could not be started — see the profile to retry.', 'error');
      }
      navigate(`profile/${bid}/${oid}`);
    }
  } catch (err) {
    console.error('Onboarding failed', err);
    showToast('Could not create the restaurant — check the console for details.', 'error');
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<svg data-lucide="arrow-right"></svg> Create restaurant`;
    refreshIcons(submitBtn);
  }
}
