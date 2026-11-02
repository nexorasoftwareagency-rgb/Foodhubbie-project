// Realtime Database rules tests against the local emulator.
//
//   npx -y firebase-tools emulators:exec --only database --project demo-foodhubbie \
//     "node tests/rules.emulator.mjs"
//
// Needs Java 21+ (firebase-tools requirement). Seeds past the rules with the
// emulator's admin bypass (Authorization: Bearer owner) and authenticates test
// requests with unsigned JWTs - the emulator does not verify signatures, but it
// does require standard claims and a non-empty signature segment.
const HOST = process.env.RTDB_EMULATOR_HOST || '127.0.0.1:9000';
const NS = process.env.RTDB_NS || 'demo-foodhubbie-default-rtdb';
const DB = `http://${HOST}`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = Math.floor(Date.now() / 1000);
const jwt = (uid) => [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({
    sub: uid, user_id: uid, uid,
    aud: 'demo-foodhubbie', iss: 'https://securetoken.google.com/demo-foodhubbie',
    iat: NOW, exp: NOW + 3600, auth_time: NOW
  }),
  'ZmFrZQ'
].join('.');

// Firebase anonymous-auth token (the restaurant app signs in this way to place orders).
const anonJwt = (uid) => [
  b64({ alg: 'HS256', typ: 'JWT' }),
  b64({
    sub: uid, user_id: uid, uid,
    aud: 'demo-foodhubbie', iss: 'https://securetoken.google.com/demo-foodhubbie',
    iat: NOW, exp: NOW + 3600, auth_time: NOW,
    firebase: { sign_in_provider: 'anonymous', identities: {} }
  }),
  'ZmFrZQ'
].join('.');
const ADMIN = jwt('ADMIN1');
const ANON1 = anonJwt('ANON1');
const ANON2 = anonJwt('ANON2');
const RIDER = jwt('RIDER1');
const OTHER = jwt('RIDER2');

async function call(method, path, token, body) {
  const qs = `ns=${encodeURIComponent(NS)}${token ? `&auth=${encodeURIComponent(token)}` : ''}`;
  const r = await fetch(`${DB}${path}.json?${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return r.status;
}

async function seed(data) {
  const r = await fetch(`${DB}/.json?ns=${encodeURIComponent(NS)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify(data)
  });
  if (r.status !== 200) throw new Error(`seed failed ${r.status}`);
}

const ack = { settlementId: 'S1', acknowledged: true, acknowledgedAt: 123, riderUid: 'RIDER1' };
const sos = { riderId: 'RIDER1', riderName: 'R', riderPhone: '9999999999', lat: 1, lng: 2, ts: 3, status: 'active' };
const OUT = '/businesses/b1/outlets/pizza';
const CUST = `${OUT}/customers/9876543210`;
const appOrder = (over = {}) => ({
  orderId: 'APP-1', outlet: 'pizza', type: 'Online', orderMode: 'delivery', source: 'APP', channel: 'app', appUid: 'ANON1',
  customerName: 'Rahul', phone: '9876543210', total: 208.95, status: 'Placed', paymentStatus: 'Pending',
  paymentMethod: 'COD', createdAt: new Date().toISOString(), stockDeducted: false,
  items: [{ name: 'Margherita', quantity: 1, unitPrice: 199, total: 199 }], ...over
});

