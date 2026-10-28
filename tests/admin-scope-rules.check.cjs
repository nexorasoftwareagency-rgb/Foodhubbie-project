/**
 * Live probe for the 2026-10-28 admin-scope rules hardening.
 * Mints real client ID tokens and hits the RTDB REST API (rules-enforced).
 *
 * Run: node tests/admin-scope-rules.check.cjs
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

const WAITER = 'a8dpkS7XfQfspJ99SaJsyeZYLr53'; // pizza, role waiter, businessId roshani-pizza
const CAKE_OWNER = '1bjwUZof19U55RuwiIi0YtZKAHC2'; // cake, role owner, businessId roshani-cake
const E2E_MANAGER = 'vLdRU9ze2GePV19fLhg9daKU5Hn1'; // e2e outlet, manager
const SUPER = 'ZoDidAOi3fUyOXNWn559r87dADo2'; // isSuper (no businessId)

let failures = 0;
const out = [];
const log = (s) => out.push(s);
const finish = (code) => { fs.writeSync(1, out.join('\n') + '\n'); process.exit(code); };
const check = (name, ok, detail) => { log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); if (!ok) failures++; };

async function tokenFor(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!json.idToken) throw new Error('token exchange failed for ' + uid + ': ' + JSON.stringify(json).slice(0, 200));
  return json.idToken;
}

async function call(method, p, token, body) {
  // `.json` must sit before the query string: orders.json?shallow=true&auth=…
  const [base, qs] = p.split('?');
  const url = `${DB}/${base}.json${qs ? '?' + qs : ''}${token ? (qs ? '&' : '?') + 'auth=' + token : ''}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

(async () => {
  const [waiter, cake, e2e, superT] = await Promise.all([tokenFor(WAITER), tokenFor(CAKE_OWNER), tokenFor(E2E_MANAGER), tokenFor(SUPER)]);

  check('waiter reads own outlet orders', (await call('GET', 'businesses/roshani-pizza/outlets/pizza/orders?shallow=true', waiter)) === 200);
  check('waiter CANNOT read cake orders', (await call('GET', 'businesses/roshani-cake/outlets/cake/orders?shallow=true', waiter)) === 401);
  check('waiter CANNOT read cake business node', (await call('GET', 'businesses/roshani-cake', waiter)) === 401);
  check('waiter CANNOT read admins collection', (await call('GET', 'admins', waiter)) === 401);
  check('waiter CANNOT read audit log', (await call('GET', 'logs/audit?shallow=true', waiter)) === 401);
  check('waiter CANNOT read phoneNumberIndex', (await call('GET', 'phoneNumberIndex', waiter)) === 401);
  check('waiter reads own admin node', (await call('GET', `admins/${WAITER}`, waiter)) === 200);

  check('cake owner reads own business', (await call('GET', 'businesses/roshani-cake', cake)) === 200);
  check('cake owner CANNOT read pizza business', (await call('GET', 'businesses/roshani-pizza', cake)) === 401);
  check('cake owner CANNOT read pizza orders', (await call('GET', 'businesses/roshani-pizza/outlets/pizza/orders?shallow=true', cake)) === 401);

  check('e2e manager reads own business (no outletIndex entry)', (await call('GET', 'businesses/e2e-biz-1792987605261/outlets/e2e-outlet-1792987605261/orders?shallow=true', e2e)) === 200);
  check('e2e manager CANNOT read pizza business', (await call('GET', 'businesses/roshani-pizza', e2e)) === 401);

  check('super reads admins collection', (await call('GET', 'admins', superT)) === 200);
  check('super reads audit log', (await call('GET', 'logs/audit?shallow=true', superT)) === 200);

  // Self-write: businessId is immutable, normal field updates still work.
  check('waiter CANNOT repoint own businessId', (await call('PATCH', `admins/${WAITER}`, waiter, { businessId: 'roshani-cake' })) === 401);
  check('waiter CANNOT self-promote to super', (await call('PATCH', `admins/${WAITER}`, waiter, { isSuper: true })) === 401);
  check('waiter CAN update own fcmToken', (await call('PATCH', `admins/${WAITER}`, waiter, { fcmToken: '' })) === 200);
  check('waiter CANNOT create an admin node for someone else', (await call('PUT', 'admins/evil-node', waiter, { email: 'x@y.z', outlet: 'pizza', businessId: 'roshani-pizza', role: 'Admin' })) === 401);

  // Public reads stay public.
  check('anonymous reads store info', (await call('GET', 'businesses/roshani-pizza/outlets/pizza/settings/Store/storeName', null)) === 200);
  check('anonymous reads menu dishes', (await call('GET', 'businesses/roshani-pizza/outlets/pizza/dishes?shallow=true', null)) === 200);
  check('anonymous CANNOT read orders', (await call('GET', 'businesses/roshani-pizza/outlets/pizza/orders?shallow=true', null)) === 401);

  log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  finish(failures ? 1 : 0);
})().catch((e) => { log('ERR ' + (e && e.message)); finish(1); });
