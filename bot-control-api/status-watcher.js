/**
 * Makes bot status real-time instead of dashboard-polled.
 *
 * - Listens to PM2's event bus for process online/restart/stop/exit
 *   events and reconciles on each one (debounced), plus a 30s safety-net
 *   interval so uptime/memory don't go stale between events.
 * - Writes businesses/{bid}/outlets/{oid}/botStatus = { status, uptime,
 *   memory, updatedAt } directly to Firebase — the dashboard's Fleet and
 *   Profile pages already listen to this tree, so they update live with
 *   zero polling.
 * - Appends a capped rolling history (last 48 *transitions*, not every
 *   tick) under botStatus/history for the 24h sparkline.
 * - Alerts to Slack when an outlet has been offline/errored past
 *   ALERT_OFFLINE_MINUTES (default 5), and again when it recovers.
 *
 * Resolving a PM2 process name back to {bid, oid}: rather than parsing
 * "bot-{bid}-{oid}" apart (unsafe — Firebase push IDs contain dashes, so
 * this is ambiguous to split), this builds a name→{bid,oid} index from the
 * tiny `outletIndex` registry plus each pm2 process's own spawn env, using the
 * same processName() the rest of the API uses to build names in the first
 * place. Exact-match lookup only. It must never read the `businesses` tree.
 *
 * PM2 connection: shared with server.js's HTTP routes via pm2-client.js
 * (connect once, never disconnect mid-process) — see that file for why
 * this matters. Do not call pm2.connect()/pm2.disconnect() directly here.
 *
 * Single-instance assumption: this assumes one Bot Control API process
 * is running the watcher (true for a single EC2 box behind PM2). If you
 * ever run more than one, move `lastKnownStatus` / `offlineSince` /
 * `alerted` out of module memory (e.g. into Firebase) so instances agree.
 */

const { pm2, connectOnce } = require('./pm2-client');

const HISTORY_CAP = 48;
const RECONCILE_INTERVAL_MS = 30000;
const EVENT_DEBOUNCE_MS = 1500;

const lastKnownStatus = new Map(); // `${bid}/${oid}` -> last written status
const offlineSince = new Map();    // `${bid}/${oid}` -> ms timestamp
const alerted = new Map();         // `${bid}/${oid}` -> true once alerted for the current outage