const cases = [
  // ── restaurant app orders (source APP) ──
  ['app: anon user places a delivery order', () => call('PUT', `${OUT}/orders/APP-1`, ANON1, appOrder()), 200],
  ['app: anon user places a pickup order', () => call('PUT', `${OUT}/orders/APP-P1`, ANON1, appOrder({ orderId: 'APP-P1', type: 'Pickup', orderMode: 'pickup', paymentMethod: null })), 200],
  ['app: unauthenticated order is refused', () => call('PUT', `${OUT}/orders/APP-2`, null, appOrder({ orderId: 'APP-2' })), 'deny'],
  ['app: non-anonymous login is refused', () => call('PUT', `${OUT}/orders/APP-3`, RIDER, appOrder({ orderId: 'APP-3', appUid: 'RIDER1' })), 'deny'],
  ['app: appUid must match the signer', () => call('PUT', `${OUT}/orders/APP-4`, ANON1, appOrder({ orderId: 'APP-4', appUid: 'ANON2' })), 'deny'],
  ['app: order cannot be created Paid', () => call('PUT', `${OUT}/orders/APP-5`, ANON1, appOrder({ orderId: 'APP-5', paymentStatus: 'Paid' })), 'deny'],
  ['app: order cannot start Delivered', () => call('PUT', `${OUT}/orders/APP-6`, ANON1, appOrder({ orderId: 'APP-6', status: 'Delivered' })), 'deny'],
  ['app: order cannot pre-assign a rider', () => call('PUT', `${OUT}/orders/APP-7`, ANON1, appOrder({ orderId: 'APP-7', riderId: 'RIDER1' })), 'deny'],
  ['app: bad phone number refused', () => call('PUT', `${OUT}/orders/APP-8`, ANON1, appOrder({ orderId: 'APP-8', phone: '12345' })), 'deny'],
  ['app: unknown type refused', () => call('PUT', `${OUT}/orders/APP-9`, ANON1, appOrder({ orderId: 'APP-9', type: 'Dine-in' })), 'deny'],
  ['app: stock already deducted refused', () => call('PUT', `${OUT}/orders/APP-10`, ANON1, appOrder({ orderId: 'APP-10', stockDeducted: true })), 'deny'],
  ['app: owner cancels own Placed order', () => call('PUT', `${OUT}/orders/SEED-APP-PLACED/status`, ANON1, 'Cancelled'), 200],
  ['app: another device cannot cancel it', () => call('PUT', `${OUT}/orders/SEED-APP-PLACED2/status`, ANON2, 'Cancelled'), 'deny'],
  ['app: no cancel once Confirmed', () => call('PUT', `${OUT}/orders/SEED-APP-CONFIRMED/status`, ANON1, 'Cancelled'), 'deny'],
  ['app: customer cannot mark own order Delivered', () => call('PUT', `${OUT}/orders/SEED-APP-PLACED3/status`, ANON1, 'Delivered'), 'deny'],
  ['app: public cannot read an app order', () => call('GET', `${OUT}/orders/SEED-APP-CONFIRMED`, null), 'deny'],
  ['app: admin updates status', () => call('PUT', `${OUT}/orders/SEED-APP-CONFIRMED/status`, ADMIN, 'Ready'), 200],
  ['rider acks own existing settlement', () => call('PUT', `${OUT}/settlements/RIDER1/S1/riderAck`, RIDER, ack), 200],
  ['rider acks with serverTimestamp', () => call('PUT', `${OUT}/settlements/RIDER1/S1/riderAck`, RIDER, { ...ack, acknowledgedAt: { '.sv': 'timestamp' } }), 200],
  ['rider edits own amountCollected', () => call('PATCH', `${OUT}/settlements/RIDER1/S1`, RIDER, { amountCollected: 999999 }), 'deny'],
  ['rider acks another rider settlement', () => call('PUT', `${OUT}/settlements/RIDER2/S1/riderAck`, RIDER, { ...ack, riderUid: 'RIDER2' }), 'deny'],
  ['rider acks non-existent settlement', () => call('PUT', `${OUT}/settlements/RIDER1/NEW/riderAck`, RIDER, { ...ack, settlementId: 'NEW' }), 'deny'],
  ['rider ack with extra child', () => call('PUT', `${OUT}/settlements/RIDER1/S1/riderAck`, RIDER, { ...ack, extra: 1 }), 'deny'],
  ['rider ack claiming another riderUid', () => call('PUT', `${OUT}/settlements/RIDER2/S1/riderAck`, OTHER, ack), 'deny'],
  ['admin writes settlement', () => call('PUT', `${OUT}/settlements/RIDER1/S1`, ADMIN, { riderId: 'RIDER1', amountCollected: 5000 }), 200],
  ['admin deletes settlement', () => call('DELETE', `${OUT}/settlements/RIDER1/S1`, ADMIN), 200],
  ['rider raises own SOS', () => call('PUT', '/sosAlerts/RIDER1/A2', RIDER, sos), 200],
  ['rider resolves own SOS', () => call('PATCH', '/sosAlerts/RIDER1/A1', RIDER, { status: 'resolved', resolvedAt: 5 }), 200],
  ['SOS riderId mismatch', () => call('PUT', '/sosAlerts/RIDER1/A3', RIDER, { ...sos, riderId: 'RIDER2' }), 'deny'],
  ['SOS non-numeric lat', () => call('PUT', '/sosAlerts/RIDER1/A4', RIDER, { ...sos, lat: 'x' }), 'deny'],
  ['SOS bad status value', () => call('PUT', '/sosAlerts/RIDER1/A5', RIDER, { ...sos, status: 'weird' }), 'deny'],
  ['non-admin writes rating', () => call('PUT', '/ratings/RIDER1/O1', OTHER, { riderId: 'RIDER1', rating: 5, createdAt: 1 }), 'deny'],
  ['admin writes rating', () => call('PUT', '/ratings/RIDER1/O2', ADMIN, { riderId: 'RIDER1', rating: 5, createdAt: 1 }), 200],
  ['unauthenticated write control', () => call('PUT', `${OUT}/settlements/RIDER1/S1/x`, null, 1), 'deny'],
  ['redeem request accepted from the public', () => call('PUT', `${OUT}/bot/redeemQueue/req-1`, null, { phone: '9876543210', rewardId: 'free_fries', requestedAt: 1, outlet: 'pizza' }), 200],
  ['redeem request with a bad phone', () => call('PUT', `${OUT}/bot/redeemQueue/req-2`, null, { phone: '123', rewardId: 'free_fries', requestedAt: 1, outlet: 'pizza' }), 'deny'],
  ['redeem request for another outlet', () => call('PUT', `${OUT}/bot/redeemQueue/req-3`, null, { phone: '9876543210', rewardId: 'free_fries', requestedAt: 1, outlet: 'cake' }), 'deny'],
  ['client deletes a redeem request', () => call('DELETE', `${OUT}/bot/redeemQueue/req-1`, null), 'deny'],
  ['client forges a redemption record', () => call('PUT', `${CUST}/rewards/forged`, null, { rewardId: 'free_fries', label: 'Free Fries', cost: 0, code: 'LOYAL0000', status: 'active', redeemedAt: 1, outlet: 'pizza' }), 'deny'],
  ['client reads its own redemptions', () => call('GET', `${CUST}/rewards`, ANON1), 200],
  // ── phone privacy: customer data is readable only by registered devices ──
  ['privacy: owner device reads own loyalty', () => call('GET', `${CUST}/loyalty`, ANON1), 200],
  ['privacy: stranger device cannot read loyalty', () => call('GET', `${CUST}/loyalty`, ANON2), 'deny'],
  ['privacy: signed-out cannot read loyalty', () => call('GET', `${CUST}/loyalty`, null), 'deny'],
  ['privacy: stranger cannot read profile', () => call('GET', `${CUST}/app`, ANON2), 'deny'],
  ['privacy: stranger cannot read orders (delivery code)', () => call('GET', `${CUST}/orders`, ANON2), 'deny'],
  ['privacy: stranger cannot read rewards', () => call('GET', `${CUST}/rewards`, ANON2), 'deny'],
  ['privacy: stranger cannot list devices', () => call('GET', `${CUST}/devices`, ANON2), 'deny'],
  ['privacy: stranger cannot read link code', () => call('GET', `${CUST}/link`, ANON2), 'deny'],
  ['privacy: stranger cannot write profile', () => call('PUT', `${CUST}/app`, ANON2, { name: 'Evil', phone: '9876543210', consent: { offers: true, orderUpdates: true }, updatedAt: 2 }), 'deny'],
  ['privacy: owner writes own profile', () => call('PUT', `${CUST}/app`, ANON1, { name: 'Rahul', phone: '9876543210', consent: { offers: true, orderUpdates: true }, updatedAt: 3 }), 200],
  ['privacy: stranger cannot claim an owned number', () => call('PUT', `${CUST}/devices/ANON2`, ANON2, { at: Date.now() }), 'deny'],
  ['privacy: stranger cannot add device with wrong code', () => call('PUT', `${OUT}/customers/9000000001/devices/ANON1`, ANON1, { at: Date.now(), code: '00000000' }), 'deny'],
  ['privacy: device joins with the right code', () => call('PUT', `${OUT}/customers/9000000001/devices/ANON1`, ANON1, { at: Date.now(), code: '12345678' }), 200],
  ['privacy: first device claims a fresh number', () => call('PUT', `${OUT}/customers/9123456780/devices/ANON1`, ANON1, { at: Date.now() }), 200],
  ['privacy: cannot register someone else\'s uid', () => call('PUT', `${OUT}/customers/9111111111/devices/ANON2`, ANON1, { at: Date.now() }), 'deny'],
  ['privacy: signed-out cannot claim', () => call('PUT', `${OUT}/customers/9222222222/devices/X`, null, { at: Date.now() }), 'deny'],
  ['privacy: restaurant admin reads customer', () => call('GET', `${CUST}/orders`, ADMIN), 200],
  ['privacy: restaurant admin resets the lock', () => call('DELETE', `${OUT}/customers/9000000001/devices`, ADMIN), 200],
  ['privacy: owner makes a link code', () => call('PUT', `${CUST}/link`, ANON1, { code: '87654321', exp: Date.now() + 600000 }), 200],
  ['privacy: stranger cannot make a link code', () => call('PUT', `${CUST}/link`, ANON2, { code: '87654321', exp: Date.now() + 600000 }), 'deny'],
];

