import crypto from 'crypto';
import fs from 'fs';

// Live e2e for the admins/{uid} clobber fix (bot-control-api update-password mirror).
// create-branch (missing mirror, name=oid fallback) → customize via self-token →
// second password update → customized fields must survive (old wholesale set() reverted
// name to outletName and erased extra fields).
// Sacrificial email under bid=_ct (junk path, deleted at the end); no real outlet touched.

const SA = JSON.parse(fs.readFileSync('Credentials/foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json', 'utf8'));
const KEY = 'AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4';
const TUNNEL = 'https://photos-whenever-specifics-internationally.trycloudflare.com';
const RTDB = 'https://foodhubbie-10-default-rtdb.firebaseio.com';
const SUPER_UID = 'V8jxcqeXMJd1pNodadk3HjIY6hh1'; // Nexora — isSuper in admins DB (API reads claims from DB, not token)
const EMAIL = 'clobber-check@example.com';
const BID = '_ct', OID = 'pizza'; // oid must equal owner's outlet so admins rules validate passes

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const b64 = x => Buffer.from(JSON.stringify(x)).toString('base64url');

function mint(uid) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', typ: 'JWT' });
  const p = b64({
    iss: SA.client_email, sub: SA.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, uid,
    firebase: { identities: {}, sign_in_provider: 'custom' }
  });
  const s = crypto.createSign('RSA-SHA256').update(`${h}.${p}`).sign(SA.private_key.replace(/\\n/g, '\n'), 'base64url');
  return `${h}.${p}.${s}`;
}

async function customSignIn(uid) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: mint(uid), returnSecureToken: true })
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('signInWithCustomToken failed: ' + JSON.stringify(j).slice(0, 200));
  return j.idToken;
}

async function passwordSignIn(pw) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: pw, returnSecureToken: true })
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('signInWithPassword failed: ' + JSON.stringify(j).slice(0, 200));
  return { idToken: j.idToken, localId: j.localId };
}

const rtdb = (path, tok, method = 'GET', body) =>
  fetch(`${RTDB}/${path}.json?auth=${tok}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

const api = (path, tok, body) =>
  fetch(`${TUNNEL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body)
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

let superTok;
try {
  superTok = await customSignIn(SUPER_UID);

  // 1. create-branch: no admins record for the sacrificial email
  let res = await api('/api/admin/update-password', superTok, { bid: BID, oid: OID, email: EMAIL, newPassword: 'Clobber123!' });
  assert(res.status === 200 && res.json?.ok, `create-branch: HTTP ${res.status} ${JSON.stringify(res.json)?.slice(0, 120)}`);
  const uid = res.json?.uid;
  if (!uid) throw new Error('no uid from create-branch');

  let rec = (await rtdb(`admins/${uid}`, superTok)).json;
  assert(rec?.name === OID, `create-branch seeds name from outletName/oid (got "${rec?.name}")`);
  assert(rec?.outlet === OID && rec?.businessId === BID, 'create-branch wrote outlet + businessId');

  // 2. customize via a token AS the sacrificial user (self-write rules)
  const self = await passwordSignIn('Clobber123!');
  assert(self.localId === uid, 'password sign-in returns same uid');
  let w = await rtdb(`admins/${uid}`, self.idToken, 'PATCH', { name: 'KeepMe', zzKeep: 'X' });
  assert(w.status === 200, `customize PATCH accepted (HTTP ${w.status} ${JSON.stringify(w.json)?.slice(0, 100)})`);

  // 3. second password update — the clobber regression point
  res = await api('/api/admin/update-password', superTok, { bid: BID, oid: OID, email: EMAIL, newPassword: 'Clobber456!' });
  assert(res.status === 200 && res.json?.ok, `second update-password: HTTP ${res.status}`);

  rec = (await rtdb(`admins/${uid}`, superTok)).json;
  assert(rec?.name === 'KeepMe', `name preserved after re-update (got "${rec?.name}")`);
  assert(rec?.zzKeep === 'X', `extra owner-managed field preserved (got "${rec?.zzKeep}")`);

  // 4. cleanup: Auth user, mirror, junk businesses/_ct path
  const pw = await passwordSignIn('Clobber456!');
  let del = { status: 0 };
  if (pw.idToken) {
    del = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: pw.idToken })
    });
  }
  assert(del.status === 200, `sacrificial Auth user deleted (HTTP ${del.status})`);

  const d1 = await rtdb(`admins/${uid}`, superTok, 'DELETE');
  assert(d1.status === 200, `mirror record deleted (HTTP ${d1.status})`);
  const d2 = await rtdb(`businesses/${BID}`, superTok, 'DELETE');
  assert(d2.status === 200, `junk businesses/${BID} deleted (HTTP ${d2.status})`);
  if (d1.status !== 200 || d2.status !== 200 || del.status !== 200) console.log('MANUAL CLEANUP NEEDED:', JSON.stringify({ uid, del: del.status, d1: d1.status, d2: d2.status, d1b: d1.json, d2b: d2.json }));
} catch (e) {
  fail++; console.log('FAIL fatal:', e.message);
  console.log('MANUAL CLEANUP MAY BE NEEDED for clobber-check@example.com / businesses/_ct');
}

console.log(`RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
