/**
 * Orchestrator — auto-start/stop a bot worker when a Meta number is linked.
 *
 * Watches `businesses/{bid}/outlets/{oid}/whatsapp/status` in Firebase. When a
 * number becomes `active` (Supreme Admin Embedded Signup / Path B wrote it),
 * this starts the PM2 worker `bot-{bid}-{oid}` and writes the
 * `phoneNumberIndex/{phoneNumberId}` routing entry the webhook server depends
 * on. When the outlet is suspended, unlinked, or removed, it stops the worker.
 *
 * Deliberately lives INSIDE bot-control-api (not a standalone PM2 process as
 * MASTER-DEPLOYMENT-GUIDE-V3 §10 sketched): a second pm2 daemon connection on
 * the same box is the exact conflict pm2-client.js was built to prevent (it
 * silently kills status-watcher's event-bus listener). Reuses the shared
 * connectOnce / processName / nextHealthPort instead.
 *
 * Scope: this only manages outlets that have a `whatsapp` node. Baileys-only
 * outlets (no `whatsapp.status`) are started manually via /api/bot/provision
 * and are NEVER touched here — the two flows never fight over a worker.
 *
 * EGRESS (2026-11-10, batch 14): discovery is a read of the canonical
 * `outletIndex` registry at boot (a few KB) — the `businesses` tree is only
 * read if that registry is empty; change detection is per-outlet leaf
 * listeners, never a listener on `businesses` or on an outlet subtree. See the
 * note above OUTLET_LEAVES for the measurement.
 */

const { pm2, connectOnce } = require('./pm2-client');

function pm2List() {
  return new Promise((resolve, reject) => pm2.list((err, list) => (err ? reject(err) : resolve(list))));
}

async function pm2Has(list, name) {
  return list.some((p) => p.name === name);
}

// Whether this outlet should run a bot. Outlets with no `whatsapp` node at all
// are out of orchestrator scope entirely (manual/baileys provisioning owns them).
//
// The guard is on `whatsapp.status`, NOT on `whatsapp` existing: a template
// status webhook writes `whatsapp/templates/*`, which creates the parent node
// without ever touching `status`. Treating that as "ours" made desiredState()
// false, and the stop branch then killed a worker it had itself provisioned
// (`bot.source === 'orchestrator'`) — a live Baileys bot taken down by a
// template approval. No status = still not ours.
function desiredState(outlet) {
  if (!outlet || !outlet.whatsapp || !outlet.whatsapp.status) return null;
  const shouldRun = outlet.whatsapp.status === 'active' && outlet.suspended !== true;
  return shouldRun;
}

async function startWorker(admin, processName, nextHealthPort, bid, oid, outlet) {
  const name = processName(bid, oid);
  const botDir = require('path').join(__dirname, '..', 'bot');

  const env = {
    OUTLET: oid,
    BUSINESS_ID: bid,
    OUTLET_ID: oid,
    BOT_TRANSPORT: 'meta',
    HEALTH_PORT: String(await nextHealthPort()),
    PHONE_NUMBER_ID: outlet.whatsapp.phoneNumberId,
    // Bot reads WA_PERMANENT_TOKEN directly for meta sends (bot/index.js) —
    // pass it explicitly because pm2 children don't inherit the caller's env.
    WA_PERMANENT_TOKEN: process.env.WA_PERMANENT_TOKEN || '',
    REDIS_URL: process.env.REDIS_URL || '',
    FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com',
  };

  await new Promise((resolve, reject) => {
    pm2.start(
      { name, cwd: botDir, script: 'index.js', env, autorestart: true, max_restarts: 20, min_uptime: 10000, max_memory_restart: '600M' },
      (err, proc) => (err ? reject(err) : resolve(proc))
    );
  });
  await new Promise((resolve, reject) => pm2.dump((err) => (err ? reject(err) : resolve())));

  // Routing index the webhook server needs to deliver inbound messages.
  await admin.database()
    .ref(`phoneNumberIndex/${outlet.whatsapp.phoneNumberId}`)
    .set({ businessId: bid, outletId: oid });

  // Mark ownership so a later suspend/removal only stops workers WE started
  // (a manually-provisioned baileys bot is the dashboard's to stop). Don't
  // clobber an existing transport choice — the bot reads Firebase bot/transport
  // first (transport.js), and the env BOT_TRANSPORT above is just the fallback.
  const botPatch = { provisionedAt: admin.database.ServerValue.TIMESTAMP, source: 'orchestrator' };
  const botSnap = await admin.database().ref(`businesses/${bid}/outlets/${oid}/bot`).get();
  if (!botSnap.exists() || !botSnap.val()?.transport) botPatch.transport = 'meta';
  await admin.database().ref(`businesses/${bid}/outlets/${oid}/bot`).update(botPatch);
  console.log(`[orchestrator] started ${name}`);
}