await seed({
  admins: { ADMIN1: { email: 'a@b.c', outlet: 'pizza' } },
  riderIndex: { RIDER1: { bid: 'b1', outlet: 'pizza' } },
  sosAlerts: { RIDER1: { A1: { riderId: 'RIDER1', riderName: 'R', lat: 1, lng: 2, ts: 3, status: 'active' } } },
  businesses: {
    b1: {
      outlets: {
        pizza: {
          orders: {
            'SEED-APP-PLACED': appOrder({ orderId: 'SEED-APP-PLACED' }),
            'SEED-APP-PLACED2': appOrder({ orderId: 'SEED-APP-PLACED2' }),
            'SEED-APP-PLACED3': appOrder({ orderId: 'SEED-APP-PLACED3' }),
            'SEED-APP-CONFIRMED': appOrder({ orderId: 'SEED-APP-CONFIRMED', status: 'Confirmed' })
          },
          settlements: { RIDER1: { S1: { riderId: 'RIDER1', amountCollected: 5000, createdAt: 1 } } },
          loyalty: { config: { earnRatePaisePerPoint: 2000, tiers: { bronze: { min: 0 }, silver: { min: 500 }, gold: { min: 1000 } }, rewards: [{ id: 'free_fries', label: 'Free Fries', cost: 200 }] } },
          customers: { 9000000001: { devices: { ANON2: { at: 1 } }, link: { code: '12345678', exp: 4102444800000 } }, 9876543210: { devices: { ANON1: { at: 1 } }, app: { name: 'Rahul', phone: '9876543210', consent: { offers: true, orderUpdates: true }, updatedAt: 1 }, loyalty: { phone: '9876543210', outlet: 'pizza', business: 'b1', lifetimePoints: 500, pointsSpent: 100, totalSpent: 1, orderCount: 1, tier: 'silver', updatedAt: 1 } } }
        }
      }
    }
  }
});

let failed = 0;
for (const [name, run, want] of cases) {
  let got;
  try {
    got = await run();
  } catch (e) {
    console.log(`FAIL ${name.padEnd(38)} request error: ${e.message}`);
    failed++;
    continue;
  }
  const ok = want === 'deny' ? got === 401 || got === 403 : got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(38)} got ${got} want ${want}`);
}

console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nall ${cases.length} cases passed`);
process.exit(failed ? 1 : 0);
