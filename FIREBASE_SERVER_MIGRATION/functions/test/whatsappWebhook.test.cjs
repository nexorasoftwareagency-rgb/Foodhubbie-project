/**
 * Isolated verification of whatsappWebhook (faithful port of webhook-server).
 * Everything is mocked — no RTDB writes, no Redis, no live calls.
 * Run: node test/whatsappWebhook.test.cjs
 */
const crypto = require('crypto');
const assert = require('assert');

// ---- Env expected by the function ----
process.env.WA_VERIFY_TOKEN = 'test-verify-token';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.FIREBASE_DATABASE_URL = 'https://fake-rtdb.example.com/';

// ---- Mock firebase-admin BEFORE loading the function ----
const writes = [];
const mockSnap = (val) => ({ val: () => val, exists: () => val !== null && val !== undefined });
const mockRef = (path) => ({
  path,
  once: async () => {
    if (path === 'phoneNumberIndex/pid-pizza') return mockSnap({ businessId: 'roshani-pizza', outletId: 'pizza' });
    if (path === 'wabaIndex/waba-1') return mockSnap(null);
    return mockSnap(null);
  },
  set: async (value) => { writes.push({ op: 'set', path, value }); },
  update: async (value) => { writes.push({ op: 'update', path, value }); },
  push: async (value) => { writes.push({ op: 'push', path, value }); return { ref: { key: 'shadow1' } }; },
});

const mockDb = { ref: (path) => mockRef(path) };
const mockAdminApp = { database: () => mockDb, auth: () => ({}), messaging: () => ({}) };

const fakeAdmin = {
  apps: [{}],
  initializeApp: () => mockAdminApp,
  app: () => { const e = new Error('app does not exist'); e.code = 'app/no-app'; throw e; },
  credential: { applicationDefault: () => ({}), cert: () => ({}) },
  database: () => mockDb,
  auth: { getAuth: () => ({}) },
};
fakeAdmin.database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };

// ---- Module cache injection ----
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') return { default: fakeAdmin, ...fakeAdmin };
  if (request === '@google-cloud/secret-manager') {
    return {
      SecretManagerServiceClient: class {
        accessSecretVersion() {
          return Promise.resolve([{ payload: { data: Buffer.from('https://foodhubbie-10-default-rtdb.firebaseio.com') } }]);
        }
      },
    };
  }
  if (request === 'firebase-functions/v2/https') {
    return { onRequest: (opts, handler) => ({ __opts: opts, __handler: handler }) };
  }
  if (request === 'firebase-functions/v2') {
    return { logger: { info: (...a) => console.log('[info]', JSON.stringify(a)), warn: (...a) => console.log('[warn]', JSON.stringify(a)), error: (...a) => console.log('[error]', JSON.stringify(a)), log: (...a) => console.log('[log]', JSON.stringify(a)) } };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

const mod = require('../lib/api/whatsappWebhook.js');
const handler = (mod.whatsappWebhook || mod.default);
const fn = handler.__handler;
assert.ok(fn, 'handler exported');

// ---- Fake req/res helpers ----
const makeRes = () => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  send(body) { this.body = body; return this; },
  sendStatus(code) { this.statusCode = code; return this; },
  set(headers) { Object.assign(this.headers, headers); return this; },
});
const makeReq = ({ method = 'POST', body = {}, query = {}, headers = {} } = {}) => ({ method, body, query, headers });

const mkSig = (body) => 'sha256=' + crypto.createHmac('sha256', 'test-app-secret').update(JSON.stringify(body)).digest('hex');

(async () => {
  // Let module-level initializeAdmin() finish
  for (let i = 0; i < 50; i++) await Promise.resolve();

  // ---- Test 1: GET challenge success ----
  const res1 = makeRes();
  fn(makeReq({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'CHALLENGE_TOKEN_123' } }), res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body, 'CHALLENGE_TOKEN_123');
  console.log('[PASS] GET challenge accepted');

  // ---- Test 2: GET wrong token → 403 ----
  const resBad = makeRes();
  fn(makeReq({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'CHALLENGE_TOKEN_123' } }), resBad);
  assert.equal(resBad.statusCode, 403);
  console.log('[PASS] GET wrong token → 403');

  const validBody = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550000001', phone_number_id: 'pid-pizza' },
          messages: [{ from: '15559990000', id: 'wamid.test123', timestamp: '1731234567', type: 'text', text: { body: 'hello' } }],
        },
      }],
    }],
  };

  // ---- Test 3: POST valid signature → routed to shadow inbox ----
  writes.length = 0;
  const res3 = makeRes();
  await fn(makeReq({ method: 'POST', body: validBody, headers: { 'x-hub-signature-256': mkSig(validBody) } }), res3);
  assert.equal(res3.statusCode, 200, 'POST responds 200 first');
  const shadow = writes.find(w => w.op === 'push');
  assert.ok(shadow, 'message shadowed to RTDB webhookShadow (Redis unreachable in test)');
  assert.equal(shadow.path, 'webhookShadow/roshani-pizza/pizza');
  assert.equal(shadow.value.message.text.body, 'hello');
  console.log('[PASS] POST valid signature → routed to roshani-pizza/pizza (shadow)');

  // ---- Test 4: POST invalid signature → dropped, no writes ----
  writes.length = 0;
  const res4 = makeRes();
  await fn(makeReq({ method: 'POST', body: validBody, headers: { 'x-hub-signature-256': 'sha256=deadbeef' } }), res4);
  assert.equal(res4.statusCode, 200, 'handler still answers 200 (Meta requires it)');
  assert.equal(writes.length, 0, 'no writes on bad signature');
  console.log('[PASS] POST invalid signature → dropped, zero writes');

  // ---- Test 5: POST delivery status → logged, no writes ----
  writes.length = 0;
  const statusesBody = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ value: { statuses: [{ id: 'wamid.x', status: 'delivered' }], metadata: {} }, field: 'messages' }] }],
  };
  const res5 = makeRes();
  await fn(makeReq({ method: 'POST', body: statusesBody, headers: { 'x-hub-signature-256': mkSig(statusesBody) } }), res5);
  assert.equal(writes.length, 0, 'statuses produce no writes');
  console.log('[PASS] POST delivery status → no writes');

  console.log('\nALL WHATSAPP WEBHOOK PORT TESTS PASSED — port is behaviorally faithful (shadow-inbox fallback until Redis bridge)');
})().catch(e => { console.error('[FAIL]', e); process.exit(1); });
