// Runs the REAL onboarding functions from bot-control-api/server.js against an in-memory fake
// Firebase Admin SDK. No network, no Firebase. Run: node tests/auto-onboarding.check.cjs
const fs = require('fs'), assert = require('assert'), vm = require('vm');
const src = fs.readFileSync('bot-control-api/server.js', 'utf8');
const a = src.indexOf('class HttpError'), b = src.indexOf("app.post('/api/bot/stop/:bid/:oid'");
let code = src.slice(a, b)
  .replace(/app\.(get|post|put|delete)\([\s\S]*?\r?\n\}\);\r?\n/g, '')   // drop express routes (CRLF-tolerant: Windows checkouts)
  .replace('const SECRET_RETRY_MS = [3000, 10000, 30000, 90000]', 'const SECRET_RETRY_MS = [5, 5]')
  .replace(/^function startAutoApproval[\s\S]*?\r?\n\}\r?\n/m, '');      // watcher wiring is exercised separately

function makeFake(db0, users0, verified0 = []) {
  const db = JSON.parse(JSON.stringify(db0)), users = { ...users0 }, verified = new Set(verified0), deleted = [];
  const get = (path) => path.split('/').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), db);
  const set = (path, v) => { const ks = path.split('/').filter(Boolean), last = ks.pop(); let o = db; for (const k of ks) o = o[k] = o[k] || {}; if (v === null) delete o[last]; else o[last] = v; };
  let pk = 0;
  const ref = (path = '') => ({
    get: async () => {
      const v = get(path);
      return { val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))), exists: () => v !== undefined && v !== null };
    },
    set: async (v) => set(path, v),
    update: async (u) => { for (const [k, v] of Object.entries(u)) set(path ? path + '/' + k : k, v); },
    remove: async () => set(path, null),
    orderByChild: () => ({ equalTo: () => ref(path) }),
    limitToFirst: () => ref(path),
    push: (v) => { const key = 'k' + (++pk); const r = ref(path + '/' + key); r.key = key; if (v !== undefined) { set(path + '/' + key, v); return Object.assign(Promise.resolve(r), { key }); } return r; },
    runTransaction: async (fn) => { const n = fn(get(path)); set(path, n); return { snapshot: { val: () => n } }; },
    key: path.split('/').pop(),
  });
  const database = () => ({ ref });
  database.ServerValue = { TIMESTAMP: 'TS' };
  const auth = () => ({
    getUserByEmail: async (e) => { if (users[e]) return { uid: users[e], emailVerified: verified.has(e) }; const er = new Error('nf'); er.code = 'auth/user-not-found'; throw er; },
    createUser: async ({ email }) => { users[email] = 'uid_' + email; return { uid: users[email] }; },
    updateUser: async () => {},
    deleteUser: async (uid) => { deleted.push(uid); for (const [e, u] of Object.entries(users)) if (u === uid) delete users[e]; },
  });
  return { admin: { database, auth }, db, users, verified, deleted };
}
const mk = (fake, env = {}) => {
  const ctx = { admin: fake.admin, console: { log() {}, warn() {}, error() {} }, process: { env }, setTimeout, getBillingDefaults: () => ({ mode: 'per_order' }), Promise, Date, Error, Set, Number, String, Object, Math, RegExp, JSON };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.autoApproveOne = autoApproveOne; this._autoRecent = _autoRecent; this.HttpError = HttpError; this.approveOnboardingRequest = approveOnboardingRequest; this.runUnverifiedCleanup = runUnverifiedCleanup; this.outletAdminStatus = outletAdminStatus; this.CLEANUP_ENFORCE = CLEANUP_ENFORCE;', ctx);
  return ctx;
};
const req = (o = {}) => ({ businessName: 'Spice', outletName: 'Spice A', adminEmail: 'a@x.com', adminName: 'Asha', contactPhone: '9999999999', plan: 'starter', source: 'website', status: 'pending', createdAt: Date.now(), ...o });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  let f = makeFake({ onboardingRequests: { r1: req() }, onboardingSecrets: { r1: { password: 'secret123' } } }, {});
  let c = mk(f); await c.autoApproveOne('r1');
  const r = f.db.onboardingRequests.r1, o = Object.values(Object.values(f.db.businesses)[0].outlets)[0];
  assert.equal(r.status, 'approved'); assert.equal(r.reviewedBy, 'auto-onboarding'); assert.equal(r.adminPassword, null);
  assert.equal(o.locked, true, 'new outlet must be locked'); assert.ok(!(f.db.onboardingSecrets && f.db.onboardingSecrets.r1), 'secret burned');
  assert.ok(f.users['a@x.com'], 'auth user created');
  assert.equal(f.db.admins['uid_a@x.com'].name, 'Asha', 'admins.name is the person, not the outlet');
  // Tenant parity with the Supreme wizard: outletIndex is required by the admins create rule and the riderIndex validate
  const oid = Object.keys(f.db.outletIndex || {})[0];
  assert.ok(oid, 'outletIndex written — staff and rider creation depend on it');
  assert.equal(f.db.outletIndex[oid].bid, r.bid, 'outletIndex points at the business');
  assert.equal(f.db.outletIndex[oid].name, 'Spice A');
  assert.ok(f.db.businesses[r.bid].outlets[oid], 'outletIndex oid matches the real outlet');
  assert.equal(o.adminLogin.email, 'a@x.com', 'admin email recorded');
  assert.ok(!('password' in o.adminLogin), 'plaintext password never stored on the tenant');
  const n = Object.values(f.db.inquiries)[0];
  assert.equal(n.type, 'New restaurant signup');
  assert.equal(n.source, 'website', 'inquiries rule only accepts source=website');
  assert.equal(n.status, undefined, 'absent status = new; the rule only allows "read"');
  assert.ok(n.phone.length >= 5 && n.phone.length <= 15, 'phone must satisfy the inquiries rule');
  assert.ok(!JSON.stringify(f.db.inquiries).includes('secret123'), 'password never in notification');
  console.log('PASS happy path: created, locked, outletIndex + adminLogin, secret burned, Supreme notified');

  // A template is operator-authored data. A stray key in it must never unlock the outlet or
  // rewrite the login it was created with.
  f = makeFake({
    onboardingRequests: { r1: req({ template: 't1' }) },
    onboardingSecrets: { r1: { password: 'secret123' } },
    appTemplates: { t1: { defaults: { locked: false, adminLogin: { email: 'evil@x.com' }, whatsapp: { status: 'active' }, categories: { c1: { name: 'Pizza' } } } } },
  }, {});
  c = mk(f); await c.autoApproveOne('r1');
  const to = Object.values(Object.values(f.db.businesses)[0].outlets)[0];
  assert.equal(to.locked, true, 'template cannot unlock a new outlet');
  assert.equal(to.adminLogin.email, 'a@x.com', 'template cannot rewrite the admin login');
  assert.equal(to.whatsapp.status, 'pending', 'template cannot fake a connected WhatsApp');
  assert.ok(to.categories && to.categories.c1, 'template data still applied');
  console.log('PASS template data cannot override lock / admin login / whatsapp');

  f = makeFake({ onboardingRequests: { r1: req() } }, {}); c = mk(f); await c.autoApproveOne('r1'); await sleep(60);
  assert.equal(f.db.onboardingRequests.r1.status, 'pending'); assert.ok(!f.db.businesses);
  assert.ok(Object.values(f.db.inquiries)[0].message.includes('could not be auto-approved'));
  console.log('PASS missing password: retried, left pending, Supreme told');

  f = makeFake({ onboardingRequests: { r1: req() }, onboardingSecrets: { r1: { password: 'secret123' } } }, { 'a@x.com': 'u1' });
  c = mk(f); await c.autoApproveOne('r1');
  assert.equal(f.db.onboardingRequests.r1.status, 'rejected'); assert.ok(!f.db.businesses);
  assert.ok(!f.db.onboardingRequests.r1.bid, 'no retry marker left behind — a later attempt must still reject');
  console.log('PASS duplicate email: rejected, nothing created, no retry marker');

  // Retry of a request whose ids were already stamped — a previous attempt created the Auth
  // user and then failed before writing the outlet. It must resume, not reject the signup and
  // strand the account.
  f = makeFake({ onboardingRequests: { r1: req({ bid: 'b1', oid: 'o1' }) }, onboardingSecrets: { r1: { password: 'secret123' } } }, { 'a@x.com': 'u1' });
  c = mk(f); await c.autoApproveOne('r1');
  assert.equal(f.db.onboardingRequests.r1.status, 'approved', 'retry resumes instead of rejecting');
  assert.ok(f.db.businesses.b1.outlets.o1, 'same ids reused');
  assert.equal(Object.keys(f.db.businesses).length, 1, 'no second tenant');
  assert.equal(f.db.admins.u1.outlet, 'o1', 'existing Auth user adopted');
  assert.equal(Object.keys(f.db.businesses.b1.outlets).length, 1, 'exactly one outlet');
  console.log('PASS retry: same ids reused, one tenant, no orphan account');

  // Retry where the previous attempt already reached the outlet write: its outlet number must
  // be kept, not re-allocated (outletNo is a label, and two outlets must never share one).
  f = makeFake({ onboardingRequests: { r1: req({ bid: 'b1', oid: 'o1' }) }, onboardingSecrets: { r1: { password: 'secret123' } }, businesses: { b1: { outlets: { o1: { outletNo: '07' } } } } }, { 'a@x.com': 'u1' });
  c = mk(f); await c.autoApproveOne('r1');
  assert.equal(f.db.businesses.b1.outlets.o1.outletNo, '07', 'previous outlet number reused');
  assert.equal(f.db.meta, undefined, 'counter not advanced on a retry');
  console.log('PASS retry: previous outlet number reused, counter untouched');

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

  // ---- D2: owner email verification -----------------------------------------
  const TTL_AGO = Date.now() - 73 * 3600 * 1000;
  const approvedReq = (o = {}) => ({ status: 'approved', reviewedBy: 'auto-onboarding', reviewedAt: TTL_AGO, bid: 'b1', oid: 'o1', adminEmail: 'owner@x.com', ...o });
  const tenantDb = (req = {}, outlet = {}, extra = {}) => ({
    onboardingRequests: { r1: approvedReq(req) },
    businesses: { b1: { outlets: { o1: { adminLogin: { email: 'owner@x.com' }, ...outlet } } } },
    outletIndex: { o1: { bid: 'b1' } },
    admins: { u1: { outlet: 'o1', businessId: 'b1' } },
    ...extra,
  });

  // Status helper: verified / unverified / legacy outlet / user that no longer exists.
  f = makeFake({ businesses: { b1: { outlets: { o1: { adminLogin: { email: 'owner@x.com' } } } } } }, { 'owner@x.com': 'u1' }, ['owner@x.com']);
  c = mk(f);
  let st = await c.outletAdminStatus('b1', 'o1');
  assert.equal(st.email, 'owner@x.com'); assert.equal(st.emailVerified, true); assert.equal(st.uid, 'u1');
  f = makeFake({ businesses: { b1: { outlets: { o1: { adminLogin: { email: 'owner@x.com' } } } } } }, { 'owner@x.com': 'u1' });
  c = mk(f); st = await c.outletAdminStatus('b1', 'o1'); assert.equal(st.emailVerified, false);
  f = makeFake({ businesses: { b1: { outlets: { o1: {} } } } }, {}); c = mk(f);
  st = await c.outletAdminStatus('b1', 'o1'); assert.equal(st.email, null); assert.equal(st.emailVerified, null);
  f = makeFake({ businesses: { b1: { outlets: { o1: { adminLogin: { email: 'gone@x.com' } } } } } }, {}); c = mk(f);
  st = await c.outletAdminStatus('b1', 'o1'); assert.equal(st.emailVerified, false); assert.equal(st.missing, true);
  console.log('PASS outletAdminStatus: verified / unverified / legacy outlet / missing user');

  // Observe mode is the default: report, never delete.
  f = makeFake(tenantDb(), { 'owner@x.com': 'u1' });
  c = mk(f); assert.equal(c.CLEANUP_ENFORCE, false);
  let out = await c.runUnverifiedCleanup();
  assert.equal(out.candidates, 1); assert.equal(out.deleted, 0);
  assert.ok(f.db.businesses.b1.outlets.o1 && f.users['owner@x.com'] && f.db.admins.u1, 'observe mode deletes nothing');
  assert.equal(f.db.onboardingRequests.r1.status, 'approved');
  console.log('PASS cleanup observe mode: candidate reported, nothing deleted');

  // Enforce: the tenant, index, mirror and Auth user go; the request is expired.
  f = makeFake(tenantDb(), { 'owner@x.com': 'u1' });
  c = mk(f, { ONBOARDING_CLEANUP: 'enforce' }); assert.equal(c.CLEANUP_ENFORCE, true);
  out = await c.runUnverifiedCleanup();
  assert.equal(out.deleted, 1);
  assert.ok(!f.db.businesses.b1, 'single-outlet business removed');
  assert.ok(!f.db.outletIndex.o1, 'outletIndex removed');
  assert.ok(!f.db.admins.u1, 'admins mirror removed');
  assert.ok(!f.users['owner@x.com'], 'auth user deleted');
  assert.equal(f.db.onboardingRequests.r1.status, 'expired');
  assert.equal(typeof f.db.onboardingRequests.r1.expiredAt, 'number');
  assert.ok(f.db.onboardingRequests.r1.expireReason);
  console.log('PASS cleanup enforce: tenant, index, mirror and Auth user removed; request expired');

  // Verified owners, fresh sign-ups, activity and manual approvals are never touched.
  f = makeFake(tenantDb(), { 'owner@x.com': 'u1' }, ['owner@x.com']); c = mk(f, { ONBOARDING_CLEANUP: 'enforce' });
  out = await c.runUnverifiedCleanup(); assert.equal(out.candidates, 0); assert.ok(f.db.businesses.b1);
  f = makeFake(tenantDb({ reviewedAt: Date.now() - 3600000 }), { 'owner@x.com': 'u1' }); c = mk(f, { ONBOARDING_CLEANUP: 'enforce' });
  out = await c.runUnverifiedCleanup(); assert.equal(out.candidates, 0); assert.ok(f.db.businesses.b1);
  f = makeFake(tenantDb({}, {}, { businesses: { b1: { outlets: { o1: { adminLogin: { email: 'owner@x.com' }, orders: { x: { total: 10 } } } } } } }), { 'owner@x.com': 'u1' }); c = mk(f, { ONBOARDING_CLEANUP: 'enforce' });
  out = await c.runUnverifiedCleanup(); assert.equal(out.candidates, 0); assert.ok(f.db.businesses.b1);
  f = makeFake(tenantDb({}, {}, { businesses: { b1: { outlets: { o1: { adminLogin: { email: 'owner@x.com' }, billing: { payments: { p1: { amount: 1000 } } } } } } } }), { 'owner@x.com': 'u1' }); c = mk(f, { ONBOARDING_CLEANUP: 'enforce' });
  out = await c.runUnverifiedCleanup(); assert.equal(out.candidates, 0); assert.ok(f.db.businesses.b1);
  f = makeFake(tenantDb({ reviewedBy: 'super-uid' }), { 'owner@x.com': 'u1' }); c = mk(f, { ONBOARDING_CLEANUP: 'enforce' });
  out = await c.runUnverifiedCleanup(); assert.equal(out.candidates, 0); assert.ok(f.db.businesses.b1);
  f = makeFake(tenantDb({ bid: 'foodhubbie-demo' }), { 'owner@x.com': 'u1' }); c = mk(f, { ONBOARDING_CLEANUP: 'enforce' });
  out = await c.runUnverifiedCleanup(); assert.equal(out.candidates, 0); assert.ok(f.db.businesses.b1);
  console.log('PASS cleanup spares verified, fresh, active (orders/payments), manual and demo tenants');

  // A business with another outlet keeps the business; only the expired outlet goes.
  f = makeFake(tenantDb({}, {}, { businesses: { b1: { outlets: { o1: { adminLogin: { email: 'owner@x.com' } }, o2: { name: 'Second' } } } } }), { 'owner@x.com': 'u1' });
  c = mk(f, { ONBOARDING_CLEANUP: 'enforce' });
  await c.runUnverifiedCleanup();
  assert.ok(!f.db.businesses.b1.outlets.o1, 'expired outlet removed');
  assert.ok(f.db.businesses.b1.outlets.o2, 'sibling outlet kept');
  console.log('PASS cleanup keeps a business that still has another outlet');

  // The admins mirror belongs to the person, not the tenant: never delete a row that
  // has been re-pointed at another outlet.
  f = makeFake(tenantDb({}, {}, { admins: { u1: { outlet: 'o2', businessId: 'b1' } } }), { 'owner@x.com': 'u1' });
  c = mk(f, { ONBOARDING_CLEANUP: 'enforce' });
  await c.runUnverifiedCleanup();
  assert.ok(f.db.admins.u1, 're-pointed admins row kept');
  assert.ok(!f.users['owner@x.com'], 'auth user still removed');
  console.log('PASS cleanup never deletes an admins row that moved to another outlet');

  console.log('ALL PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
