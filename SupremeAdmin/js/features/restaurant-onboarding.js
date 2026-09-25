import { navigate, registerAction } from '/js/main.js';
import { refreshIcons, escapeHtml, showToast } from '/js/utils.js';

const mainEl = document.getElementById('app-main');

export async function render() {
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Add Restaurant</h1>
        <div class="panel-sub">Creates the business + outlet record, the restaurant admin login, then connects WhatsApp</div>
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
            <label class="field-label">Restaurant Admin login — username (email)</label>
            <input class="text-input" type="email" name="adminEmail" placeholder="admin@restaurant.com" />
          </div>
          <div class="field-group">
            <label class="field-label">Admin password</label>
            <input class="text-input" type="password" name="adminPassword" placeholder="Min 6 characters" autocomplete="new-password" />
          </div>
          <div class="field-group">
            <label class="field-label">Confirm password</label>
            <input class="text-input" type="password" name="adminPasswordConfirm" placeholder="Repeat the password" autocomplete="new-password" />
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
          <li>A real Firebase Auth admin account is created with the username + password you set, so the owner can log into the Restaurant Admin dashboard.</li>
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

  const adminEmail = data.adminEmail?.trim();
  const adminPassword = data.adminPassword || '';
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    showToast('Enter a valid admin login email / username.', 'error');
    return;
  }
  if (adminPassword.length < 6) {
    showToast('Admin password must be at least 6 characters.', 'error');
    return;
  }
  if (adminPassword !== data.adminPasswordConfirm) {
    showToast('Admin passwords do not match.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="btn-spinner"></span> Creating…`;
  refreshIcons(submitBtn);

  try {
    const db = firebase.database();
    // Generate lowercase business/outlet ids: push() keys are mixed-case, but
    // the Admin app lowercases ids when resolving tenant paths (Admin/js/
    // firebase.js BUSINESS_ID/Outlet.current), and the seeded ids
    // (roshani-pizza/pizza) are lowercase — so an uppercase push key made a
    // new restaurant's Admin dashboard read/write a non-existent lowercase
    // path (0 orders, permission_denied on table/order writes). Lowercasing
    // the generated key keeps push-key uniqueness and matches the convention.
    const bid = db.ref('businesses').push().key.toLowerCase();
    const oid = db.ref(`businesses/${bid}/outlets`).push().key.toLowerCase();

    // Mirror the chosen template's categories + dishes into the platform-wide
    // menu bank (menuBank/{categories,dishes}), deduped by slug. Same atomic
    // update so the bank entries land with the restaurant or not at all.
    const _slug = (name) => String(name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
    const tplDefaults = data.template ? templateCache[data.template]?.defaults : null;
    const bankUpdates = {};
    if (tplDefaults) {
      Object.values(tplDefaults.categories || {}).forEach(c => {
        if (c && c.name) {
          bankUpdates[`menuBank/categories/${_slug(c.name)}`] = {
            ...c, sourceBid: bid, sourceOid: oid,
            updatedAt: firebase.database.ServerValue.TIMESTAMP,
          };
        }
      });
      Object.values(tplDefaults.dishes || {}).forEach(d => {
        if (d && d.name) {
          bankUpdates[`menuBank/dishes/${_slug(`${d.name}-${d.category || 'other'}`)}`] = {
            ...d, sourceBid: bid, sourceOid: oid,
            updatedAt: firebase.database.ServerValue.TIMESTAMP,
          };
        }
      });
    }

    // Single atomic multi-path update — either both the business and its
    // outlet land together, or neither does. The outlet must be nested under
    // the business key (not a sibling path): Firebase rejects one update whose
    // keys contain an ancestor/descendant pair. The previous version did two
    // separate .set() calls; a failure between them left an orphaned
    // businesses/{bid} record with no outlet under it, and no rollback.
    await db.ref().update({
      [`businesses/${bid}`]: {
        name: data.businessName.trim(),
        contactPhone: data.contactPhone.trim(),
        contactEmail: data.contactEmail?.trim() || null,
        plan: data.plan,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        outlets: {
          [oid]: {
            name: data.outletName.trim(),
            contactPhone: data.contactPhone.trim(),
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            whatsapp: { status: 'pending' },
            ...(tplDefaults || {}),
          },
        },
      },
      ...bankUpdates,
    });

    // Auto-convert default status images to PNG base64 for fast sending
    // (non-blocking — failures just mean status updates will use URL fallback)
    if (tplDefaults?.bot) {
      const statusImageKeys = ['imgPlaced', 'imgConfirmed', 'imgReady', 'imgOut', 'imgDelivered'];
      const imagesToConvert = statusImageKeys
        .filter(k => tplDefaults.bot[k])
        .map(k => ({ key: `${k}Png`, url: tplDefaults.bot[k] }));
      if (imagesToConvert.length > 0) {
        try {
          const token = await firebase.auth().currentUser.getIdToken();
          const res = await fetch(`${TUNNEL_URL}/api/images/convert-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ images: imagesToConvert }),
          });
          if (res.ok) {
            const { results } = await res.json();
            const pngUpdates = {};
            for (const [key, result] of Object.entries(results)) {
              if (result.ok) {
                pngUpdates[`businesses/${bid}/outlets/${oid}/bot/${key}`] = result.base64;
              }
            }
            if (Object.keys(pngUpdates).length > 0) {
              await db.ref().update(pngUpdates);
              console.log(`[Onboarding] Pre-converted ${Object.keys(pngUpdates).length} status images for ${bid}/${oid}`);
            }
          }
        } catch (e) {
          console.warn('[Onboarding] Image pre-conversion failed (non-fatal):', e.message);
        }
      }
    }

    showToast('Restaurant created. Creating admin login…', 'success');

    // Create the restaurant's real Firebase Auth admin (username = email).
    // Same server endpoint the profile's "Update password" card uses — it
    // creates the Auth user if missing, then syncs admins/{uid} + adminLogin.
    try {
      const token = await firebase.auth().currentUser.getIdToken();
      const res = await fetch(`${TUNNEL_URL}/api/admin/update-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bid, oid, email: adminEmail, newPassword: adminPassword }),
      });
      if (res.ok) {
        showToast('Restaurant admin login created.', 'success');
      } else {
        let detail = '';
        try { const body = await res.json(); detail = body.error || ''; } catch (_) {}
        showToast(`Restaurant created, but admin login failed — ${detail || `bot-control-api returned ${res.status}.`}`, 'error');
      }
    } catch (err) {
      console.error('admin creation failed during onboarding', err);
      showToast('Restaurant created, but admin login could not be created — set it on the profile.', 'error');
    }

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
