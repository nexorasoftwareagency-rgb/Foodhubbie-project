// Runs the REAL onboarding functions from bot-control-api/server.js against an in-memory fake
// Firebase Admin SDK. No network, no Firebase. Run: node tests/auto-onboarding.check.cjs
const fs = require('fs'), assert = require('assert'), vm = require('vm');
const src = fs.readFileSync('bot-control-api/server.js', 'utf8');
const a = src.indexOf('class HttpError'), b = src.indexOf("app.post('/api/bot/stop/:bid/:oid'");
let code = src.slice(a, b)
  .replace(/app\.post\([\s\S]*?\n\}\);\n/, '')                  // drop the express route
  .replace('const SECRET_RETRY_MS = [3000, 10000, 30000, 90000]', 'const SECRET_RETRY_MS = [5, 5]')
  .replace(/^function startAutoApproval[\s\S]*$/m, '');          // watcher wiring is exercised separately

function makeFake(db0, users0) {
  const db = JSON.parse(JSON.stringify(db0)), users = { ...users0 };
  const get = (path) => path.split('/').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), db);
  const set = (path, v) => { const ks = path.split('/').filter(Boolean), last = ks.pop(); let o = db; for (const k of ks) o = o[k] = o[k] || {}; if (v === null) delete o[last]; else o[last] = v; };
  let pk = 0;
  const ref = (path = '') => ({
    get: async () => ({ val: () => { const v = get(path); return v === undefined ? null : JSON.parse(JSON.stringify(v)); } }),
    set: async (v) => set(path, v),
    update: async (u) => { for (const [k, v] of Object.entries(u)) set(path ? path + '/' + k : k, v); },
    push: (v) => { const key = 'k' + (++pk); const r = ref(path + '/' + key); r.key = key; if (v !== undefined) { set(path + '/' + key, v); return Object.assign(Promise.resolve(r), { key }); } return r; },
    runTransaction: async (fn) => { const n = fn(get(path)); set(path, n); return { snapshot: { val: () => n } }; },
    key: path.split('/').pop(),
  });
  const database = () => ({ ref });
  database.ServerValue = { TIMESTAMP: 'TS' };
  const auth = () => ({
    getUserByEmail: async (e) => { if (users[e]) return { uid: users[e] }; const er = new Error('nf'); er.code = 'auth/user-not-found'; throw er; },
    createUser: async ({ email }) => { users[email] = 'uid_' + email; return { uid: users[email] }; },
    updateUser: async () => {},
  });
  return { admin: { database, auth }, db, users };
}
const mk = (fake) => {
  const ctx = { admin: fake.admin, console: { log() {}, warn() {}, error() {} }, process: { env: {} }, setTimeout, getBillingDefaults: () => ({ mode: 'per_order' }), Promise, Date, Error, Set, Number, String, Object, Math, RegExp };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.autoApproveOne = autoApproveOne; this._autoRecent = _autoRecent; this.HttpError = HttpError; this.approveOnboardingRequest = approveOnboardingRequest;', ctx);
  return ctx;
};
const req = (o = {}) => ({ businessName: 'Spice', outletName: 'Spice A', adminEmail: 'a@x.com', contactPhone: '9999999999', plan: 'starter', source: 'website', status: 'pending', createdAt: Date.now(), ...o });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  let f = makeFake({ onboardingRequests: { r1: req() }, onboardingSecrets: { r1: { password: 'secret123' } } }, {});
  let c = mk(f); await c.autoApproveOne('r1');
  const r = f.db.onboardingRequests.r1, o = Object.values(Object.values(f.db.businesses)[0].outlets)[0];
  assert.equal(r.status, 'approved'); assert.equal(r.autoApproved, true); assert.equal(r.adminPassword, null);
  assert.equal(o.locked, true, 'new outlet must be locked'); assert.ok(!(f.db.onboardingSecrets && f.db.onboardingSecrets.r1), 'secret burned');
  assert.ok(f.users['a@x.com'], 'auth user created');
  const n = Object.values(f.db.inquiries)[0]; assert.equal(n.type, 'New restaurant signup'); assert.equal(n.status, 'new');
  assert.ok(!JSON.stringify(f.db.inquiries).includes('secret123'), 'password never in notification');
  console.log('PASS happy path: created, locked, secret burned, Supreme notified');

  f = makeFake({ onboardingRequests: { r1: req() } }, {}); c = mk(f); await c.autoApproveOne('r1'); await sleep(60);
  assert.equal(f.db.onboardingRequests.r1.status, 'pending'); assert.ok(!f.db.businesses);
  assert.ok(Object.values(f.db.inquiries)[0].message.includes('could not be auto-approved'));
  console.log('PASS missing password: retried, left pending, Supreme told');

  f = makeFake({ onboardingRequests: { r1: req() }, onboardingSecrets: { r1: { password: 'secret123' } } }, { 'a@x.com': 'u1' });
  c = mk(f); await c.autoApproveOne('r1');
  assert.equal(f.db.onboardingRequests.r1.status, 'rejected'); assert.ok(!f.db.businesses);
  console.log('PASS duplicate email: rejected, nothing created');

  f = makeFake({ onboardingRequests: { r1: req() }, onboardingSecrets: { r1: { password: 'secret123' } } }, {});
  c = mk(f); for (let i = 0; i < 20; i++) c._autoRecent.push(Date.now());
  await c.autoApproveOne('r1');
  assert.equal(f.db.onboardingRequests.r1.status, 'pending'); assert.ok(!f.db.businesses);
  console.log('PASS hourly cap: request left pending for manual review');

  f = makeFake({ onboardingRequests: { r1: req({ status: 'approved' }), r2: req({ source: 'other' }) } }, {});
  c = mk(f); await c.autoApproveOne('r1'); await c.autoApproveOne('r2');
  assert.ok(!f.db.businesses && !f.db.inquiries); console.log('PASS already-approved / non-website requests ignored');

  f = makeFake({ onboardingRequests: { r1: req() }, onboardingSecrets: { r1: { password: 'abc' } } }, {}); c = mk(f);
  await c.autoApproveOne('r1'); await sleep(40); assert.equal(f.db.onboardingRequests.r1.status, 'pending');
  console.log('PASS short password never creates an account');
  f = makeFake({ onboardingRequests: { old: req({ createdAt: Date.now() - 3600000 }), legacy: req({ createdAt: Date.now() - 86400000 * 30, adminPassword: 'plaintext1' }) } }, {});
  c = mk(f); await c.autoApproveOne('old'); await c.autoApproveOne('legacy');
  assert.ok(!f.db.businesses && !f.users['a@x.com']); assert.equal(f.db.onboardingRequests.old.status, 'pending'); assert.equal(f.db.onboardingRequests.legacy.status, 'pending');
  console.log('PASS requests already pending before the API started (old / legacy) are NOT auto-approved');
  console.log('ALL PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
