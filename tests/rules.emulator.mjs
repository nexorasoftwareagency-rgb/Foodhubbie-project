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

const ADMIN = jwt('ADMIN1');
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

const cases = [
  ['rider acks own existing settlement', () => call('PUT', '/settlements/RIDER1/S1/riderAck', RIDER, ack), 200],
  ['rider acks with serverTimestamp', () => call('PUT', '/settlements/RIDER1/S1/riderAck', RIDER, { ...ack, acknowledgedAt: { '.sv': 'timestamp' } }), 200],
  ['rider edits own amountCollected', () => call('PATCH', '/settlements/RIDER1/S1', RIDER, { amountCollected: 999999 }), 'deny'],
  ['rider acks another rider settlement', () => call('PUT', '/settlements/RIDER2/S1/riderAck', RIDER, { ...ack, riderUid: 'RIDER2' }), 'deny'],
  ['rider acks non-existent settlement', () => call('PUT', '/settlements/RIDER1/NEW/riderAck', RIDER, { ...ack, settlementId: 'NEW' }), 'deny'],
  ['rider ack with extra child', () => call('PUT', '/settlements/RIDER1/S1/riderAck', RIDER, { ...ack, extra: 1 }), 'deny'],
  ['rider ack claiming another riderUid', () => call('PUT', '/settlements/RIDER2/S1/riderAck', OTHER, ack), 'deny'],
  ['admin writes settlement', () => call('PUT', '/settlements/RIDER1/S1', ADMIN, { riderId: 'RIDER1', amountCollected: 5000 }), 200],
  ['admin deletes settlement', () => call('DELETE', '/settlements/RIDER1/S1', ADMIN), 200],
  ['rider raises own SOS', () => call('PUT', '/sosAlerts/RIDER1/A2', RIDER, sos), 200],
  ['rider resolves own SOS', () => call('PATCH', '/sosAlerts/RIDER1/A1', RIDER, { status: 'resolved', resolvedAt: 5 }), 200],
  ['SOS riderId mismatch', () => call('PUT', '/sosAlerts/RIDER1/A3', RIDER, { ...sos, riderId: 'RIDER2' }), 'deny'],
  ['SOS non-numeric lat', () => call('PUT', '/sosAlerts/RIDER1/A4', RIDER, { ...sos, lat: 'x' }), 'deny'],
  ['SOS bad status value', () => call('PUT', '/sosAlerts/RIDER1/A5', RIDER, { ...sos, status: 'weird' }), 'deny'],
  ['non-admin writes rating', () => call('PUT', '/ratings/RIDER1/O1', OTHER, { riderId: 'RIDER1', rating: 5, createdAt: 1 }), 'deny'],
  ['admin writes rating', () => call('PUT', '/ratings/RIDER1/O2', ADMIN, { riderId: 'RIDER1', rating: 5, createdAt: 1 }), 200],
  ['unauthenticated write control', () => call('PUT', '/settlements/RIDER1/S1/x', null, 1), 'deny'],
  ['redeem request accepted from the public', () => call('PUT', `${OUT}/bot/redeemQueue/req-1`, null, { phone: '9876543210', rewardId: 'free_fries', requestedAt: 1, outlet: 'pizza' }), 200],
  ['redeem request with a bad phone', () => call('PUT', `${OUT}/bot/redeemQueue/req-2`, null, { phone: '123', rewardId: 'free_fries', requestedAt: 1, outlet: 'pizza' }), 'deny'],
  ['redeem request for another outlet', () => call('PUT', `${OUT}/bot/redeemQueue/req-3`, null, { phone: '9876543210', rewardId: 'free_fries', requestedAt: 1, outlet: 'cake' }), 'deny'],
  ['client deletes a redeem request', () => call('DELETE', `${OUT}/bot/redeemQueue/req-1`, null), 'deny'],
  ['client forges a redemption record', () => call('PUT', `${CUST}/rewards/forged`, null, { rewardId: 'free_fries', label: 'Free Fries', cost: 0, code: 'LOYAL0000', status: 'active', redeemedAt: 1, outlet: 'pizza' }), 'deny'],
  ['client reads its own redemptions', () => call('GET', `${CUST}/rewards`, null), 200]
];

await seed({
  admins: { ADMIN1: { email: 'a@b.c', outlet: 'pizza' } },
  settlements: { RIDER1: { S1: { riderId: 'RIDER1', amountCollected: 5000, createdAt: 1 } } },
  sosAlerts: { RIDER1: { A1: { riderId: 'RIDER1', riderName: 'R', lat: 1, lng: 2, ts: 3, status: 'active' } } },
  businesses: {
    b1: {
      outlets: {
        pizza: {
          loyalty: { config: { earnRatePaisePerPoint: 2000, tiers: { bronze: { min: 0 }, silver: { min: 500 }, gold: { min: 1000 } }, rewards: [{ id: 'free_fries', label: 'Free Fries', cost: 200 }] } },
          customers: { 9876543210: { loyalty: { phone: '9876543210', outlet: 'pizza', business: 'b1', lifetimePoints: 500, pointsSpent: 100, totalSpent: 1, orderCount: 1, tier: 'silver', updatedAt: 1 } } }
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
