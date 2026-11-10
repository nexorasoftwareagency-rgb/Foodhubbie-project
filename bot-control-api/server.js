/**
 * Bot Control API
 * Lives at /var/www/foodhubbie/bot-control-api on the EC2 server —
 * NOT inside SupremeAdmin/. This is the only thing the dashboard is
 * allowed to talk to for PM2 process control; it never gets a direct
 * PM2 or SSH connection from the browser.
 *
 * Exposed through the existing Cloudflare Tunnel with a path-based
 * ingress split (/api/* -> :4000, /webhook* -> :5000, same tunnel —
 * do not stand up a second tunnel for this).
 *
 * Also boots the status watcher (status-watcher.js) on startup, which is
 * what makes the dashboard's bot status real-time instead of polled: it
 * listens to PM2's event bus and writes
 * businesses/{bid}/outlets/{oid}/botStatus straight to Firebase on every
 * state change, plus a capped rolling history for the sparklines. The
 * dashboard's Fleet/Profile pages just listen to Firebase — they no
 * longer call this API for status at all, only for restart/stop/quota.
 */

const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const waGraph = require('./whatsapp-graph');
const { pm2, connectOnce } = require('./pm2-client');
const { startStatusWatcher } = require('./status-watcher');
const { startWalletWatcher, publishWalletGate } = require('./wallet-watch');
const { startOrchestrator } = require('./orchestrator');
const { startMetaCostPublisher } = require('./meta-cost-publisher');
const sharp = require('sharp');
const crypto = require('crypto');
const { getBillingDefaults } = require('../shared/billing-defaults.cjs');
const { prunePushInbox } = require('../shared/push-inbox.cjs');
const { checkAndConsumeCap, setDatabase } = require('../bot/notification-caps');

const PORT = process.env.BOT_CONTROL_PORT || 4000;

// Dashboard and API are different origins (Firebase Hosting vs the
// Cloudflare Tunnel domain), and every dashboard request sends an
// Authorization header, so this needs real CORS handling — without it
// every restart/stop/reconnect/quota/bulk-restart call fails in the
// browser before it reaches any route below. Set DASHBOARD_ORIGIN to a
// comma-separated allowlist; the Admin and Supreme origins are always allowed.
const DASHBOARD_ORIGINS = (process.env.DASHBOARD_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)
  .concat(['https://foodhubbie-admins.web.app', 'https://foodhubbie-supremeadmin.web.app',
    'https://app.foodhubbie.in', 'https://control.foodhubbie.in']);

// Uses the same Firebase project as the dashboard and bot workers.
// Set GOOGLE_APPLICATION_CREDENTIALS or pass a service account explicitly.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  // Media bucket (batch 13). Passed here because admin.storage() throws
  // "Bucket name not specified" without it.
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'foodhubbie-10.firebasestorage.app',
});
// notification-caps resolves its OWN firebase-admin copy (bot/node_modules),
// which this initializeApp() never initializes - inject ours or every cap
// check at send time throws "The default Firebase app does not exist".
setDatabase(admin.database());

const app = express();
// Image uploads carry a base64 body far above the 100 KB default. That one
// route mounts its own 8 MB parser, so it must not be consumed here first — a
// body parser runs before routing, so a route-level limit alone can never win.
const jsonBody = express.json();
app.use((req, res, next) => (req.path === '/tenant-api/upload' ? next() : jsonBody(req, res, next)));

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowAll = DASHBOARD_ORIGINS.includes('*');
  if (allowAll || DASHBOARD_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', allowAll ? '*' : origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204); // preflight - must resolve before requireAuth below
  next();
});

// ---- auth middleware -----------------------------------------------------
// Two levels, mirroring the isSuper / isSupport custom claims the
// dashboard checks client-side (auth.js). Keep admins/{uid} in the
// Realtime Database in sync with whichever custom claims you set —
// this API does its own independent check rather than trusting the
// client, so both need to be set together.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const snap = await admin.database().ref(`admins/${decoded.uid}`).get();
    const claims = snap.val() || {};
    if (claims.isSuper !== true && claims.isSupport !== true) {
      return res.status(403).json({ error: 'Not a Supreme Admin' });
    }
    req.adminUid = decoded.uid;
    req.role = claims.isSuper === true ? 'super' : 'support';
    next();
  } catch (err) {
    res.status(500).json({ error: 'Could not verify admin status' });
  }
}

// Chain after requireAuth on any route that mutates state (restart, stop,
// WhatsApp linking). View-only (isSupport) accounts get a 403 here even
// though they passed requireAuth above.
function requireSuperOnly(req, res, next) {
  if (req.role !== 'super') {
    return res.status(403).json({ error: 'View-only account — this action requires full Supreme Admin access.' });
  }
  next();
}

// ---- tenant admin middleware (for restaurant-scoped endpoints) ----
// Verifies Firebase ID token, loads admins/{uid}, verifies the businessId/outlet
// pair exists and belongs to that admin, attaches businessId/outlet to req.
async function requireTenantAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const adminSnap = await admin.database().ref(`admins/${decoded.uid}`).get();
    const row = adminSnap.val() || {};
    if (!row.outlet) {
      return res.status(403).json({ error: 'Admin not linked to any outlet' });
    }
    // Legacy staff rows (and super admins) lack businessId — resolve the
    // business from the canonical outlet→business map instead of scanning
    // every business, which can pick the wrong business when an outlet name
    // exists under multiple businesses (e.g. e2e test tenants).
    // ponytail: outletIndex lookup first, scan as legacy fallback.
    let businessId = row.businessId;
    if (!businessId) {
      const outletIndexSnap = await admin.database().ref(`outletIndex/${row.outlet}`).get();
      const idx = outletIndexSnap.val();
      businessId = (idx && idx.bid) || null;
      if (!businessId) {
        const bizs = (await admin.database().ref('businesses').get()).val() || {};
        businessId = Object.keys(bizs).find(bid => bizs[bid]?.outlets?.[row.outlet]);
      }
    }
    if (!businessId) {
      return res.status(403).json({ error: 'Admin not linked to any outlet' });
    }

    // Verify the outlet exists and belongs to the resolved business
    const outletSnap = await admin.database().ref(`businesses/${businessId}/outlets/${row.outlet}`).get();
    if (!outletSnap.exists()) {
      return res.status(403).json({ error: 'Outlet not found for this business' });
    }

    req.adminUid = decoded.uid;
    req.businessId = businessId;
    req.outlet = row.outlet;
    req.role = row.role || 'owner'; // owner | manager | staff
    next();
  } catch (err) {
    res.status(500).json({ error: 'Could not verify admin status' });
  }
}

app.use('/api', requireAuth);
app.use('/tenant-api', requireTenantAdmin);

// ---- pm2 helpers -----------------------------------------------------
// pm2 connection itself now lives in pm2-client.js (connectOnce, shared
// with status-watcher.js) — routes below just await connectOnce() and
// never disconnect; see that file for why.
function pm2List() {
  return new Promise((resolve, reject) => pm2.list((err, list) => (err ? reject(err) : resolve(list))));
}
function pm2Action(action, name) {
  return new Promise((resolve, reject) => {
    pm2[action](name, (err, proc) => (err ? reject(err) : resolve(proc)));
  });
}
function processName(bid, oid) {
  return `bot-${bid}-${oid}`;
}
function statusOf(proc) {
  if (!proc) return { status: 'unknown', uptime: 0, memory: 0 };
  const online = proc.pm2_env?.status === 'online';
  const errored = proc.pm2_env?.status === 'errored';
  return {
    status: errored ? 'errored' : online ? 'online' : 'offline',
    uptime: online && proc.pm2_env?.pm_uptime ? Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000) : 0,
    memory: proc.monit?.memory ? Math.round(proc.monit.memory / (1024 * 1024)) : 0,
  };
}

// ---- routes -----------------------------------------------------
// Kept for ops/CLI debugging (`curl` a single outlet's live PM2 state) —
// the dashboard itself no longer calls this; it reads
// businesses/{bid}/outlets/{oid}/botStatus from Firebase in real time.
app.get('/api/bot/status/:bid/:oid', async (req, res) => {
  try {
    await connectOnce();
    const list = await pm2List();
    const proc = list.find((p) => p.name === processName(req.params.bid, req.params.oid));
    res.json(statusOf(proc));
  } catch (err) {
    console.error('status failed', err);
    res.status(500).json({ error: 'pm2 status failed' });
  }
});

