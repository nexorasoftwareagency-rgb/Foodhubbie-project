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
const { startOrchestrator } = require('./orchestrator');

const PORT = process.env.BOT_CONTROL_PORT || 4000;

// Dashboard and API are different origins (Firebase Hosting vs the
// Cloudflare Tunnel domain), and every dashboard request sends an
// Authorization header, so this needs real CORS handling — without it
// every restart/stop/reconnect/quota/bulk-restart call fails in the
// browser before it reaches any route below. Set DASHBOARD_ORIGIN in
// production instead of leaving the '*' default.
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || '*';

// Uses the same Firebase project as the dashboard and bot workers.
// Set GOOGLE_APPLICATION_CREDENTIALS or pass a service account explicitly.
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', DASHBOARD_ORIGIN);
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204); // preflight — must resolve before requireAuth below
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

app.use('/api', requireAuth);

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
    await admin.database().ref(`admins/${uid}`).set({
      email, outlet: oid, name: outletName, role: 'Admin', businessId: bid,
    });
    await admin.database().ref(`businesses/${bid}/outlets/${oid}/adminLogin`).set({ email, password: newPassword });
    res.json({ ok: true, uid });
  } catch (err) {
    console.error('update-password failed', err);
    res.status(500).json({ error: `Password update failed — ${err.message}` });
  }
});

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
// Flow: oauth code → user access token → debug_token → business → WABA →
// first phone number → save records (same write as Path B register).
app.post('/api/whatsapp/exchange', requireSuperOnly, async (req, res) => {
  const { bid, oid, code } = req.body || {};
  if (!bid || !oid || !code) return res.status(400).json({ error: 'bid, oid, and code are required' });
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return res.status(501).json({ error: 'META_APP_ID / META_APP_SECRET not configured' });

  try {
    const tokenRes = await fetch(
      `https://graph.facebook.com/v20.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
    );
    if (!tokenRes.ok) throw new Error(`oauth exchange failed — Graph API ${tokenRes.status}`);
    const { access_token: userToken } = await tokenRes.json();
    if (!userToken) throw new Error('oauth exchange returned no access token');

    const debugRes = await fetch(
      `https://graph.facebook.com/v20.0/debug_token?input_token=${encodeURIComponent(userToken)}&access_token=${appId}|${appSecret}`
    );
    if (!debugRes.ok) throw new Error(`debug_token failed — Graph API ${debugRes.status}`);
    const { data: debug } = await debugRes.json();
    const businessId = debug?.granular_scopes?.find((s) => s.scope === 'whatsapp_business_management')?.target_id
      || debug?.business_id;

    let wabaId = null;
    let phone = null;
    if (businessId) {
      const bizRes = await fetch(
        `https://graph.facebook.com/v20.0/${businessId}/owned_whatsapp_business_accounts?fields=id,name`,
        { headers: { Authorization: `Bearer ${userToken}` } }
      );
      if (bizRes.ok) {
        const biz = await bizRes.json();
        const waba = biz?.data?.[0];
        wabaId = waba?.id;
        if (wabaId) {
          const numRes = await fetch(
            `https://graph.facebook.com/v20.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
            { headers: { Authorization: `Bearer ${userToken}` } }
          );
          if (numRes.ok) {
            const nums = await numRes.json();
            phone = nums?.data?.[0] || null;
          }
        }
      }
    }
    if (!wabaId || !phone) {
      throw new Error('No WABA / phone number found for this Meta account');
    }
    const result = await waLinkSuccess(bid, oid, {
      phoneNumberId: phone.id,
      wabaId,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name,
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
app.get('/api/whatsapp/quota/:bid/:oid', async (req, res) => {
  if (!process.env.META_SYSTEM_USER_TOKEN) {
    return res.status(501).json({ error: 'META_SYSTEM_USER_TOKEN not configured' });
  }
  const { bid, oid } = req.params;
  try {
    const snap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp`).get();
    const wa = snap.val();
    if (!wa?.phoneNumberId) return res.status(404).json({ error: 'No WhatsApp phone number linked yet' });

    // messaging_limit_tier tells you the CAP, not current usage — Meta
    // doesn't expose a running "messages sent today" count on this
    // field. The bot writes an atomic per-IST-day send counter into
    // outlet.whatsapp/usage/{date} on every successful meta-transport send
    // (bot/index.js), so `used` is real, not a placeholder.
    const graphRes = await fetch(`https://graph.facebook.com/v20.0/${wa.phoneNumberId}?fields=messaging_limit_tier`, {
      headers: { Authorization: `Bearer ${process.env.META_SYSTEM_USER_TOKEN}` },
    });
    if (!graphRes.ok) throw new Error(`Graph API responded ${graphRes.status}`);
    const data = await graphRes.json();
    const tierLimits = { TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: 1000000 };
    const limit = tierLimits[data.messaging_limit_tier] || 1000;

    // Same IST day the bot keys by (UTC+5:30, date split at midnight IST).
    const day = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
    const usageSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/whatsapp/usage/${day}`).get();
    const used = usageSnap.val() || 0;

    res.json({ tier: data.messaging_limit_tier || 'TIER_1K', used, limit });
  } catch (err) {
    console.error('quota lookup failed', err);
    res.status(500).json({ error: 'Could not fetch WhatsApp quota' });
  }
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

app.listen(PORT, () => console.log(`Bot Control API listening on :${PORT}`));

startStatusWatcher({ admin, processName, statusOf }).catch((err) => {
  console.error('Status watcher failed to start — bot status will not be real-time until this is fixed', err);
});

startOrchestrator({ admin, processName, nextHealthPort }).catch((err) => {
  console.error('Orchestrator failed to start — bots will not auto-start on WhatsApp link until this is fixed', err);
});
