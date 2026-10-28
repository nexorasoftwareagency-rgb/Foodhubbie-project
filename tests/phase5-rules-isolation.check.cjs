/**
 * Phase 5 (data layer) — a rider's own token must not read another
 * restaurant's data.
 *
 * Phases 2/4 verified `database.rules.json` by reading it. This proves the
 * deployed rules at runtime: it mints a custom token for a temporary rider in
 * the pizza outlet, exchanges it for a real ID token, and hits the live RTDB
 * REST API (which enforces rules — the Admin SDK does not).
 *
 * Run: node tests/phase5-rules-isolation.check.cjs
 * Exit 0 = cross-restaurant reads are denied and the rider's own outlet works.
 */

const fs = require('fs');
const path = require('path');

const admin = require(path.join(__dirname, '..', 'bot', 'node_modules', 'firebase-admin'));
admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, '..', 'bot', 'service-account.json'))),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
});
const db = admin.database();

const DB = 'https://foodhubbie-10-default-rtdb.firebaseio.com';
const API_KEY = fs.readFileSync(path.join(__dirname, '..', 'Admin', 'firebase-config.js'), 'utf8')
  .match(/apiKey["':=\s]+["'](AIza[\w-]+)/)[1];

const UID = 'phase5rules-pizza';
const EMAIL = 'p5-rules@example.invalid';
const OTHER_UID = 'phase5rules-cake';

let failures = 0;
// Buffered output: firebase-admin keeps the event loop alive, so the process is
// ended with process.exit() — buffering guarantees no log line is lost.
const out = [];
const log = (s) => out.push(s);
const finish = (code) => {
  fs.writeSync(1, out.join('\n') + '\n');
  process.exit(code);
};
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures++;
};

async function getIdToken() {
  const customToken = await admin.auth().createCustomToken(UID);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error('token exchange failed: ' + JSON.stringify(json).slice(0, 200));
  return json.idToken;
}

(async () => {
  // Seed a pizza rider + a cake rider that must stay invisible to the pizza one.
  // Riders are outlet-scoped since 2026-10-28 (staff pattern); riderIndex is the
  // rider app's bootstrap pointer.
  await db.ref(`businesses/roshani-pizza/outlets/pizza/riders/${UID}`).set({ name: 'P5 Rules Pizza', email: EMAIL, phone: '919000000004', outlet: 'pizza', businessId: 'roshani-pizza', status: 'Offline' });
  await db.ref(`businesses/roshani-cake/outlets/cake/riders/${OTHER_UID}`).set({ name: 'P5 Rules Cake', email: 'p5-rules-cake@example.invalid', phone: '919000000005', outlet: 'cake', businessId: 'roshani-cake', status: 'Offline' });
  await db.ref(`riderIndex/${UID}`).set({ bid: 'roshani-pizza', outlet: 'pizza' });
  await db.ref(`riderIndex/${OTHER_UID}`).set({ bid: 'roshani-cake', outlet: 'cake' });

  const cakeOrderIds = Object.keys((await db.ref('businesses/roshani-cake/outlets/cake/orders').once('value')).val() || {});
  const cakeOrderId = cakeOrderIds[0] || '-Phase5NoSuchOrder';
  const token = await getIdToken();
  log(`token minted for rider uid ${UID} (pizza outlet)\n`);

  const get = async (p) => {
    const res = await fetch(`${DB}/${p}.json?auth=${token}`);
    return { status: res.status, body: await res.text() };
  };
  const query = (outlet, businessId) =>
    `${DB}/businesses/${businessId}/outlets/${outlet}/orders.json?auth=${token}&orderBy=${encodeURIComponent('"assignedRider"')}&equalTo=${encodeURIComponent('"' + EMAIL + '"')}`;

  try {
    /* ---- collection-level order queries ---- */
    const own = await fetch(query('pizza', 'roshani-pizza')).then((r) => r.status);
    check('A1 rider can query orders in their OWN outlet', own === 200, 'status=' + own);

    const crossOutlet = await fetch(query('cake', 'roshani-cake')).then((r) => r.status);
    check('A2 rider CANNOT query another outlet of the platform', crossOutlet === 401, 'status=' + crossOutlet);

    /* ---- individual order reads ---- */
    // Rules are evaluated before data existence, so a non-existent id still
    // proves the read is denied (and B2 is the control that proves the same
    // URL shape is allowed inside the rider's own outlet).
    const one = await get(`businesses/roshani-cake/outlets/cake/orders/${cakeOrderId}`);
    check('B1 rider CANNOT read a cake order by id', one.status === 401, 'status=' + one.status + ' ' + one.body.replace(/\s+/g, ' ').slice(0, 48));

    const ownOne = await get('businesses/roshani-pizza/outlets/pizza/orders/-Phase5NoSuchOrder');
    check('B2 same read in the rider OWN outlet is allowed (control)', ownOne.status === 200, 'status=' + ownOne.status);

    /* ---- rider node isolation (outlet-scoped like staff) ---- */
    const ownNode = await get(`businesses/roshani-pizza/outlets/pizza/riders/${UID}`);
    check('C1 rider can read their own rider node', ownNode.status === 200, 'status=' + ownNode.status);

    const otherNode = await get(`businesses/roshani-cake/outlets/cake/riders/${OTHER_UID}`);
    check('C2 rider CANNOT read another outlet rider node', otherNode.status === 401, 'status=' + otherNode.status);

    const sameTreeOther = await get(`businesses/roshani-pizza/outlets/pizza/riders/phase5rules-someone-else`);
    check('C3 rider CANNOT read another rider node in the same outlet', sameTreeOther.status === 401, 'status=' + sameTreeOther.status);

    const rootRiders = await get('riders');
    check('C4 global root riders node is gone (denied)', rootRiders.status === 401, 'status=' + rootRiders.status);

    const ownIndex = await get(`riderIndex/${UID}`);
    check('C5 rider can read their own riderIndex pointer', ownIndex.status === 200, 'status=' + ownIndex.status);

    const otherIndex = await get(`riderIndex/${OTHER_UID}`);
    check('C6 rider CANNOT read another riderIndex pointer', otherIndex.status === 401, 'status=' + otherIndex.status);

    /* ---- unauthenticated sanity ---- */
    const anon = await fetch(`${DB}/businesses/roshani-cake/outlets/cake/orders.json`).then((r) => r.status);
    check('D1 anonymous read of cake orders denied', anon === 401, 'status=' + anon);
  } catch (e) {
    log('ERR during checks: ' + ((e && (e.stack || e.message)) || e));
    failures++;
  } finally {
    await db.ref(`businesses/roshani-pizza/outlets/pizza/riders/${UID}`).remove();
    await db.ref(`businesses/roshani-cake/outlets/cake/riders/${OTHER_UID}`).remove();
    await db.ref(`riderIndex/${UID}`).remove();
    await db.ref(`riderIndex/${OTHER_UID}`).remove();
    try { await admin.auth().deleteUser(UID); } catch { /* never created */ }
    const leftPizza = (await db.ref('businesses/roshani-pizza/outlets/pizza/riders').once('value')).val() || {};
    const leftCake = (await db.ref('businesses/roshani-cake/outlets/cake/riders').once('value')).val() || {};
    const leftovers = [...Object.keys(leftPizza), ...Object.keys(leftCake)].filter((k) => k.startsWith('phase5rules-'));
    log(`\ncleanup: ${leftovers.length === 0 ? 'no test riders left' : 'LEFTOVERS ' + leftovers.join(',')}`);
    if (leftovers.length) failures++;
    log(failures === 0 ? '\nRESULT: rules enforce restaurant isolation' : `\nRESULT: ${failures} check(s) failed`);
    finish(failures === 0 ? 0 : 1);
  }
})().catch(async (e) => {
  log('ERR ' + (e && e.message));
  try {
    await db.ref(`businesses/roshani-pizza/outlets/pizza/riders/${UID}`).remove();
    await db.ref(`businesses/roshani-cake/outlets/cake/riders/${OTHER_UID}`).remove();
    await db.ref(`riderIndex/${UID}`).remove();
    await db.ref(`riderIndex/${OTHER_UID}`).remove();
  } catch { /* ignore */ }
  finish(1);
});