// Same — kept for debugging/scripting, not called by the Fleet page
// anymore now that it has a live Firebase listener instead of a poll.
app.get('/api/bot/status-all', async (req, res) => {
  try {
    await connectOnce();
    const [list, businessesSnap] = await Promise.all([
      pm2List(),
      admin.database().ref('businesses').get(),
    ]);
    const businesses = businessesSnap.val() || {};
    const fleet = [];
    Object.entries(businesses).forEach(([bid, biz]) => {
      Object.entries(biz.outlets || {}).forEach(([oid, outlet]) => {
        const proc = list.find((p) => p.name === processName(bid, oid));
        fleet.push({
          bid, oid,
          restaurantName: outlet.name || 'Unnamed outlet',
          businessName: biz.name || 'Unnamed business',
          ...statusOf(proc),
        });
      });
    });
    res.json(fleet);
  } catch (err) {
    console.error('status-all failed', err);
    res.status(500).json({ error: 'pm2 status-all failed' });
  }
});

app.post('/api/bot/restart/:bid/:oid', requireSuperOnly, async (req, res) => {
  try {
    await connectOnce();
    await pm2Action('restart', processName(req.params.bid, req.params.oid));
    res.json({ ok: true });
  } catch (err) {
    console.error('restart failed', err);
    res.status(500).json({ error: `pm2 restart failed — ${err.message || 'process not found'}` });
  }
});

// Recompute + publish an outlet's wallet gate right now. Supreme calls this
// after arming/disarming billing.wallet.enforce so the flag flips immediately
// instead of waiting for the next watcher pass (which would apply it anyway).
app.post('/api/bot/wallet-gate/:bid/:oid', requireSuperOnly, async (req, res) => {
  try {
    const { gate, balance } = await publishWalletGate(admin, req.params.bid, req.params.oid);
    res.json({ ok: true, gate, balance });
  } catch (err) {
    console.error('wallet-gate publish failed', err);
    res.status(500).json({ error: `wallet gate publish failed — ${err.message || 'unknown error'}` });
  }
});

// Switch the bot's transport (meta | baileys) and restart the PM2 process.
// No re-login / re-link is required here — a linked Meta number or a saved
// Baileys session is simply reused (the first-time connection flows —
// Facebook Embedded Signup for meta, QR scan for baileys — are separate).
// Reports whether a Baileys session already exists so the dashboard can
// decide between "switched, reusing session" and "show the QR modal".
app.post('/api/bot/transport/:bid/:oid', requireSuperOnly, async (req, res) => {
  const { bid, oid } = req.params;
  const { transport } = req.body || {};
  if (transport !== 'meta' && transport !== 'baileys') {
    return res.status(400).json({ error: 'transport must be "meta" or "baileys"' });
  }
  try {
    const botRef = admin.database().ref(`businesses/${bid}/outlets/${oid}/bot`);
    await botRef.update({ transport });
    let needsQr = false;
    if (transport === 'baileys') {
      // Does a saved Baileys session exist on the box? If yes the bot
      // reconnects silently; if not it will emit a fresh QR to scan.
      const fs = require('fs');
      const path = require('path');
      const creds = path.join(__dirname, '..', 'bot', `session_data_${oid}`, 'creds.json');
      needsQr = !fs.existsSync(creds);
    }
    await connectOnce();
    await pm2Action('restart', processName(bid, oid));
    res.json({ ok: true, needsQr });
  } catch (err) {
    console.error('transport switch failed', err);
    res.status(500).json({ error: `transport switch failed — ${err.message || 'process not found'}` });
  }
});

// Force a fresh Baileys pairing: wipe the saved session so the next bot
// start emits a new QR (the "Re-scan QR" option in the dashboard).
app.post('/api/bot/rescan/:bid/:oid', requireSuperOnly, async (req, res) => {
  const { bid, oid } = req.params;
  try {
    const botRef = admin.database().ref(`businesses/${bid}/outlets/${oid}/bot`);
    await botRef.update({
      transport: 'baileys',
      pair: { requested: true, rescan: true, requestedAt: Date.now() },
    });
    await connectOnce();
    await pm2Action('restart', processName(bid, oid));
    res.json({ ok: true });
  } catch (err) {
    console.error('rescan failed', err);
    res.status(500).json({ error: `rescan failed — ${err.message || 'process not found'}` });
  }
});

