/**
 * Orchestrator — auto-start/stop a bot worker when a Meta number is linked.
 *
 * Watches `businesses/{bid}/outlets/{oid}/whatsapp.status` in Firebase. When a
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
function desiredState(outlet) {
  if (!outlet || !outlet.whatsapp) return null; // not ours — never touch
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
      { name, cwd: botDir, script: 'index.js', env, autorestart: true, max_restarts: 20, min_uptime: 10000 },
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

async function watchOutlets({ admin, processName, nextHealthPort, bid, bizSnapRef }) {
  const onOutlet = (snap) => {
    handleOutletChange({ admin, processName, nextHealthPort, bid, oid: snap.key, outlet: snap.val() })
      .catch((err) => console.error(`[orchestrator] outlet change failed for ${bid}/${snap.key}:`, err.message));
  };
  bizSnapRef.child('outlets').on('child_added', onOutlet);
  bizSnapRef.child('outlets').on('child_changed', onOutlet);
  bizSnapRef.child('outlets').on('child_removed', (snap) => {
    // Outlet gone = restaurant gone → its bot should stop (regardless of who
    // started it; the manual delete API stops it too). Check pm2 first so a
    // missing worker is a no-op, not a rejected stop.
    pm2List()
      .then(async (list) => {
        if (await pm2Has(list, processName(bid, snap.key))) {
          await stopWorker(processName, bid, snap.key);
        }
      })
      .catch((err) => console.error(`[orchestrator] outlet removal failed for ${bid}/${snap.key}:`, err.message));
  });
}

async function startOrchestrator({ admin, processName, nextHealthPort }) {
  await connectOnce();
  const businessesRef = admin.database().ref('businesses');

  // Initial reconcile — boot/reconnect must not leave active outlets stranded.
  try {
    const snap = await businessesRef.get();
    const businesses = snap.val() || {};
    for (const [bid, biz] of Object.entries(businesses)) {
      for (const [oid, outlet] of Object.entries(biz.outlets || {})) {
        await handleOutletChange({ admin, processName, nextHealthPort, bid, oid, outlet });
      }
    }
    console.log('[orchestrator] initial reconcile complete');
  } catch (err) {
    console.error('[orchestrator] initial reconcile failed:', err.message);
  }

  businessesRef.on('child_added', (bizSnap) => {
    watchOutlets({ admin, processName, nextHealthPort, bid: bizSnap.key, bizSnapRef: bizSnap.ref });
  });
  businessesRef.on('child_removed', (bizSnap) => {
    // Business deleted → stop its workers. The outlet removal listeners die
    // with the snap, so stop workers for every known outlet id can't be known
    // here — stop by scanning pm2 for the prefix instead.
    const prefix = processName(bizSnap.key, '');
    pm2List()
      .then((list) => Promise.all(
        list
          .filter((p) => p.name && p.name.startsWith(prefix))
          .map((p) => stopWorker(processName, bizSnap.key, p.name.slice(prefix.length)))
      ))
      .catch((err) => console.error(`[orchestrator] business removal cleanup failed for ${bizSnap.key}:`, err.message));
  });

  console.log('[orchestrator] watching businesses/ for whatsapp.status changes');
}

module.exports = { startOrchestrator };
