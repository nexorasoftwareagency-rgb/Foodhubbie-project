/**
 * Phase 5 — Runtime integration test for restaurant-scoped rider notification
 * isolation (Pending-Work.md "MOST PRIORITY" block).
 *
 * What this does that Phases 1-4 could not: it RUNS the real modules
 * (bot/rider.js + bot/firebase.js) against the live Realtime Database with a
 * stubbed WhatsApp socket, so every recipient decision is real code operating
 * on real data. Nothing is sent to WhatsApp and no real rider is touched —
 * the script seeds its own `phase5test-*` riders and removes them in `finally`.
 *
 * Run: node tests/phase5-rider-isolation.check.cjs
 * Exit 0 = isolation holds. Exit 1 = a rider from another restaurant was
 * notified (or the scoped paths missed their target).
 */

const fs = require('fs');
const path = require('path');

// Everything (including bot module logs) is buffered and flushed at the end:
// firebase-admin keeps the event loop alive, so the process is ended with
// process.exit() and an unbuffered console.log can lose its tail.
const out = [];
const log = (...a) => out.push(a.map(String).join(' '));
console.log = log;
const finish = (code) => {
  fs.writeSync(1, out.join('\n') + '\n');
  process.exit(code);
};

process.env.OUTLET = 'pizza';
process.env.BUSINESS_ID = 'roshani-pizza';

const { db, getData } = require('../bot/firebase');
const { notifyRiderAssignment, notifyRiderPickup, broadcastPickupAvailable } = require('../bot/rider');

const PIZZA = { outlet: 'pizza', businessId: 'roshani-pizza' };
const CAKE = { outlet: 'cake', businessId: 'roshani-cake' };

const RIDERS = {
  'phase5test-pizza-online': { name: 'P5 Pizza Online', phone: '919000000001', email: 'p5-pizza@example.invalid', ...PIZZA, status: 'online' },
  'phase5test-pizza-offline': { name: 'P5 Pizza Offline', phone: '919000000002', email: 'p5-pizza-off@example.invalid', ...PIZZA, status: 'Offline' },
  'phase5test-cake-online': { name: 'P5 Cake Online', phone: '919000000003', email: 'p5-cake@example.invalid', ...CAKE, status: 'online' },
};

const PHONE = {
  '919000000001': 'pizza-online',
  '919000000002': 'pizza-offline',
  '919000000003': 'cake-online',
};

const sent = [];
const inApp = [];
const sock = {
  ws: { isClosed: false, isClosing: false },
  sendMessage: async (jid, payload) => {
    const digits = String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
    sent.push({ jid, digits, text: payload && payload.text });
  },
};
// Real app notification writes to riders/{uid}/notifications — stubbed so the
// test never leaves anything behind on a rider node.
const addInAppNotification = async (uid, title, body, type, icon, outlet) => {
  inApp.push({ uid, title, outlet });
};

const order = (scope, id) => ({
  ...scope,
  orderId: id,
  customerName: 'P5 Test Customer',
  phone: '919000000999',
  address: 'Phase 5 test address',
  items: [{ name: 'Test Item', quantity: 1, price: 1 }],
  subtotal: 1,
  total: 1,
  paymentMethod: 'COD',
});

let failures = 0;
function check(name, ok, detail) {
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures++;
}
const recipients = () => [...new Set(sent.map((s) => PHONE[s.digits] || s.digits))];
const reset = () => { sent.length = 0; inApp.length = 0; };

(async () => {
  // Guard: remove leftovers from an aborted earlier run before seeding.
  for (const uid of Object.keys(RIDERS)) await db.ref(`riders/${uid}`).remove();

  const seededAt = Date.now();
  for (const [uid, r] of Object.entries(RIDERS)) {
    await db.ref(`riders/${uid}`).set({ ...r, lastSeen: seededAt, createdAt: seededAt });
  }
  console.log(`seeded ${Object.keys(RIDERS).length} test riders (pizza online/offline + cake online)\n`);

  try {
    /* ---- A: pizza order broadcast must reach pizza riders only ---- */
    reset();
    await broadcastPickupAvailable(sock, 'P5TEST-P', order(PIZZA, 'P5TEST-P'), getData, addInAppNotification);
    let to = recipients();
    check('A1 pizza broadcast reaches its own online rider', to.includes('pizza-online'), 'to=' + JSON.stringify(to));
    check('A2 pizza broadcast SKIPS offline pizza rider', !to.includes('pizza-offline'), 'to=' + JSON.stringify(to));
    check('A3 pizza broadcast never reaches a CAKE rider', !to.includes('cake-online'), 'to=' + JSON.stringify(to));
    check('A4 pizza broadcast in-app notif only for pizza rider', inApp.length > 0 && inApp.every((n) => n.outlet === 'pizza'), 'uid/outlet=' + JSON.stringify(inApp.map((n) => n.uid + ':' + n.outlet)));

    /* ---- B: cake order broadcast must reach cake riders only ---- */
    reset();
    await broadcastPickupAvailable(sock, 'P5TEST-C', order(CAKE, 'P5TEST-C'), getData, addInAppNotification);
    to = recipients();
    check('B1 cake broadcast reaches its own online rider', to.includes('cake-online'), 'to=' + JSON.stringify(to));
    check('B2 cake broadcast never reaches a PIZZA rider', !to.includes('pizza-online'), 'to=' + JSON.stringify(to));

    /* ---- C: assignment targets exactly the assigned rider ---- */
    reset();
    await notifyRiderAssignment(sock, 'P5TEST-A', { ...order(PIZZA, 'P5TEST-A'), riderPhone: '919000000001', riderId: 'phase5test-pizza-online' }, addInAppNotification);
    check('C1 assignment sends exactly one message', sent.length === 1, 'sent=' + sent.length);
    check('C2 assignment goes to the assigned phone', recipients().join(',') === 'pizza-online', 'to=' + JSON.stringify(recipients()));
    check('C3 assignment in-app notif for the assigned rider', inApp.length === 1 && inApp[0].uid === 'phase5test-pizza-online', JSON.stringify(inApp.map((n) => n.uid)));

    /* ---- D: pickup targets exactly the assigned rider ---- */
    reset();
    await notifyRiderPickup(sock, { ...order(CAKE, 'P5TEST-B'), riderPhone: '919000000003', riderId: 'phase5test-cake-online', otp: '1234' }, addInAppNotification);
    check('D1 pickup sends exactly one message', sent.length === 1, 'sent=' + sent.length);
    check('D2 pickup goes to the assigned phone', recipients().join(',') === 'cake-online', 'to=' + JSON.stringify(recipients()));
  } finally {
    for (const uid of Object.keys(RIDERS)) await db.ref(`riders/${uid}`).remove();
    const left = (await db.ref('riders').once('value')).val() || {};
    const leftovers = Object.keys(left).filter((k) => k.startsWith('phase5test-'));
    log(`\ncleanup: ${leftovers.length === 0 ? 'no test riders left' : 'LEFTOVERS ' + leftovers.join(',')}`);
    if (leftovers.length) failures++;
    log(failures === 0 ? '\nRESULT: isolation holds' : `\nRESULT: ${failures} check(s) failed`);
    finish(failures === 0 ? 0 : 1);
  }
})().catch(async (e) => {
  log('ERR ' + (e && e.message));
  try { for (const uid of Object.keys(RIDERS)) await db.ref(`riders/${uid}`).remove(); } catch { /* ignore */ }
  finish(1);
});