async function stopWorker(processName, bid, oid) {
  const name = processName(bid, oid);
  await new Promise((resolve, reject) => {
    pm2.stop(name, (err) => (err ? reject(err) : resolve()));
  });
  await new Promise((resolve, reject) => pm2.dump((err) => (err ? reject(err) : resolve())));
  console.log(`[orchestrator] stopped ${name}`);
}

// Reconcile one outlet against PM2's actual process list. Every pm2 call goes
// through list() first so rapid child_changed events can't double-start.
async function handleOutletChange({ admin, processName, nextHealthPort, bid, oid, outlet }) {
  await connectOnce();
  const name = processName(bid, oid);
  const shouldRun = desiredState(outlet);
  if (shouldRun === null) return; // not a meta-managed outlet

  const list = await pm2List();
  const running = await pm2Has(list, name);

  if (shouldRun && !running) {
    // A meta worker is useless (and will crash-loop) without a number to serve.
    if (!outlet.whatsapp.phoneNumberId) {
      console.warn(`[orchestrator] ${bid}/${oid} is active but has no phoneNumberId — skipping start`);
      return;
    }
    await startWorker(admin, processName, nextHealthPort, bid, oid, outlet);
  } else if (!shouldRun && running) {
    // Stop only workers THIS orchestrator started — a manually-provisioned
    // baileys worker (source not set by us) is the dashboard's to stop.
    if (outlet?.bot?.source === 'orchestrator') {
      await stopWorker(processName, bid, oid);
    }
  }
}

// ---------------------------------------------------------------------------
// EGRESS: never listen on `businesses` (or on an outlet subtree).
//
// The previous implementation held `.on('child_added')` on `businesses` plus
// three listeners per business on `outlets`. RTDB sends the ENTIRE subtree to a
// listener the moment it attaches, so every attach cost the whole 5.00 MB tree
// (2.85 MB of it the pizza outlet — base64 `settings/Bot` images and dishes),
// and every socket reconnect re-attached and re-downloaded all of it. Measured
// 2026-11-10: one `listener-listen` on `businesses` = 5,274,244 bytes from the
// EC2 box, repeating on a ~5 minute cycle — ~1.5 GB/day on its own, and it
// multiplies by outlet count.
//
// The reconciler only reads four scalar fields, so it now watches those leaves
// (a few bytes each) and reads the rest on demand.
// ---------------------------------------------------------------------------
const OUTLET_LEAVES = (bid, oid) => {
  const base = `businesses/${bid}/outlets/${oid}`;
  return {
    status: `${base}/whatsapp/status`,
    suspended: `${base}/suspended`,
    phoneNumberId: `${base}/whatsapp/phoneNumberId`,
    botSource: `${base}/bot/source`,
  };
};

// Rebuild just enough of the outlet shape for desiredState/handleOutletChange.
// Deliberately NOT `businesses/{bid}/outlets/{oid}` — that pulls the images.
async function readOutletState(admin, bid, oid) {
  const p = OUTLET_LEAVES(bid, oid);
  const db = admin.database();
  // `whatsapp/status` decides scope on its own (desiredState -> null without
  // it), so ONE read dismisses an outlet that is not ours. The other three are
  // only worth fetching for an outlet that is.
  const status = await db.ref(p.status).get();
  if (!status.exists()) return {};

  const [phoneNumberId, suspended, botSource] = await Promise.all([
    db.ref(p.phoneNumberId).get(),
    db.ref(p.suspended).get(),
    db.ref(p.botSource).get(),
  ]);
  const outlet = { whatsapp: { status: status.val(), phoneNumberId: phoneNumberId.val() } };
  if (suspended.exists()) outlet.suspended = suspended.val();
  if (botSource.exists()) outlet.bot = { source: botSource.val() };
  return outlet;
}

// One reconcile per outlet at a time: `whatsapp/status` and `suspended` can
// fire together, and two concurrent pm2 list→start sequences would both see
// "not running".
const inFlight = new Set();