// Real Firebase Auth password reset for a restaurant's admin account.
// The Supreme profile card calls this instead of writing adminLogin text —
// the email must be a real Auth user or the Admin dashboard login fails
// with user-not-found. Also creates the Auth user on first save so the
// "Admin login" card on the profile always mirrors something that works.
app.post('/api/admin/update-password', requireSuperOnly, async (req, res) => {
  const { bid, oid, email, newPassword } = req.body || {};
  if (!bid || !oid || !email || !newPassword) {
    return res.status(400).json({ error: 'bid, oid, email, and newPassword are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    let uid;
    try {
      const user = await admin.auth().getUserByEmail(email);
      uid = user.uid;
      await admin.auth().updateUser(uid, { password: newPassword });
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
      const created = await admin.auth().createUser({ email, password: newPassword });
      uid = created.uid;
    }
    const outletSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}`).get();
    const outlet = outletSnap.val() || {};
    const outletName = outlet.name || oid;
    const ownerSnap = await admin.database().ref(`admins/${uid}`).get();
    if (!ownerSnap.exists()) {
      await admin.database().ref(`admins/${uid}`).set({
        email, outlet: oid, name: outletName, role: 'owner', businessId: bid,
      });
    }
    // Record only the email. The password lives in Firebase Auth; storing it here would leak
    // it to every staff role (adminLogin inherits businesses/{bid}/.read).
    await admin.database().ref(`businesses/${bid}/outlets/${oid}/adminLogin`).set({ email, passwordUpdatedAt: Date.now() });
    res.json({ ok: true, uid });
  } catch (err) {
    console.error('update-password failed', err);
    res.status(500).json({ error: `Password update failed — ${err.message}` });
  }
});

// Approve a website onboarding request — creates the full outlet + Auth user
// atomically. Called from the Supreme Admin onboarding-requests page.
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const httpError = (status, message) => new HttpError(status, message);

// Core of onboarding approval, shared by the manual Supreme Admin endpoint and
// the auto-approval watcher below. Creates the Auth user, admins/{uid} mirror and
// the outlet (locked: true until the first wallet top-up is recorded). Throws
// HttpError for expected failures; any other throw is unexpected.
async function approveOnboardingRequest(reqKey, f, reviewerUid) {
  const { businessName, outletName, contactPhone, contactEmail, adminEmail, adminName, plan, template, whatsappConnect } = f;
    // Verify the request is still pending
    const reqSnap = await admin.database().ref(`onboardingRequests/${reqKey}`).get();
    const reqData = reqSnap.val();
    if (!reqData) throw httpError(404, 'Onboarding request not found');
    if (reqData.status !== 'pending') throw httpError(409, `Request already ${reqData.status}`);

    // Resolve the owner's dashboard account. New requests carry `authUid`: the
    // applicant's browser created the Firebase Auth user at signup, so the
    // password travelled browser -> Firebase over TLS and was never stored here.
    // Legacy requests (submitted before the cutover) still carry a password to
    // replay — write-only secret node first, then the old inline field. That
    // branch exists for one release so a pending request is not stranded.
    const authUid = typeof reqData.authUid === 'string' && reqData.authUid ? reqData.authUid : null;
    let uid = null;
    let legacyPassword = null;

    if (authUid) {
      if (String(adminEmail || '').toLowerCase() !== String(reqData.adminEmail || '').toLowerCase()) {
        throw httpError(422, 'The admin email cannot be changed after the signup account was created.');
      }
      let user = null;
      try {
        user = await admin.auth().getUser(authUid);
      } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
      }
      if (!user) {
        throw httpError(422, 'The dashboard account recorded on this request no longer exists — ask the applicant to submit the form again.');
      }
      if (String(user.email || '').toLowerCase() !== String(adminEmail || '').toLowerCase()) {
        throw httpError(422, 'The dashboard account does not match the admin email on this request.');
      }
      uid = user.uid;
    } else {
      try {
        const secSnap = await admin.database().ref(`onboardingSecrets/${reqKey}`).get();
        legacyPassword = secSnap.val()?.password || null;
      } catch (e) {
        console.warn('[approve-onboarding] secret read failed (non-fatal, trying legacy):', e.message);
      }
      if (!legacyPassword) legacyPassword = reqData.adminPassword || null;
      if (!legacyPassword || legacyPassword.length < 6) {
        throw httpError(422, 'No signup account on this request — ask the applicant to submit the form again.');
      }
    }

    // Ids are decided here but only STAMPED after the duplicate-email check: the stamp is the
    // "this request may own an Auth user" marker. Stamping before the check would let a first
    // attempt that dies on a duplicate leave a marker behind, and attempt 2 would then adopt a
    // stranger's account instead of rejecting it.
    const isRetry = Boolean(reqData.bid && reqData.oid);
    const bid = reqData.bid || admin.database().ref('businesses').push().key.toLowerCase();
    const oid = reqData.oid || admin.database().ref(`businesses/${bid}/outlets`).push().key.toLowerCase();

    // Duplicate admin email — a first LEGACY attempt is always rejected (the account may
    // belong to a rider or a previous tenant). Only a retry of THIS request may reuse the
    // Auth user it already created, otherwise a real signup dies with an orphan account.
    // An `authUid` request is different: the account was created (or password-proven) at
    // signup, so it is expected to exist — the email match above is the binding check.
    if (!authUid) {
      try {
        await admin.auth().getUserByEmail(adminEmail);
        if (!isRetry) throw httpError(409, `Admin email ${adminEmail} already exists`);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err.code !== 'auth/user-not-found') throw err;
      }
    }

    // Stamp bid/oid BEFORE creating anything. A retry after a mid-flight failure then reuses the
    // same ids instead of minting a second tenant.
    if (!isRetry) {
      await admin.database().ref(`onboardingRequests/${reqKey}`).update({ bid, oid }).catch((e) => {
        console.warn('[approve-onboarding] id stamp failed (non-fatal):', e.message);
      });
    }

    // Outlet number: reuse the one a previous attempt already assigned, otherwise allocate
    // once. A retry must never burn a second number on a successful first attempt.
    let outletNo = null;
    if (isRetry) {
      const noSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/outletNo`).get().catch(() => null);
      outletNo = (noSnap && noSnap.val()) || null;
    }
    if (!outletNo) {
      try {
        const noSnap = await admin.database().ref('meta/outletCounter').runTransaction(cur => (cur || 0) + 1);
        outletNo = String(noSnap.snapshot.val() || '').padStart(2, '0') || null;
      } catch (e) {
        console.warn('[approve-onboarding] outletCounter failed (non-fatal):', e.message);
      }
    }

    // Read template defaults
    let tplDefaults = null;
    if (template) {
      const tplSnap = await admin.database().ref(`appTemplates/${template}`).get();
      tplDefaults = tplSnap.val()?.defaults || null;
    }

    // Mirror template into menuBank
    const _slug = (name) => String(name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
    const bankUpdates = {};
    if (tplDefaults) {
      Object.values(tplDefaults.categories || {}).forEach(c => {
        if (c && c.name) {
          bankUpdates[`menuBank/categories/${_slug(c.name)}`] = {
            ...c, sourceBid: bid, sourceOid: oid,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
          };
        }
      });
      Object.values(tplDefaults.dishes || {}).forEach(d => {
        if (d && d.name) {
          bankUpdates[`menuBank/dishes/${_slug(`${d.name}-${d.category || 'other'}`)}`] = {
            ...d, sourceBid: bid, sourceOid: oid,
            updatedAt: admin.database.ServerValue.TIMESTAMP,
          };
        }
      });
    }

    // Create/refresh the Auth user. New flow: already created at signup and only
    // proven here — there is genuinely no password in this process to set.
    if (!uid) {
      try {
        const user = await admin.auth().getUserByEmail(adminEmail);
        uid = user.uid;
        await admin.auth().updateUser(uid, { password: legacyPassword });
      } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
        const created = await admin.auth().createUser({ email: adminEmail, password: legacyPassword });
        uid = created.uid;
      }
    }

    // Write admins/{uid} mirror — merge (never clobber owner-managed name/fcmToken/isSuper); seed name only for new records
    const curAdmin = (await admin.database().ref(`admins/${uid}`).get()).val();
    // An account that already owns a different outlet must not be repointed at this one
    // (the signup resume path accepts any existing account whose password was proven).
    if (curAdmin && (curAdmin.businessId !== bid || curAdmin.outlet !== oid)) {
      throw httpError(409, 'This login already belongs to another outlet. Sign up with a different email.');
    }
    await admin.database().ref(`admins/${uid}`).update({
      email: adminEmail, outlet: oid, businessId: bid, role: 'owner',
      ...(curAdmin ? {} : { name: adminName || outletName }),
    });

    // Write outlet with locked: true
    const now = admin.database.ServerValue.TIMESTAMP;
    await admin.database().ref().update({
      [`businesses/${bid}`]: {
        name: businessName,
        contactPhone: contactPhone || null,
        contactEmail: contactEmail || null,
        plan: plan || 'starter',
        createdAt: now,
        outlets: {
          [oid]: {
            name: outletName,
            contactPhone: contactPhone || null,
            createdAt: now,
            ...(outletNo ? { outletNo } : {}),
            // Template data first, identity/security fields after it: a stray key in a
            // template must never be able to unlock a new outlet or rewrite its login.
            ...(tplDefaults || {}),
            whatsapp: { status: 'pending', ...(whatsappConnect ? { requestedConnect: whatsappConnect } : {}) },
            locked: true,
            // Email only. The password lives in Firebase Auth and nowhere else — this node
            // inherits businesses/{bid}/.read, which every staff role of the tenant can read.
            adminLogin: { email: adminEmail, updatedAt: now },
            settings: { ...(tplDefaults?.settings || {}), features: { ...(tplDefaults?.settings?.features || {}), discountApproval: false } },
          },
        },
      },
      // Money lives at the ROOT, outside businesses/{bid} (tenant-writable).
      [`walletBilling/${bid}/${oid}`]: getBillingDefaults(),
      // Required by the admins/{uid} create rule and the riderIndex validate — without it the
      // owner cannot add staff or riders (the write fails AFTER the Auth user is created).
      [`outletIndex/${oid}`]: { bid, name: outletName, createdAt: now },
      ...bankUpdates,
    });

    // Burn the secret + clear any legacy inline password now that Auth holds it.
    // Deletion happens AFTER user creation so a mid-flow failure stays retryable.
    await admin.database().ref(`onboardingSecrets/${reqKey}`).set(null).catch((e) => {
      console.warn('[approve-onboarding] secret delete failed (non-fatal):', e.message);
    });

    // Update onboarding request. The old inline `adminPassword` is burned by the
    // rule schema (values are forbidden, deletion allowed), and the response
    // below never carries a credential.
    await admin.database().ref(`onboardingRequests/${reqKey}`).update({
      status: 'approved',
      bid, oid,
      reviewedAt: now,
      reviewedBy: reviewerUid || null,
      adminPassword: null,
    });

  return { bid, oid, uid, email: adminEmail };
}

// Manual approval (Supreme Admin UI). Unchanged contract: same body, same response.
app.post('/api/admin/approve-onboarding', requireSuperOnly, async (req, res) => {
  const { reqKey, businessName, outletName, contactPhone, contactEmail, adminEmail, adminName, plan, template, whatsappConnect } = req.body || {};
  if (!reqKey || !businessName || !outletName || !adminEmail) {
    return res.status(400).json({ error: 'reqKey, businessName, outletName, adminEmail are required' });
  }
  try {
    const r = await approveOnboardingRequest(reqKey, { businessName, outletName, contactPhone, contactEmail, adminEmail, adminName, plan, template, whatsappConnect }, req.auth?.uid);
    res.json({ ok: true, ...r, loginUrl: 'https://app.foodhubbie.in' });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('approve-onboarding failed', err);
    res.status(500).json({ error: `Approval failed — ${err.message}` });
  }
});

// D2: email-verification state of a restaurant's owner account. Supreme calls this
// before unlocking an outlet — an auto-onboarded tenant must prove the admin email
// is real before it can go live. emailVerified: null means the outlet predates the
// adminLogin record, so there is no gate to apply (never trap a legacy tenant).
async function outletAdminStatus(bid, oid) {
  const snap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/adminLogin/email`).get();
  const email = snap.val() || null;
  if (!email) return { email: null, emailVerified: null };
  let user = null;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }
  if (!user) return { email, emailVerified: false, missing: true };
  return { email, emailVerified: user.emailVerified === true, uid: user.uid, disabled: user.disabled === true };
}

app.get('/api/admin/outlet-admin-status', requireSuperOnly, async (req, res) => {
  const { bid, oid } = req.query;
  if (!bid || !oid) return res.status(400).json({ error: 'bid and oid are required' });
  try {
    res.json(await outletAdminStatus(bid, oid));
  } catch (err) {
    console.error('outlet-admin-status failed', err);
    res.status(500).json({ error: `Status check failed — ${err.message}` });
  }
});

// ---- Auto-approval of website sign-ups --------------------------------------
// New restaurants are created automatically (no manual review). The owner is
// notified via an `inquiries` record (shows in Supreme > Notifications) and the
// request appears as "approved" in Supreme > Onboarding. The new outlet stays
// locked until the first wallet top-up is recorded, so spam only creates inert
// records. Guards: ONBOARDING_AUTO_APPROVE=off disables it; AUTO_APPROVE_MAX_PER_HOUR
// caps it (extra requests stay "pending" for manual review). Single-instance
// assumption, same as status-watcher.js.
const AUTO_APPROVE_ON = String(process.env.ONBOARDING_AUTO_APPROVE || 'on').toLowerCase() !== 'off';
const AUTO_APPROVE_MAX_PER_HOUR = Number(process.env.AUTO_APPROVE_MAX_PER_HOUR || 20);
const SECRET_RETRY_MS = [3000, 10000, 30000, 90000]; // step 2 (password) lands after step 1 (request)
// Only fresh sign-ups are auto-approved. On every API start the listener replays all requests that are already
// pending; older ones (stale, legacy inline-password, or over the hourly cap) must stay for manual review.
const AUTO_APPROVE_MAX_AGE_MS = 15 * 60 * 1000;
const _autoRecent = [];             // timestamps of recent auto-approvals
const _autoSeen = new Set();        // reqKeys already handled in this process
let _autoChain = Promise.resolve(); // serialise: outletCounter + duplicate-email checks must not race

async function notifySupreme(title, message, extra = {}) {
  try {
    // Shape must satisfy database.rules.json `inquiries/$id` or Supreme can never mark it read
    // (a client write re-validates the whole record): source must be exactly 'website', phone
    // needs 5–15 chars, and an absent `status` already means "new" in the Supreme UI.
    const phone = String(extra.phone || '').trim();
    await admin.database().ref('inquiries').push({
      name: String(title).slice(0, 80),
      phone: phone.length >= 5 && phone.length <= 15 ? phone : '0000000000',
      type: 'New restaurant signup',
      message: String(message).slice(0, 2000),
      store: String(extra.store || '').slice(0, 80),
      source: 'website',
      createdAt: Date.now(),
    });
  } catch (e) { console.warn('[auto-onboarding] notify failed (non-fatal):', e.message); }
}

async function autoApproveOne(reqKey, attempt = 0) {
  const snap = await admin.database().ref(`onboardingRequests/${reqKey}`).get();
  const r = snap.val();
  if (!r || r.status !== 'pending' || r.source !== 'website') return;
  const now = Date.now();
  if (Math.abs(now - Number(r.createdAt || 0)) > AUTO_APPROVE_MAX_AGE_MS) {
    console.log(`[auto-onboarding] ${reqKey} is not a fresh sign-up; left pending for manual review`);
    return;
  }
  while (_autoRecent.length && now - _autoRecent[0] > 3600000) _autoRecent.shift();
  if (_autoRecent.length >= AUTO_APPROVE_MAX_PER_HOUR) {
    console.warn(`[auto-onboarding] hourly cap reached; ${reqKey} left pending for manual review`);
    await notifySupreme('Signup needs manual review', `Auto-approval hourly cap (${AUTO_APPROVE_MAX_PER_HOUR}) reached. ${r.businessName} (${r.adminEmail}) is waiting in Onboarding.`, { phone: r.contactPhone, store: r.outletName });
    return;
  }
  try {
    const out = await approveOnboardingRequest(reqKey, r, 'auto-onboarding');
    _autoRecent.push(Date.now());
    await notifySupreme(`New restaurant: ${r.businessName}`, `${r.outletName} signed up (${r.adminEmail}) and was created automatically. It is locked until its first wallet top-up (min ₹1,000) is recorded.`, { phone: r.contactPhone, store: r.outletName });
    console.log(`[auto-onboarding] approved ${reqKey} -> ${out.bid}/${out.oid}`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 422 && attempt < SECRET_RETRY_MS.length) {
      setTimeout(() => { _autoChain = _autoChain.then(() => autoApproveOne(reqKey, attempt + 1)).catch(() => {}); }, SECRET_RETRY_MS[attempt]);
      return;
    }
    if (err instanceof HttpError && err.status === 409 && /already exists/.test(err.message)) {
      await admin.database().ref(`onboardingRequests/${reqKey}`).update({
        status: 'rejected', rejectReason: 'This login email is already registered.', reviewedAt: Date.now(), reviewedBy: 'auto-onboarding',
      }).catch(() => {});
      return;
    }
    console.error(`[auto-onboarding] ${reqKey} left pending:`, err.message);
    await notifySupreme('Signup needs manual review', `${r.businessName} (${r.adminEmail}) could not be auto-approved: ${err.message}`, { phone: r.contactPhone, store: r.outletName });
  }
}

function startAutoApproval() {
  if (!AUTO_APPROVE_ON) { console.log('[auto-onboarding] disabled (ONBOARDING_AUTO_APPROVE=off)'); return; }
  admin.database().ref('onboardingRequests').orderByChild('status').equalTo('pending').on('child_added', (snap) => {
    const key = snap.key;
    if (_autoSeen.has(key)) return;
    _autoSeen.add(key);
    // small delay lets the browser's step-2 password write land first
    setTimeout(() => { _autoChain = _autoChain.then(() => autoApproveOne(key)).catch((e) => console.error('[auto-onboarding]', e)); }, 2000);
  }, (e) => console.error('[auto-onboarding] listener error:', e.message));
  console.log(`[auto-onboarding] watching new sign-ups (cap ${AUTO_APPROVE_MAX_PER_HOUR}/hour)`);
}

// ---- D2 cleanup: unverified auto-onboarded tenants --------------------------
// A tenant created by auto-approval whose owner never verified the admin email is
// deleted after 72h so the address is free for its real owner. Log-only unless
// ONBOARDING_CLEANUP=enforce. Never touches manual approvals, the demo tenant, or
// a tenant that already has an order or a payment (activity = a real restaurant).
const CLEANUP_ENFORCE = String(process.env.ONBOARDING_CLEANUP || '').toLowerCase() === 'enforce';
const UNVERIFIED_TTL_MS = 72 * 60 * 60 * 1000;

async function markRequestExpired(key, reason) {
  await admin.database().ref(`onboardingRequests/${key}`).update({
    status: 'expired', expiredAt: Date.now(), expireReason: reason,
  }).catch((e) => console.warn('[onboarding-cleanup] mark expired failed (non-fatal):', e.message));
}

async function runUnverifiedCleanup() {
  const snap = await admin.database().ref('onboardingRequests').orderByChild('status').equalTo('approved').get();
  const requests = snap.val() || {};
  const now = Date.now();
  let candidates = 0, deleted = 0;

  for (const [key, r] of Object.entries(requests)) {
    if (!r || r.reviewedBy !== 'auto-onboarding' || !r.bid || !r.oid) continue;
    if (r.bid === 'foodhubbie-demo') continue;
    const reviewedAt = Number(r.reviewedAt);
    if (!Number.isFinite(reviewedAt) || now - reviewedAt < UNVERIFIED_TTL_MS) continue;

    const base = `businesses/${r.bid}/outlets/${r.oid}`;
    const [orders, payments] = await Promise.all([
      admin.database().ref(`${base}/orders`).limitToFirst(1).get(),
      admin.database().ref(`walletBilling/${r.bid}/${r.oid}/payments`).limitToFirst(1).get(),
    ]);
    if (orders.exists() || payments.exists()) continue;

    const outlet = (await admin.database().ref(base).get()).val();
    if (!outlet) { await markRequestExpired(key, 'Tenant already gone'); continue; }

    const email = (outlet.adminLogin && outlet.adminLogin.email) || r.adminEmail;
    let user = null;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
    }
    if (user && user.emailVerified === true) continue; // verified — keep the tenant

    candidates++;
    if (!CLEANUP_ENFORCE) {
      console.log(`[onboarding-cleanup] would delete ${r.bid}/${r.oid} (${email}) — unverified for ${Math.round((now - reviewedAt) / 3600000)}h`);
      continue;
    }

    if (user) {
      const row = (await admin.database().ref(`admins/${user.uid}`).get()).val() || {};
      // Only remove the mirror row while it still belongs to this tenant.
      if (row.outlet === r.oid && row.businessId === r.bid) {
        await admin.database().ref(`admins/${user.uid}`).remove();
      }
      await admin.auth().deleteUser(user.uid);
    }
    const outletKeys = Object.keys(((await admin.database().ref(`businesses/${r.bid}/outlets`).get()).val()) || {});
    if (outletKeys.length <= 1) await admin.database().ref(`businesses/${r.bid}`).remove();
    else await admin.database().ref(base).remove();
    await admin.database().ref(`outletIndex/${r.oid}`).remove();
    await markRequestExpired(key, 'Unverified after 72h');
    deleted++;
    console.log(`[onboarding-cleanup] deleted ${r.bid}/${r.oid} (${email}) — unverified after 72h`);
  }

  console.log(`[onboarding-cleanup] ${candidates} unverified candidate(s), ${deleted} deleted${CLEANUP_ENFORCE ? '' : ' (observe mode — set ONBOARDING_CLEANUP=enforce to delete)'}`);
  return { candidates, deleted };
}

app.post('/api/bot/stop/:bid/:oid', requireSuperOnly, async (req, res) => {
  try {
    await connectOnce();
    await pm2Action('stop', processName(req.params.bid, req.params.oid));
    res.json({ ok: true });
  } catch (err) {
    console.error('stop failed', err);
    res.status(500).json({ error: `pm2 stop failed — ${err.message || 'process not found'}` });
  }
});

// Pick the lowest free health port >= 3001 by scanning existing bot apps'
// HEALTH_PORT envs. pizza=3001 / cake=3002 are already taken today.
async function nextHealthPort() {
  const list = await pm2List();
  const used = new Set(
    list
      .filter((p) => p.name && p.name.startsWith('bot-'))
      .map((p) => Number(p.pm2_env?.env?.HEALTH_PORT))
      .filter((n) => n >= 3001)
  );
  for (let p = 3001; p <= 3100; p++) {
    if (!used.has(p)) return p;
  }
  return 3101;
}

// Provision a fresh PM2 bot worker for a restaurant outlet directly from the
// dashboard — the "add a restaurant" flow's missing step. Starts
// bot/{bid}-{oid} with per-outlet env; idempotent (restarts if it exists).
// Once running, status-watcher + the existing pair/QR flow take over.
app.post('/api/bot/provision/:bid/:oid', requireSuperOnly, async (req, res) => {
  const { bid, oid } = req.params;
  if (!bid || !oid) return res.status(400).json({ error: 'bid and oid are required' });
  const name = processName(bid, oid);
  const botDir = path.join(__dirname, '..', 'bot');
  try {
    const outletSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}`).get();
    if (!outletSnap.exists()) {
      return res.status(404).json({ error: `No outlet ${bid}/${oid} in Firebase — create it first` });
    }
    await connectOnce();
    const list = await pm2List();
    const existing = list.find((p) => p.name === name);
    // Reuse the existing worker's health port on restart — allocating a new
    // one each time drifts ports (old one stays "used" in the pm2 list while
    // the process gets a new HEALTH_PORT).
    const healthPort = existing
      ? Number(existing.pm2_env?.env?.HEALTH_PORT) || await nextHealthPort()
      : await nextHealthPort();
    const env = {
      OUTLET: oid,
      BUSINESS_ID: bid,
      OUTLET_ID: oid,
      BOT_TRANSPORT: 'baileys',
      HEALTH_PORT: String(healthPort),
    };
    if (existing) {
      await pm2Action('restart', name);
    } else {
      await new Promise((resolve, reject) => {
        pm2.start(
          { name, cwd: botDir, script: 'index.js', env, autorestart: true, max_restarts: 20, min_uptime: 10000 },
          (err, proc) => (err ? reject(err) : resolve(proc))
        );
      });
    }
    await new Promise((resolve, reject) => pm2.dump((err) => (err ? reject(err) : resolve())));
    await admin.database().ref(`businesses/${bid}/outlets/${oid}/bot`).update({
      transport: 'baileys',
      provisionedAt: admin.database.ServerValue.TIMESTAMP,
      healthPort,
    });
    res.json({ ok: true, name, healthPort, existed: !!existing });
  } catch (err) {
    console.error('provision failed', err);
    res.status(500).json({ error: `provision failed — ${err.message}` });
  }
});