function pm2List() {
  return new Promise((resolve, reject) => pm2.list((err, list) => (err ? reject(err) : resolve(list))));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const INDEX_TTL_MS = 5 * 60 * 1000;
let indexCache = { at: 0, map: null };

/**
 * Registry-first name index. `outletIndex` is the canonical outlet→business map
 * and is a few KB; the old implementation read the WHOLE `businesses` tree
 * (~6 MB with one outlet's photos) every 30 seconds.
 *
 * Outlets that predate the registry (E2E tenants, the demo) are resolved from
 * the pm2 process's own spawn env instead: the orchestrator starts every worker
 * with BUSINESS_ID/OUTLET_ID, so the ids are already in memory on the box.
 * This used to fall back to reading the full `businesses` tree once every six
 * hours - a 5 MB download to learn something pm2 already knew.
 */
async function buildProcessNameIndex(admin, processName, pm2Processes = []) {
  if (indexCache.map && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.map;

  const snap = await admin.database().ref('outletIndex').get();
  const entries = snap.val() || {};
  const index = new Map();
  Object.entries(entries).forEach(([oid, entry]) => {
    const bid = typeof entry === 'string' ? entry : entry && entry.bid;
    if (bid) index.set(processName(bid, oid), { bid, oid });
  });

  const unresolved = [];
  for (const p of pm2Processes) {
    const name = p && p.name;
    if (!name || !name.startsWith('bot-') || index.has(name)) continue;
    const env = (p.pm2_env && p.pm2_env.env) || {};
    if (env.BUSINESS_ID && env.OUTLET_ID) {
      index.set(name, { bid: env.BUSINESS_ID, oid: env.OUTLET_ID });
    } else {
      unresolved.push(name);
    }
  }
  if (unresolved.length) {
    // Loud on purpose: a worker with no env ids cannot be mirrored into
    // botStatus, and resolving it from the database is what we are avoiding.
    console.warn(`[status-watcher] cannot map pm2 apps to outlets (no BUSINESS_ID/OUTLET_ID): ${unresolved.join(', ')}`);
  }

  indexCache = { at: Date.now(), map: index };
  return index;
}

/** Human labels are only needed when an alert fires — read them then, not on
 *  every reconcile tick. */
async function outletLabel(admin, bid, oid) {
  try {
    const [outlet, business] = await Promise.all([
      admin.database().ref(`businesses/${bid}/outlets/${oid}/name`).get(),
      admin.database().ref(`businesses/${bid}/name`).get(),
    ]);
    return `${outlet.val() || oid} (${business.val() || bid})`;
  } catch {
    return `${oid} (${bid})`;
  }
}

async function appendHistory(admin, bid, oid, status) {
  const histRef = admin.database().ref(`businesses/${bid}/outlets/${oid}/botStatus/history`);
  await histRef.push({ status, at: Date.now() });

  // trim to the last HISTORY_CAP entries — push keys sort chronologically,
  // so walking the snapshot in order gives us oldest-first for free
  const snap = await histRef.once('value');
  const keys = [];
  snap.forEach((child) => { keys.push(child.key); });
  if (keys.length > HISTORY_CAP) {
    const updates = {};
    keys.slice(0, keys.length - HISTORY_CAP).forEach((k) => { updates[k] = null; });
    await histRef.update(updates);
  }
}

async function sendAlert(message) {
  console.warn('[bot-alert]', message);
  if (process.env.SLACK_ALERT_WEBHOOK_URL) {
    try {
      await fetch(process.env.SLACK_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
    } catch (err) {
      console.error('Slack alert failed to send', err);
    }
  }
  // TODO: add an email channel here (SES/SendGrid/etc.) if you want both —
  // left out since it needs credentials this build doesn't have.
}

async function handleAlerting(admin, { key, bid, oid, status }) {
  const OFFLINE_STATUSES = new Set(['offline', 'errored']);
  const thresholdMs = (Number(process.env.ALERT_OFFLINE_MINUTES) || 5) * 60000;

  if (!OFFLINE_STATUSES.has(status)) {
    offlineSince.delete(key);
    if (alerted.get(key)) {
      alerted.delete(key);
      await sendAlert(`✅ ${await outletLabel(admin, bid, oid)} bot is back online.`);
    }
    return;
  }

  if (!offlineSince.has(key)) {
    offlineSince.set(key, Date.now()); // just went down this cycle — start the clock, don't alert yet
    return;
  }

  const downForMs = Date.now() - offlineSince.get(key);
  if (downForMs >= thresholdMs && !alerted.get(key)) {
    alerted.set(key, true);
    await sendAlert(`🔴 ${await outletLabel(admin, bid, oid)} bot has been ${status} for ${Math.round(downForMs / 60000)}+ minutes.`);
  }
}

async function reconcile({ admin, processName, statusOf }) {
  await connectOnce();
  const list = await pm2List();
  const index = await buildProcessNameIndex(admin, processName, list);

  for (const [name, meta] of index) {
    const { bid, oid } = meta;
    const key = `${bid}/${oid}`;
    const proc = list.find((p) => p.name === name);
    const info = statusOf(proc);

    const path = `businesses/${bid}/outlets/${oid}/botStatus`;
    await admin.database().ref(path).update({
      status: info.status,
      uptime: info.uptime,
      memory: info.memory,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });

    const changed = lastKnownStatus.get(key) !== info.status;
    if (changed) {
      lastKnownStatus.set(key, info.status);
      await appendHistory(admin, bid, oid, info.status);
    }

    await handleAlerting(admin, { key, bid, oid, status: info.status });
  }
}

async function startStatusWatcher({ admin, processName, statusOf }) {
  await connectOnce();

  const runReconcile = () => reconcile({ admin, processName, statusOf }).catch((err) => {
    console.error('status-watcher: reconcile failed', err);
  });

  await runReconcile(); // initial pass so Firebase isn't stale from boot until the first event/interval

  pm2.launchBus((err, bus) => {
    if (err) {
      console.error('status-watcher: pm2 bus launch failed — falling back to interval-only reconciliation', err);
      return;
    }
    bus.on('process:event', debounce(runReconcile, EVENT_DEBOUNCE_MS));
  });

  setInterval(runReconcile, RECONCILE_INTERVAL_MS);

  console.log('status-watcher: started — writing live bot status to Firebase, alerting after', process.env.ALERT_OFFLINE_MINUTES || 5, 'min offline.');
}

module.exports = { startStatusWatcher, buildProcessNameIndex };