async function reconcileOutlet({ admin, processName, nextHealthPort, bid, oid }) {
  const key = `${bid}/${oid}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const outlet = await readOutletState(admin, bid, oid);
    await handleOutletChange({ admin, processName, nextHealthPort, bid, oid, outlet });
  } catch (err) {
    console.error(`[orchestrator] outlet change failed for ${bid}/${oid}:`, err.message);
  } finally {
    inFlight.delete(key);
  }
}

async function startOrchestrator({ admin, processName, nextHealthPort }) {
  await connectOnce();
  const db = admin.database();

  // Discovery: the canonical `outletIndex` registry PLUS the ids pm2 already
  // holds in each worker's spawn env.
  //
  // EGRESS (batch 14): the boot scan read the WHOLE `businesses` tree — 3.06 MB
  // on 2026-11-10, growing with every outlet's photos — on every restart, and
  // bot-control-api had restarted 72 times. The Admin SDK has no `shallow()`, so
  // a key-only scan of the tree is not available. The registry is a few KB, and
  // a worker started by this orchestrator carries BUSINESS_ID/OUTLET_ID in its
  // own environment, so nothing is lost.
  //
  // It must stay COMPLETE: `outletIndex` is missing 13 tree outlets, and one of
  // them (the e2e tenant) is genuinely in scope — whatsapp.status 'active' AND
  // bot.source 'orchestrator'. Reconciling from the registry alone would
  // silently stop managing it.
  const discovered = new Map();
  const addOutlet = (bid, oid) => {
    if (bid && oid) discovered.set(`${bid}/${oid}`, { bid, oid });
  };
  try {
    const idx = (await db.ref('outletIndex').get()).val() || {};
    for (const [oid, entry] of Object.entries(idx)) {
      addOutlet(typeof entry === 'string' ? entry : entry && entry.bid, oid);
    }
  } catch (err) {
    console.error('[orchestrator] registry read failed:', err.message);
  }
  try {
    for (const p of await pm2List()) {
      const env = (p.pm2_env && p.pm2_env.env) || {};
      if (env.BUSINESS_ID && env.OUTLET_ID) addOutlet(env.BUSINESS_ID, env.OUTLET_ID);
    }
  } catch (err) {
    console.error('[orchestrator] pm2 list failed:', err.message);
  }
  if (!discovered.size) {
    console.warn('[orchestrator] nothing in outletIndex or pm2 — falling back to a full businesses scan');
    try {
      const businesses = (await db.ref('businesses').get()).val() || {};
      for (const [bid, biz] of Object.entries(businesses)) {
        for (const oid of Object.keys((biz && biz.outlets) || {})) addOutlet(bid, oid);
      }
    } catch (err) {
      console.error('[orchestrator] initial reconcile failed:', err.message);
    }
  }

  const watched = new Set();
  const watchOutlet = (bid, oid) => {
    if (!bid || !oid || watched.has(`${bid}/${oid}`)) return;
    watched.add(`${bid}/${oid}`);
    const p = OUTLET_LEAVES(bid, oid);
    const onChange = () => {
      reconcileOutlet({ admin, processName, nextHealthPort, bid, oid })
        .catch((err) => console.error(`[orchestrator] outlet change failed for ${bid}/${oid}:`, err.message));
    };
    db.ref(p.status).on('value', onChange);
    db.ref(p.suspended).on('value', onChange);
  };

  for (const { bid, oid } of discovered.values()) {
    watchOutlet(bid, oid);
    // The same four leaves the reconcile path uses — never the outlet subtree.
    await handleOutletChange({
      admin, processName, nextHealthPort, bid, oid,
      outlet: await readOutletState(admin, bid, oid),
    });
  }
  console.log(`[orchestrator] initial reconcile complete (${watched.size} outlets)`);

  // New tenants arrive through Supreme onboarding and POST /api/bot/... —
  // both write `outletIndex`, so this is the live discovery channel. Also
  // covers deletion: onboarding cleanup removes the outletIndex row.
  db.ref('outletIndex').on('child_added', (snap) => {
    const entry = snap.val() || {};
    const bid = entry.bid || entry.businessId;
    if (bid) watchOutlet(bid, snap.key);
  });
  db.ref('outletIndex').on('child_removed', (snap) => {
    const bid = (snap.val() || {}).bid || (snap.val() || {}).businessId;
    if (!bid) return;
    const oid = snap.key;
    watched.delete(`${bid}/${oid}`);
    pm2List()
      .then(async (list) => {
        if (await pm2Has(list, processName(bid, oid))) await stopWorker(processName, bid, oid);
      })
      .catch((err) => console.error(`[orchestrator] outlet removal failed for ${bid}/${oid}:`, err.message));
  });

  console.log('[orchestrator] watching outletIndex + whatsapp/status leaves');
}

module.exports = { startOrchestrator, desiredState };
