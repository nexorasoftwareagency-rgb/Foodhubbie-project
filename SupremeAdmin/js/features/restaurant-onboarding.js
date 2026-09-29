import { navigate } from '/js/main.js';
import { refreshIcons, escapeHtml, showToast } from '/js/utils.js';
import { getBillingDefaults } from '/shared/billing-defaults.js';

const mainEl = document.getElementById('app-main');

// Multi-step wizard: one <form>, sections toggled with [hidden] so typed
// values persist across steps for free. The final step runs the original
// atomic create flow unchanged (see handleSubmit).
const STEPS = ['Business', 'Plan', 'Admin login', 'WhatsApp', 'Review'];
let step = 0;

// Plan tiers keep the stored values (starter/growth/enterprise) that the
// Restaurants list filter and profile editor already use — only the
// presentation is new. Pricing shown once above the cards: billing rates
// (₹1–5/order, ₹500 setup) are identical on every tier.
const PLANS = [
  {
    value: 'starter', name: 'Starter', tag: 'Single outlet',
    desc: 'Launch one outlet with the full core stack — QR ordering, POS and reports. Pay per order, no monthly lock-in.',
    bullets: ['QR menu & table ordering', 'POS billing + kitchen display', 'Reports & analytics', 'Standard onboarding'],
  },
  {
    value: 'growth', name: 'Growth', tag: 'Most popular',
    desc: 'Sell on every channel: add WhatsApp ordering, delivery webview and compliant promo broadcasts to the core stack.',
    bullets: ['Everything in Starter', 'WhatsApp ordering (QR or Official API)', 'Delivery webview & status alerts', 'Promo broadcasts + menu templates'],
  },
  {
    value: 'enterprise', name: 'Enterprise', tag: 'Chains & franchises',
    desc: 'Roll out many outlets from one place with dedicated onboarding and terms sized to your volume.',
    bullets: ['Everything in Growth', 'Multi-outlet rollout from shared menu bank', 'Migration & dedicated onboarding', 'Custom volume rates'],
  },
];