// Decommission: stop + delete the PM2 worker, remove its Baileys session dir,
// and clear the provisioned bot record. Does NOT delete Firebase business data.
app.post('/api/bot/delete/:bid/:oid', requireSuperOnly, async (req, res) => {
  const { bid, oid } = req.params;
  const name = processName(bid, oid);
  try {
    await connectOnce();
    // Idempotent: a worker that was never provisioned (or already deleted)
    // means "nothing to do" here, not a failure — pm2.delete on a missing
    // name rejects, so check the list first (same pattern as provision's
    // `existing` check).
    const list = await pm2List();
    if (list.some((p) => p.name === name)) {
      await pm2Action('delete', name);
    }
    const sessionDir = path.join(__dirname, '..', 'bot', `session_data_${oid}`);
    const fs = require('fs');
    if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
    await new Promise((resolve, reject) => pm2.dump((err) => (err ? reject(err) : resolve())));
    await admin.database().ref(`businesses/${bid}/outlets/${oid}/bot`).update({
      provisionedAt: null,
      healthPort: null,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('delete failed', err);
    res.status(500).json({ error: `decommission failed — ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// WhatsApp number management (plan G1/G2/G3) — Path B (platform system-user
// token, no popups) + Path A (Embedded Signup code exchange).
// ---------------------------------------------------------------------------

// Shared post-success write for every way a number gets linked: record it on
// the outlet, index it for webhook routing, subscribe the WABA, and point the
// bot's transport at it so the bot actually uses this number.
async function waLinkSuccess(bid, oid, { phoneNumberId, wabaId, displayPhoneNumber, verifiedName }) {
  const base = `businesses/${bid}/outlets/${oid}`;
  await admin.database().ref(`${base}/whatsapp`).set({
    phoneNumberId,
    wabaId,
    displayPhoneNumber: displayPhoneNumber || null,
    verifiedName: verifiedName || null,
    status: 'active',
    connectedAt: admin.database.ServerValue.TIMESTAMP,
  });
  await admin.database().ref(`phoneNumberIndex/${phoneNumberId}`).set({ businessId: bid, outletId: oid });
  if (wabaId) {
    await admin.database().ref(`wabaIndex/${wabaId}`).set({ businessId: bid, outletId: oid });
  }
  await admin.database().ref(`${base}/bot`).update({ transport: 'meta', phoneNumberId });
  try {
    await waGraph.subscribeApps(wabaId);
  } catch (err) {
    console.warn(`subscribeApps failed for waba ${wabaId} — inbound messages may not route`, err.message);
  }
  return { phoneNumberId, wabaId, displayPhoneNumber, verifiedName };
}

function metaTokenSet() {
  if (!process.env.META_SYSTEM_USER_TOKEN) {
    return null;
  }
  return true;
}

// Path B — list WABAs the platform token can reach.
app.get('/api/whatsapp/accounts/:bid/:oid', async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  try {
    const wabas = await waGraph.listWabas();
    res.json({ wabas });
  } catch (err) {
    console.error('list WABAs failed', err);
    res.status(500).json({ error: `Could not list WhatsApp accounts — ${err.message}` });
  }
});

// Path B — list numbers on the outlet's WABA (or the first reachable one).
app.get('/api/whatsapp/numbers/:bid/:oid', async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  const { bid, oid } = req.params;
  try {
    const outletSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp`).get();
    let wabaId = outletSnap.val()?.wabaId;
    if (!wabaId) {
      const wabas = await waGraph.listWabas();
      wabaId = wabas[0]?.id;
      if (!wabaId) return res.status(404).json({ error: 'No WABA available — configure WABA_ID or link one first' });
    }
    const data = await waGraph.listNumbers(wabaId);
    res.json({ wabaId, numbers: data.data || [] });
  } catch (err) {
    console.error('list numbers failed', err);
    res.status(500).json({ error: `Could not list phone numbers — ${err.message}` });
  }
});

// Path B — add an owned number to the outlet's WABA (pre-verification).
app.post('/api/whatsapp/numbers/:bid/:oid', requireSuperOnly, async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  const { bid, oid } = req.params;
  const { verified_name, display_phone_number, cc, wabaId } = req.body || {};
  if (!verified_name || !display_phone_number) {
    return res.status(400).json({ error: 'verified_name and display_phone_number are required' });
  }
  try {
    let target = wabaId;
    if (!target) {
      const outletSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp`).get();
      target = outletSnap.val()?.wabaId;
      if (!target) {
        const wabas = await waGraph.listWabas();
        target = wabas[0]?.id;
      }
      if (!target) return res.status(404).json({ error: 'No WABA available — set WABA_ID env or link one first' });
    }
    const data = await waGraph.addNumber(target, { verified_name, display_phone_number, cc });
    res.json({ wabaId: target, phoneNumberId: data.id });
  } catch (err) {
    console.error('add number failed', err);
    res.status(500).json({ error: `Could not add phone number — ${err.message}` });
  }
});

// Path B — send SMS/voice verification code to prove ownership.
app.post('/api/whatsapp/numbers/:bid/:oid/:phoneNumberId/request-code', requireSuperOnly, async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  const { phoneNumberId } = req.params;
  const { method = 'sms', language = 'en' } = req.body || {};
  try {
    await waGraph.requestCode(phoneNumberId, { method, language });
    res.json({ ok: true });
  } catch (err) {
    console.error('request code failed', err);
    res.status(500).json({ error: `Could not send verification code — ${err.message}` });
  }
});

// Path B — submit the verification code.
app.post('/api/whatsapp/numbers/:bid/:oid/:phoneNumberId/verify-code', requireSuperOnly, async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  const { phoneNumberId } = req.params;
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });
  try {
    await waGraph.verifyCode(phoneNumberId, code);
    res.json({ ok: true });
  } catch (err) {
    console.error('verify code failed', err);
    res.status(500).json({ error: `Could not verify code — ${err.message}` });
  }
});

// Path B — register the number (sets 2FA pin) and complete the link. This is
// the "connect" step: after registration the number is live on the Cloud API
// and we write every record the rest of the stack expects.
app.post('/api/whatsapp/numbers/:bid/:oid/:phoneNumberId/register', requireSuperOnly, async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  const { bid, oid, phoneNumberId } = req.params;
  const { pin, wabaId, displayPhoneNumber, verifiedName } = req.body || {};
  if (!pin || !/^\d{6}$/.test(String(pin))) {
    return res.status(400).json({ error: 'A 6-digit 2FA pin is required' });
  }
  try {
    await waGraph.registerNumber(phoneNumberId, String(pin));
    const result = await waLinkSuccess(bid, oid, {
      phoneNumberId,
      wabaId,
      displayPhoneNumber,
      verifiedName,
    });
    res.json(result);
  } catch (err) {
    console.error('register number failed', err);
    res.status(500).json({ error: `Could not register number — ${err.message}` });
  }
});

// Path B — deregister (stop Cloud API usage). Removes the number record too.
app.post('/api/whatsapp/numbers/:bid/:oid/:phoneNumberId/deregister', requireSuperOnly, async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  const { bid, oid, phoneNumberId } = req.params;
  try {
    await waGraph.deregisterNumber(phoneNumberId);
    await admin.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp`).set(null);
    await admin.database().ref(`phoneNumberIndex/${phoneNumberId}`).set(null);
    res.json({ ok: true });
  } catch (err) {
    console.error('deregister failed', err);
    res.status(500).json({ error: `Could not deregister number — ${err.message}` });
  }
});

// WhatsApp Embedded Signup code exchange (Path A) — kept server-side because
// it needs the Meta app secret, which must never reach the browser.
// v4 flow: the Embedded Signup postMessage supplies { code, wabaId,
// phoneNumberId } directly — the server exchanges the code for a user token,
// asserts it is non-expiring (expires_at: 0), then writes every record
// server-side via waLinkSuccess. The client must never write the `whatsapp`
// node — it is a super/supreme-only boundary on Path B.
app.post('/api/whatsapp/exchange', requireSuperOnly, async (req, res) => {
  const { bid, oid, code, wabaId, phoneNumberId } = req.body || {};
  if (!bid || !oid || !code) return res.status(400).json({ error: 'bid, oid, and code are required' });
  if (!wabaId || !phoneNumberId) {
    return res.status(400).json({ error: 'v4 exchange requires wabaId and phoneNumberId from the signup postMessage' });
  }
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return res.status(501).json({ error: 'META_APP_ID / META_APP_SECRET not configured' });

  try {
    // Exchange the authorization code for a user access token (server-only).
    const tokenRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
    );
    if (!tokenRes.ok) throw new Error(`oauth exchange failed — Graph API ${tokenRes.status}`);
    const { access_token: userToken, expires_at } = await tokenRes.json();
    if (!userToken) throw new Error('oauth exchange returned no access token');

    // v4 tokens must be non-expiring (expires_at === 0). A short-lived user
    // token cannot be used as the long-lived sender token for bot workers.
    if (expires_at !== 0 && expires_at !== '0') {
      throw new Error(`Token expires at ${expires_at} — v4 Embedded Signup must return a non-expiring token (expires_at: 0)`);
    }

    // Fetch the number's display name from Graph so the record is complete.
    let displayPhoneNumber = null;
    let verifiedName = null;
    try {
      const numRes = await fetch(
        `https://graph.facebook.com/v20.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${userToken}` } }
      );
      if (numRes.ok) {
        const num = await numRes.json();
        displayPhoneNumber = num.display_phone_number || null;
        verifiedName = num.verified_name || null;
      }
    } catch (_) {
      // Non-fatal — the number may not be readable with a user token yet.
    }

    const result = await waLinkSuccess(bid, oid, {
      phoneNumberId,
      wabaId,
      displayPhoneNumber,
      verifiedName,
    });
    res.json(result);
  } catch (err) {
    console.error('exchange failed', err);
    res.status(500).json({ error: `WhatsApp link exchange failed — ${err.message}` });
  }
});

// WhatsApp messaging quota (view-only — both roles can read this).
// Real numbers require a Meta system-user token; without one this
// answers 501 so the dashboard shows an honest "not wired up" message
// instead of a fake gauge.
//
// Response shape is `{ quota: { tier, used, limit, available, reason? } }`
// (top-level copies kept for older clients). `used` is always real — it is
// the bot's own per-IST-day send counter at outlet.whatsapp/usage/{date}.
//
// A Graph failure is NOT a server error: an outlet may still hold a test or
// removed phone-number id, the system-user token may not be attached to that
// WABA, or Meta may be down. Those answer 200 with `available:false` + the
// reason, so the dashboard renders "quota unavailable" instead of a console
// error (this used to 500 and log `quota lookup failed` on every profile open).
// Results are cached for 60 s — the profile page loads this on every render and
// the tier only changes on Meta's side.
const _quotaCache = new Map(); // `${bid}/${oid}` -> { at, body }
const QUOTA_CACHE_MS = 60 * 1000;

app.get('/api/whatsapp/quota/:bid/:oid', async (req, res) => {
  if (!process.env.META_SYSTEM_USER_TOKEN) {
    return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  }
  const { bid, oid } = req.params;
  const cacheKey = `${bid}/${oid}`;
  const cached = _quotaCache.get(cacheKey);
  if (cached && Date.now() - cached.at < QUOTA_CACHE_MS) return res.json(cached.body);

  try {
    const snap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp`).get();
    const wa = snap.val();
    if (!wa?.phoneNumberId) return res.status(404).json({ error: 'No WhatsApp phone number linked yet' });

    // Same IST day the bot keys by (UTC+5:30, date split at midnight IST).
    const day = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
    const usageSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp/usage/${day}`).get();
    const rawUsage = usageSnap.val();
    // The bot writes a plain number (atomic increment). Older/legacy rows can be
    // an object of category counters — fall back to its `total` so the gauge
    // never renders "[object Object]".
    const used = typeof rawUsage === 'number'
      ? rawUsage
      : (rawUsage && typeof rawUsage === 'object' ? Number(rawUsage.total) || 0 : 0);

    // messaging_limit_tier tells you the CAP, not current usage — Meta
    // doesn't expose a running "messages sent today" count on this field.
    const tierLimits = { TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: 1000000 };
    let tier = null;
    let limit = null;
    let reason = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const graphRes = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(wa.phoneNumberId)}?fields=messaging_limit_tier`,
        { headers: { Authorization: `Bearer ${process.env.META_SYSTEM_USER_TOKEN}` }, signal: ctrl.signal },
      );
      clearTimeout(timer);
      if (graphRes.ok) {
        const data = await graphRes.json();
        tier = data.messaging_limit_tier || null;
        limit = tier != null ? tierLimits[tier] ?? null : null;
        if (!tier) reason = 'Meta returned no messaging_limit_tier for this number';
        else if (limit == null) reason = `Unmapped messaging_limit_tier "${tier}"`;
      } else {
        const body = await graphRes.text().catch(() => '');
        reason = `Graph API ${graphRes.status}${body ? ` — ${String(body).slice(0, 160)}` : ''}`;
      }
    } catch (err) {
      reason = err.name === 'AbortError' ? 'Graph API timed out' : `Graph API unreachable — ${err.message}`;
    }

    const available = tier != null;
    const quota = { tier, used, limit, available, ...(reason ? { reason } : {}) };
    const body = { quota, ...quota }; // top-level copies for pre-`quota` clients
    if (!available) console.warn(`[quota] ${bid}/${oid}: unavailable — ${reason}`);
    _quotaCache.set(cacheKey, { at: Date.now(), body });
    res.json(body);
  } catch (err) {
    console.error('quota lookup failed', err);
    res.status(500).json({ error: 'Could not fetch WhatsApp quota' });
  }
});

// Image conversion endpoint — fetches URL, converts to PNG via Sharp, returns base64
// Used by Supreme Admin for auto-converting status images on upload, and by
// onboarding to pre-convert template default images.
app.post('/api/images/convert', requireSuperOnly, async (req, res) => {
  const { imageUrl, maxWidth = 800, quality = 85 } = req.body || {};
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
    return res.status(400).json({ error: 'imageUrl must be a valid http(s) URL' });
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(imageUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`Image fetch ${resp.status}`);
    const inputBuf = Buffer.from(await resp.arrayBuffer());
    const pngBuf = await sharp(inputBuf)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .png({ quality, compressionLevel: 9 })
      .toBuffer();
    const base64 = `data:image/png;base64,${pngBuf.toString('base64')}`;
    res.json({ ok: true, base64, size: pngBuf.length });
  } catch (err) {
    console.error('Image conversion failed:', err);
    res.status(500).json({ error: `Conversion failed — ${err.message}` });
  }
});

// Batch convert multiple images (used during onboarding for template defaults)
app.post('/api/images/convert-batch', requireSuperOnly, async (req, res) => {
  const { images } = req.body || {}; // [{ key, url }]
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'images array required' });
  }
  const results = {};
  for (const img of images) {
    const { key, url } = img;
    if (!key || !url || !/^https?:\/\//.test(url)) {
      results[key] = { error: 'Invalid key or URL' };
      continue;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`Image fetch ${resp.status}`);
      const inputBuf = Buffer.from(await resp.arrayBuffer());
      const pngBuf = await sharp(inputBuf)
        .resize({ width: 800, withoutEnlargement: true })
        .png({ quality: 85, compressionLevel: 9 })
        .toBuffer();
      results[key] = {
        ok: true,
        base64: `data:image/png;base64,${pngBuf.toString('base64')}`,
        size: pngBuf.length
      };
    } catch (err) {
      results[key] = { error: err.message };
    }
  }
  res.json({ results });
});

// Message templates on the outlet's WABA (plan C3).
async function outletWabaId(bid, oid) {
  const outletSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp`).get();
  let wabaId = outletSnap.val()?.wabaId;
  if (!wabaId) {
    const wabas = await waGraph.listWabas();
    wabaId = wabas[0]?.id;
  }
  return wabaId;
}