export async function render() {
  step = 0;
  mainEl.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Add Restaurant</h1>
        <div class="panel-sub">Five short steps: business, plan, admin login, WhatsApp — then review and create.</div>
      </div>
    </div>

    <div class="glass-card" style="max-width:780px;margin:0 auto">
      <div id="obw-stepper">${stepperHtml()}</div>

      <form id="onboard-form" novalidate>
        <section data-step="0">
          <h2 style="font-size:16px;margin:0 0 4px">Business details</h2>
          <div class="panel-sub" style="margin-bottom:16px">Who this restaurant is and how to reach them.</div>
          <div class="field-group">
            <label class="field-label" for="obw-business">Business name</label>
            <input class="text-input" id="obw-business" name="businessName" placeholder="e.g. Sharma Pizza House" />
          </div>
          <div class="field-group">
            <label class="field-label" for="obw-outlet">Outlet name</label>
            <input class="text-input" id="obw-outlet" name="outletName" placeholder="e.g. Sharma Pizza House — FC Road" />
          </div>
          <div class="obw-pair">
            <div class="field-group">
              <label class="field-label" for="obw-phone">Contact phone</label>
              <input class="text-input" id="obw-phone" name="contactPhone" placeholder="+91…" />
            </div>
            <div class="field-group">
              <label class="field-label" for="obw-email">Contact email <span style="color:var(--text-tertiary)">(optional)</span></label>
              <input class="text-input" id="obw-email" name="contactEmail" type="email" placeholder="owner@restaurant.com" />
            </div>
          </div>
        </section>

        <section data-step="1" hidden>
          <h2 style="font-size:16px;margin:0 0 4px">Plan &amp; starting menu</h2>
          <div class="panel-sub" style="margin-bottom:6px">Flat <strong>₹1–5 per order</strong> on every plan · one-time setup <strong>₹500</strong> — non-refundable, adjusted in your first bill.</div>
          <div class="panel-sub" style="margin-bottom:14px">Pick the service tier that fits how this restaurant will operate. You can change it later from the profile.</div>
          <div class="obw-grid" style="margin-bottom:16px">
            ${PLANS.map((p, i) => `
              <label class="plan-pick">
                <input type="radio" name="plan" value="${p.value}" ${i === 0 ? 'checked' : ''} />
                <div class="plan-pick-head"><span class="plan-pick-name">${p.name}</span><span class="plan-pick-tag">${p.tag}</span></div>
                <div class="plan-pick-desc">${p.desc}</div>
                <ul class="plan-pick-list">${p.bullets.map((b) => `<li>${b}</li>`).join('')}</ul>
              </label>`).join('')}
          </div>
          <div class="field-group">
            <label class="field-label" for="onboard-template">Start from a menu template</label>
            <select class="text-input" name="template" id="onboard-template">
              <option value="">Loading templates…</option>
            </select>
            <div id="template-hint" style="font-size:12px;color:var(--text-secondary);margin-top:6px"></div>
          </div>
        </section>

        <section data-step="2" hidden>
          <h2 style="font-size:16px;margin:0 0 4px">Restaurant admin login</h2>
          <div class="panel-sub" style="margin-bottom:16px">Creates the owner's account for the Restaurant Admin dashboard — username and password work immediately after setup.</div>
          <div class="field-group">
            <label class="field-label" for="obw-admin-email">Username (email)</label>
            <input class="text-input" id="obw-admin-email" type="email" name="adminEmail" autocomplete="username" placeholder="admin@restaurant.com" />
          </div>
          <div class="obw-pair">
            <div class="field-group">
              <label class="field-label" for="obw-admin-pw">Password</label>
              <input class="text-input" id="obw-admin-pw" type="password" name="adminPassword" placeholder="Min 6 characters" autocomplete="new-password" />
            </div>
            <div class="field-group">
              <label class="field-label" for="obw-admin-pw2">Confirm password</label>
              <input class="text-input" id="obw-admin-pw2" type="password" name="adminPasswordConfirm" placeholder="Repeat the password" autocomplete="new-password" />
            </div>
          </div>
        </section>

        <section data-step="3" hidden>
          <h2 style="font-size:16px;margin:0 0 4px">WhatsApp connection</h2>
          <div class="panel-sub" style="margin-bottom:16px">How this restaurant will take WhatsApp orders and send notifications. Both can be switched later from the profile.</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label class="radio-option">
              <input type="radio" name="connect" value="qr" checked />
              <span><strong>WhatsApp Web (QR)</strong> — fastest. Reuses the restaurant's existing WhatsApp number; scan a QR to pair. No Meta account needed.</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="connect" value="meta" />
              <span><strong>Official API (Meta)</strong> — zero ban risk and promo-ready. Needs a WhatsApp Business number and the Meta signup popup.</span>
            </label>
          </div>
        </section>

        <section data-step="4" hidden>
          <h2 style="font-size:16px;margin:0 0 4px">Review &amp; create</h2>
          <div class="panel-sub" style="margin-bottom:14px">Everything below is written in one atomic step — business, outlet and menu bank together.</div>
          <div id="obw-review" class="glass-card" style="padding:12px 16px;margin-bottom:14px"></div>
          <div class="glass-card" style="font-size:13px;color:var(--text-secondary)">
            <strong style="color:var(--text-primary);display:block;margin-bottom:8px">What happens next</strong>
            <ol style="margin:0;padding-left:18px;line-height:1.9">
              <li>The business + outlet records and the admin login are created.</li>
              <li>QR path: a bot worker starts on EC2, then scan the QR from the profile to pair WhatsApp.</li>
              <li>Meta path: the Embedded Signup popup links the restaurant's WhatsApp Business number.</li>
              <li>You land on the restaurant's profile where the remaining connection steps continue.</li>
            </ol>
          </div>
        </section>

        <div class="obw-footer">
          <span class="panel-sub" id="obw-count">Step 1 of ${STEPS.length}</span>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn btn-ghost" id="obw-back" hidden>
              <svg data-lucide="arrow-left"></svg> Back
            </button>
            <button type="submit" class="btn btn-primary" id="onboard-submit">
              <svg data-lucide="arrow-right"></svg> Next
            </button>
          </div>
        </div>
      </form>
    </div>
  `;
  refreshIcons(mainEl);

  loadTemplates();

  document.getElementById('onboard-template').addEventListener('change', (e) => {
    const hint = document.getElementById('template-hint');
    const tpl = templateCache[e.target.value];
    hint.textContent = tpl ? `${tpl.name} — ${tpl.description || ''}` : '';
  });

  document.getElementById('obw-back').addEventListener('click', () => goStep(step - 1));
  document.getElementById('onboard-form').addEventListener('submit', onSubmit);
}

function stepperHtml() {
  return `<div class="onboard-stepper" role="list" aria-label="Setup progress">
    ${STEPS.map((label, i) => {
      const state = i < step ? 'done' : i === step ? 'current' : 'pending';
      return `
        <div class="onboard-step state-${state}" role="listitem" ${i === step ? 'aria-current="step"' : ''}>
          <div class="onboard-step-dot">${i < step ? '<svg data-lucide="check"></svg>' : i + 1}</div>
          <div class="onboard-step-label">${label}</div>
        </div>
        ${i < STEPS.length - 1 ? '<div class="onboard-step-line"></div>' : ''}`;
    }).join('')}
  </div>`;
}

function goStep(next) {
  if (next < 0 || next >= STEPS.length) return;
  step = next;
  document.getElementById('obw-stepper').innerHTML = stepperHtml();
  document.querySelectorAll('#onboard-form > section[data-step]').forEach((sec) => {
    sec.hidden = Number(sec.dataset.step) !== step;
  });
  const count = document.getElementById('obw-count');
  if (count) count.textContent = `Step ${step + 1} of ${STEPS.length}`;
  const back = document.getElementById('obw-back');
  if (back) back.hidden = step === 0;
  const submit = document.getElementById('onboard-submit');
  if (submit && step < STEPS.length - 1) {
    submit.innerHTML = `<svg data-lucide="arrow-right"></svg> Next`;
  }
  if (step === STEPS.length - 1) {
    if (submit) submit.innerHTML = `<svg data-lucide="check"></svg> Create restaurant`;
    renderReview();
  }
  const first = document.querySelector(`#onboard-form > section[data-step="${step}"] input, #onboard-form > section[data-step="${step}"] select`);
  if (first) first.focus({ preventScroll: true });
  refreshIcons(mainEl);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateStep(s = step) {
  const form = document.getElementById('onboard-form');
  const data = Object.fromEntries(new FormData(form).entries());
  const fail = (msg, focusSel) => {
    showToast(msg, 'error');
    document.querySelector(focusSel)?.focus({ preventScroll: false });
    return false;
  };
  if (s === 0) {
    if (!data.businessName?.trim()) return fail('Business name is required.', '#obw-business');
    if (!data.outletName?.trim()) return fail('Outlet name is required.', '#obw-outlet');
    if (!data.contactPhone?.trim()) return fail('Contact phone is required.', '#obw-phone');
    if (data.contactEmail?.trim() && !EMAIL_RE.test(data.contactEmail.trim())) {
      return fail('Enter a valid contact email, or leave it blank.', '#obw-email');
    }
  }
  if (s === 2) {
    if (!data.adminEmail?.trim() || !EMAIL_RE.test(data.adminEmail.trim())) {
      return fail('Enter a valid admin login email / username.', '#obw-admin-email');
    }
    if ((data.adminPassword || '').length < 6) {
      return fail('Admin password must be at least 6 characters.', '#obw-admin-pw');
    }
    if (data.adminPassword !== data.adminPasswordConfirm) {
      return fail('Admin passwords do not match.', '#obw-admin-pw2');
    }
  }
  return true;
}

function renderReview() {
  const form = document.getElementById('onboard-form');
  const data = Object.fromEntries(new FormData(form).entries());
  const plan = PLANS.find((p) => p.value === data.plan) || PLANS[0];
  const tpl = data.template ? templateCache[data.template] : null;
  const row = (label, value) => `<div class="obw-row"><span>${label}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  document.getElementById('obw-review').innerHTML = `
    <div class="obw-row" style="border-bottom:none;padding-bottom:0"><span style="font-weight:700;color:var(--text-primary)">Restaurant</span><strong></strong></div>
    ${row('Business', data.businessName?.trim() || '—')}
    ${row('Outlet', data.outletName?.trim() || '—')}
    ${row('Phone', data.contactPhone?.trim() || '—')}
    ${row('Email', data.contactEmail?.trim() || '—')}
    <div class="obw-row" style="border-bottom:none;padding:14px 0 0"><span style="font-weight:700;color:var(--text-primary)">Setup</span><strong></strong></div>
    ${row('Plan', plan.name)}
    ${row('Menu template', tpl?.name || 'Custom (no template)')}
    ${row('Admin login', data.adminEmail?.trim() || '—')}
    ${row('Password', data.adminPassword ? '•'.repeat(Math.min(12, data.adminPassword.length)) : '—')}
    ${row('WhatsApp', data.connect === 'meta' ? 'Official API (Meta)' : 'WhatsApp Web (QR)')}
  `;
}

function onSubmit(e) {
  e.preventDefault();
  if (step < STEPS.length - 1) {
    if (validateStep()) goStep(step + 1);
    return;
  }
  handleSubmit(e);
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
  const adminEmail = data.adminEmail?.trim();
  const adminPassword = data.adminPassword || '';

  // Belt & braces: the create step only runs after every step validated on
  // the way here, but re-check so a tampered/DOM-edited form can't write junk.
  for (const check of [0, 2]) {
    if (!validateStep(check)) { goStep(check); return; }
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

    // Platform-wide outlet number used in order IDs (e.g. 03-161126-12).
    // Counter-first: a crash between here and the atomic update below only
    // leaves a number gap. Failure is non-fatal — order IDs fall back to the
    // raw outlet id.
    let outletNo = null;
    try {
      const noSnap = await db.ref('meta/outletCounter').runTransaction(cur => (cur || 0) + 1);
      outletNo = String(noSnap.snapshot.val() || '').padStart(2, '0') || null;
    } catch (e) {
      console.warn('[Onboarding] outletCounter failed (non-fatal):', e.message);
    }

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
            ...(outletNo ? { outletNo } : {}),
            whatsapp: { status: 'pending' },
            ...(tplDefaults || {}),
            // Billing defaults from shared module
            billing: getBillingDefaults(),
            // Feature flags default OFF for new restaurants (user scope answer).
            // Nested merge so a template's own settings AND feature flags
            // survive; our discountApproval flag still wins.
            settings: { ...(tplDefaults?.settings || {}), features: { ...(tplDefaults?.settings?.features || {}), discountApproval: false } },
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
      // Post-create step — kept out of the outer catch on purpose: by now the
      // restaurant EXISTS, so a linking failure must not report "Could not
      // create" (false) nor re-enable submit (a retry would write a duplicate
      // business). Navigate to the profile in every case: the popup is a
      // separate window that keeps working, and a cancelled popup never calls
      // onComplete, which would otherwise leave this form stuck disabled.
      try {
        const { launchWhatsAppSignup } = await import('/js/features/whatsapp-linking.js');
        await launchWhatsAppSignup(bid, oid);
      } catch (err) {
        console.error('meta linking failed during onboarding', err);
        showToast('Restaurant created, but WhatsApp linking could not start — continue from the profile.', 'error');
      }
      navigate(`profile/${bid}/${oid}`);
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
    submitBtn.innerHTML = `<svg data-lucide="check"></svg> Create restaurant`;
    refreshIcons(submitBtn);
  }
}