app.get('/api/whatsapp/templates/:bid/:oid', async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  const { bid, oid } = req.params;
  try {
    const wabaId = await outletWabaId(bid, oid);
    if (!wabaId) return res.status(404).json({ error: 'No WABA available for this outlet' });
    const data = await waGraph.listTemplates(wabaId);
    res.json({ wabaId, templates: data.data || [] });
  } catch (err) {
    console.error('list templates failed', err);
    res.status(500).json({ error: `Could not list message templates — ${err.message}` });
  }
});

app.post('/api/whatsapp/templates/:bid/:oid', requireSuperOnly, async (req, res) => {
  if (!metaTokenSet()) return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  const { bid, oid } = req.params;
  const { name, category, language, body } = req.body || {};
  if (!name || !category || !body) return res.status(400).json({ error: 'name, category, and body are required' });
  try {
    const wabaId = await outletWabaId(bid, oid);
    if (!wabaId) return res.status(404).json({ error: 'No WABA available for this outlet' });
    await waGraph.createTemplate(wabaId, { name, category, language: language || 'en', body, variables: req.body.variables || {} });
    res.json({ ok: true, name });
  } catch (err) {
    // Idempotent install: if the template already exists on the WABA in this
    // language, Meta rejects re-creation with error_subcode 2388024 — treat
    // that as success instead of a 500.
    if (/already exists|2388024|Content in this language/i.test(err.message)) {
      return res.json({ ok: true, name, alreadyExists: true });
    }
    console.error('create template failed', err);
    res.status(500).json({ error: `Could not create message template — ${err.message}` });
  }
});

// ================================================================
// Media storage (Cloud Storage for Firebase) — batch 13
//   POST /tenant-api/upload        { dataUrl, type, id } -> { url }
//   POST /tenant-api/delete-image  { url }               -> { ok }
// Auth: requireTenantAdmin is mounted on /tenant-api, so businessId/outlet
// come from the VERIFIED token and never from the body — an admin can only
// ever write under its own outlets/{bid}/{oid}/ prefix.
// The bucket denies all client access (storage.rules); objects are served by
// a per-object download token embedded in the returned URL.
// ================================================================
const MEDIA_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'foodhubbie-10.firebasestorage.app';
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
// Object paths are browsed by humans when debugging; spell them properly.
const PLURAL = { dish: 'dishes', category: 'categories', combo: 'combos', setting: 'settings', rider: 'riders' };

function mediaSeg(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}
function mediaPrefix(bid, oid) {
  return `outlets/${mediaSeg(bid)}/${mediaSeg(oid)}/`;
}
function mediaPublicUrl(filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${MEDIA_BUCKET}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}
function mediaPathFromUrl(url) {
  const m = /\/o\/([^?#]+)/.exec(String(url || ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

app.post('/tenant-api/upload', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const { dataUrl, type, id } = req.body || {};
    const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
    if (!m) return res.status(400).json({ error: 'dataUrl must be a base64 image data URI' });
    if (!type || !id) return res.status(400).json({ error: 'type and id are required' });

    const mime = m[1].toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) return res.status(400).json({ error: `Unsupported image type ${mime}` });

    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return res.status(400).json({ error: 'Empty image' });
    if (buf.length > 6 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 6 MB)' });

    // Stored byte-for-byte — no re-encode, so a payment QR stays scannable and a
    // PNG keeps its transparency. The Admin and Rider apps already cap the size.
    const filePath = `${mediaPrefix(req.businessId, req.outlet)}${PLURAL[type] || `${mediaSeg(type)}s`}/${mediaSeg(id)}/original.${ext}`;
    const token = crypto.randomUUID();
    await admin.storage().bucket(MEDIA_BUCKET).file(filePath).save(buf, {
      resumable: false,
      metadata: {
        contentType: mime,
        cacheControl: 'public, max-age=31536000',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    res.json({ ok: true, url: mediaPublicUrl(filePath, token), path: filePath, bytes: buf.length });
  } catch (err) {
    console.error('media upload failed', err);
    res.status(500).json({ error: `Upload failed — ${err.message}` });
  }
});

app.post('/tenant-api/delete-image', async (req, res) => {
  try {
    const filePath = mediaPathFromUrl(req.body && req.body.url);
    if (!filePath) return res.status(400).json({ error: 'url is required' });
    if (!filePath.startsWith(mediaPrefix(req.businessId, req.outlet))) {
      return res.status(403).json({ error: 'Not an image of this outlet' });
    }
    await admin.storage().bucket(MEDIA_BUCKET).file(filePath).delete({ ignoreNotFound: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('media delete failed', err);
    res.status(500).json({ error: `Delete failed — ${err.message}` });
  }
});

// ================================================================
// Append-only send history for the Admin "Recent sends" list. Written with
// the Admin SDK (bypasses rules); a failure here must never fail the send,
// and the newest 20 rows per outlet are kept (push ids sort oldest-first).
async function logNotifySend(bid, oid, row) {
  try {
    const base = admin.database().ref(`businesses/${bid}/outlets/${oid}/notifyLog`);
    await base.push().set(row);
    const snap = await base.once('value');
    const keys = Object.keys(snap.val() || {}).sort();
    if (keys.length > 20) {
      const updates = {};
      for (const k of keys.slice(0, keys.length - 20)) updates[k] = null;
      await base.update(updates);
    }
  } catch (e) {
    console.warn('[notify-log] write failed:', e.message);
  }
}

// ================================================================
// Tenant-scoped push notification endpoint (Phase 3)
// POST /tenant-api/notify
// Auth: requireTenantAdmin (verifies admin belongs to this outlet)
// Body: { title, body, data?, testMode? }
// Sends data-only FCM multicast to this outlet's pushSubscriptions
// (Admin sw.js onBackgroundMessage owns the popup — a notification
// payload would double-popup). testMode → only the sender's device.
// ================================================================
app.post('/tenant-api/notify', async (req, res) => {
  try {
    const { title, body, data = {}, testMode, audience, phone, type } = req.body || {};
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }
    if (String(title).length > 100 || String(body).length > 300) {
      return res.status(400).json({ error: 'title or body is too long' });
    }

    const cleanPhone = String(phone || '').replace(/[^\d]/g, '').slice(-10);
    if (audience === 'phone' && !/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'A valid phone is required for this audience' });
    }
    const messageType = String(type || 'promo').slice(0, 20);
    const isTest = testMode === true || testMode === 'true' || data.testMode === 'true';
    // Row written to outlets/{oid}/notifyLog after every accepted send
    // (see logNotifySend) - the Admin tab's "Recent sends" list reads it.
    const historyRow = (sent, failed, inbox, total) => ({
      at: Date.now(),
      type: messageType,
      audience: isTest ? 'test' : (audience === 'phone' ? 'phone' : 'all'),
      ...(cleanPhone && audience === 'phone' && !isTest ? { phone: cleanPhone } : {}),
      title: String(title).slice(0, 100),
      sent, failed, inbox, total,
      test: isTest,
      by: req.adminUid || 'unknown',
    });

    const subsSnap = await admin.database()
      .ref(`businesses/${req.businessId}/outlets/${req.outlet}/pushSubscriptions`)
      .get();

    const subs = subsSnap.val() || {};
    let entries = Object.entries(subs).map(([key, sub]) => ({ key, ...sub }));

    if (audience === 'phone') {
      entries = entries.filter(e => String(e.phone || '') === cleanPhone);
    }

    // Promotional sends honour the customer's offers preference. Existing
    // records created before consent existed are treated as opted in.
    if (messageType !== 'order') {
      entries = entries.filter(e => !e.prefs || e.prefs.offers === true);
    }

    if (isTest) {
      const own = (await admin.database().ref(`admins/${req.adminUid}/fcmToken`).get()).val();
      entries = own ? [{ key: 'test', token: own, phone: null }] : [];
    }

    // Frequency cap + quiet-hours gating per recipient.
    // order-type pushes are transactional (always allowed, generous cap);
    // anything else is marketing (tight cap + quiet-hours suppression).
    const notifyType = messageType === 'order' ? 'order' : 'promo';
    const cappedEntries = [];
    for (const entry of entries) {
      const phone = String(entry.phone || '');
      if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
        // No valid phone — can't cap, let it through
        cappedEntries.push(entry);
        continue;
      }
      const cap = await checkAndConsumeCap(req.outlet, phone, notifyType, req.businessId);
      if (cap.allowed) {
        cappedEntries.push(entry);
      } else {
        console.log(`[notify-caps] broadcast suppressed for ${phone}: ${cap.reason}`);
      }
    }
    entries = cappedEntries;

    const tokens = entries.map(e => e.token).filter(Boolean);
    if (tokens.length === 0) {
      await logNotifySend(req.businessId, req.outlet, historyRow(0, 0, 0, 0));
      return res.json({ ok: true, sent: 0, inbox: 0, message: 'No subscribers for this outlet' });
    }

    const menuOrigin = (process.env.MENU_WEB_ORIGIN || 'https://menu.foodhubbie.in').replace(/\/$/, '');
    const link = `${menuOrigin}/${encodeURIComponent(req.outlet)}/delivery.html?o=${encodeURIComponent(req.outlet)}&b=${encodeURIComponent(req.businessId)}&tab=notifications`;

    // Persist an in-app inbox entry per subscribed phone, independent of FCM
    // delivery. This is what the customer sees under Promotions > Notifications.
    const phoneSet = new Set(entries.map(e => String(e.phone || '')).filter(p => /^[6-9]\d{9}$/.test(p)));
    let inboxCount = 0;
    if (!isTest) {
      for (const customerPhone of phoneSet) {
        try {
            const phoneInboxRef = admin.database()
                .ref(`businesses/${req.businessId}/outlets/${req.outlet}/pushInbox/${customerPhone}`);
            await phoneInboxRef.push({
                title: String(title).slice(0, 100),
                body: String(body).slice(0, 300),
                type: messageType,
                sentAt: Date.now(),
                ...(data.orderId ? { orderId: String(data.orderId).slice(0, 100) } : {}),
                ...(data.status ? { status: String(data.status).slice(0, 40) } : {}),
                url: link
            });
            await prunePushInbox(phoneInboxRef);
            inboxCount += 1;
        } catch (e) {
          console.warn('inbox write failed', e.message);
        }
      }
    }

    // FCM data values must be flat strings
    const flat = Object.fromEntries(
      Object.entries({ title, body, ...data, type: messageType, url: link, outlet: req.outlet, business: req.businessId })
        .map(([k, v]) => [k, String(v)])
    );

    const message = {
      tokens,
      data: flat,
      android: { priority: 'high' },
      apns: { payload: { aps: { 'content-available': 1 } } },
      webpush: { fcmOptions: { link } },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    const successCount = response.responses.filter(r => r.success).length;
    const failureCount = response.responses.length - successCount;

    if (failureCount > 0) {
      const deadCodes = new Set([
        'messaging/registration-token-not-registered',
        'messaging/invalid-argument',
        'messaging/invalid-registration-token'
      ]);
      await Promise.all(response.responses.map(async (r, i) => {
        if (r.success) return;
        const token = tokens[i];
        const entry = entries.find(e => e.token === token);
        const code = r.error?.code || 'unknown';
        console.warn(`FCM send failed for token ${token.slice(0, 12)}...: ${r.error?.message || r.error}`);
        if (deadCodes.has(code) && entry && entry.key !== 'test') {
          await admin.database()
            .ref(`businesses/${req.businessId}/outlets/${req.outlet}/pushSubscriptions/${entry.key}`)
            .remove()
            .catch(() => {});
        }
      }));
    }

    await logNotifySend(req.businessId, req.outlet, historyRow(successCount, failureCount, inboxCount, tokens.length));

    res.json({ ok: true, sent: successCount, failed: failureCount, total: tokens.length, inbox: inboxCount });
  } catch (err) {
    console.error('tenant-api/notify failed', err);
    res.status(500).json({ error: `Notification send failed - ${err.message}` });
  }
});

// ================================================================
// Daily auto-settlement cron (Phase 2)
// Runs once per day at the configured hour (default: 23:00 server time).
// For every rider with pending cash (totalEarnings − settled > 0), creates
// a settlement record so the admin can review/pay and the rider can confirm
// receipt. No money moves — this is a record-keeping step that matches the
// rider app's "Confirm Received" flow.
// ================================================================

const SETTLEMENT_LAST_RUN_PATH = 'meta/dailySettlementLastRun';

async function runDailySettlement(admin) {
  const today = new Date().toISOString().slice(0, 10);
  const lastRunSnap = await admin.database().ref(SETTLEMENT_LAST_RUN_PATH).get();
  if (lastRunSnap.val() === today) return; // already ran today
  await admin.database().ref(SETTLEMENT_LAST_RUN_PATH).set(today);

  try {
    // Enumerate riders per outlet (riders are outlet-scoped like staff since
    // the 2026-10-28 migration; there is no global riders node any more).
    const businessesSnap = await admin.database().ref('businesses').get();
    const businesses = businessesSnap.val() || {};

    for (const [bid, business] of Object.entries(businesses)) {
      const outlets = (business && business.outlets) || {};
      for (const oid of Object.keys(outlets)) {
        const base = `businesses/${bid}/outlets/${oid}`;
        const ridersSnap = await admin.database().ref(`${base}/riders`).get();
        const riders = ridersSnap.val() || {};

        for (const uid of Object.keys(riders)) {
          const statsSnap = await admin.database().ref(`${base}/riderStats/${uid}`).get();
          const stats = statsSnap.val() || { totalEarnings: 0, totalOrders: 0 };
          const totalEarnings = stats.totalEarnings || 0;

          // Sum already-settled amounts
          const settleSnap = await admin.database().ref(`${base}/settlements/${uid}`).get();
          const settlements = settleSnap.val() || {};
          const settledTotal = Object.values(settlements).reduce(
            (sum, s) => sum + (s?.amountCollected || 0),
            0
          );

          const pendingCash = Math.max(0, totalEarnings - settledTotal);
          if (pendingCash <= 0) continue;

          // Create settlement record
          const settlementRef = admin.database().ref(`${base}/settlements/${uid}`).push();
          await settlementRef.set({
            amountCollected: pendingCash,
            ordersClearedCount: stats.totalOrders || 0,
            settledByAdmin: 'Auto-Settlement (Daily Cron)',
            timestamp: Date.now(),
            source: 'daily-auto-settlement',
            riderAck: null,
          });

          console.log(`[Auto-Settlement] Created settlement for rider ${uid} (${bid}/${oid}): ₹${pendingCash}`);
        }
      }
    }
  } catch (err) {
    console.error('[Auto-Settlement] Failed:', err);
  }
}

// Check every hour whether it's time to run the daily settlement (default 23:00)
const SETTLEMENT_HOUR = parseInt(process.env.DAILY_SETTLEMENT_HOUR || '23', 10);
setInterval(() => {
  if (new Date().getHours() === SETTLEMENT_HOUR) {
    runDailySettlement(admin).catch((err) => console.error('[Auto-Settlement] Interval error:', err));
  }
}, 60 * 60 * 1000).unref();

console.log(`[Auto-Settlement] Daily scheduler armed for ${SETTLEMENT_HOUR}:00 server time`);

// D2: once a day, expire auto-onboarded tenants whose email was never verified.
// First pass 10 minutes after boot, then every 24h. Log-only unless
// ONBOARDING_CLEANUP=enforce.
setTimeout(() => {
  runUnverifiedCleanup().catch((err) => console.error('[onboarding-cleanup] failed:', err));
  setInterval(() => {
    runUnverifiedCleanup().catch((err) => console.error('[onboarding-cleanup] failed:', err));
  }, 24 * 60 * 60 * 1000).unref();
}, 10 * 60 * 1000).unref();
console.log(`[onboarding-cleanup] armed — 72h unverified TTL, ${CLEANUP_ENFORCE ? 'ENFORCING' : 'observe mode'}`);

// ================================================================

app.listen(PORT, () => console.log(`Bot Control API listening on :${PORT}`));

startAutoApproval();
startStatusWatcher({ admin, processName, statusOf }).catch((err) => {
  console.error('Status watcher failed to start — bot status will not be real-time until this is fixed', err);
});

startWalletWatcher({ admin }).catch((err) => {
  console.error('Wallet gate watcher failed to start — the D4 gate will stay stale until this is fixed', err);
});

startMetaCostPublisher({ admin }).catch((err) => {
  console.error('Meta cost publisher failed to start — the _metaCostGuard will stay disarmed until this is fixed', err);
});

startOrchestrator({ admin, processName, nextHealthPort }).catch((err) => {
  console.error('Orchestrator failed to start — bots will not auto-start on WhatsApp link until this is fixed', err);
});
