// Verify onboardingRequests reject-path rules live (REST only, no browser).
// 1. unauth create of a pending request (should pass)
// 2. super-auth update to status:'rejected' + rejectReason (rules say status must stay 'pending'?)
const admin = require('firebase-admin');
const fs = require('fs');
const https = require('https');

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync('service-account.json', 'utf8'))),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
});
const DB = 'https://foodhubbie-10-default-rtdb.firebaseio.com';
const APIKEY = 'AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4';
const REQ = 'e2e-verify-rules-tmp';

function req(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      method, hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const results = [];
  // 1. unauth create (expect 200)
  const payload = { businessName: 'E2E Verify', outletName: 'Tmp Outlet', contactPhone: '9876543210', contactEmail: 'a@b.com', adminEmail: 'verify-tmp@test.com', adminPassword: 'secret123', plan: 'starter', source: 'website', status: 'pending', createdAt: Date.now() };
  let r = await req('PUT', `${DB}/onboardingRequests/${REQ}.json`, payload);
  results.push(`1. unauth create: ${r.status} (expect 200) ${r.status === 200 ? 'PASS' : 'FAIL ' + r.body}`);

  // 2. super token — rules read admins/{uid}/isSuper from DB, not claims
  await admin.database().ref('admins/verify-reject-tmp').set({ isSuper: true, email: 'verify-reject-tmp@test.com' });
  const ct = await admin.auth().createCustomToken('verify-reject-tmp', { isSuper: true });
  const login = await req('POST', `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${APIKEY}`, { token: ct, returnSecureToken: true });
  if (login.status !== 200) { console.log('login failed', login.status, login.body); process.exit(1); }
  const idToken = JSON.parse(login.body).idToken;

  // 3. reject update as super (expect 200 or 401/permission-denied if rules block)
  r = await req('PATCH', `${DB}/onboardingRequests/${REQ}.json?auth=${idToken}`, { status: 'rejected', rejectReason: 'verify test', reviewedAt: Date.now(), reviewedBy: 'verify-reject-tmp' });
  const blocked = r.status !== 200;
  results.push(`2. super reject write: ${r.status} ${r.status === 200 ? 'PASS (rules allow)' : 'BLOCKED -> ' + r.body}`);
  const final = await req('GET', `${DB}/onboardingRequests/${REQ}.json?auth=${idToken}`);
  results.push(`3. final state: ${final.body}`);

  // 4. locked rule: super can write locked on any outlet
  r = await req('GET', `${DB}/businesses.json?auth=${idToken}`);
  const bids = r.status === 200 && r.body !== 'null' ? Object.keys(JSON.parse(r.body)) : [];
  if (bids.length) {
    const oids = Object.keys(JSON.parse((await req('GET', `${DB}/businesses/${bids[0]}/outlets.json?auth=${idToken}`)).body) || {});
    if (oids.length) {
      const path = `businesses/${bids[0]}/outlets/${oids[0]}/locked.json`;
      r = await req('GET', `${DB}/${path}?auth=${idToken}`);
      const before = r.body;
      r = await req('PUT', `${DB}/${path}?auth=${idToken}`, 'true');
      results.push(`4. super write locked=true: ${r.status} ${r.status === 200 ? 'PASS' : 'FAIL ' + r.body}`);
      r = await req('PUT', `${DB}/${path}?auth=${idToken}`, before === 'true' ? 'true' : before === 'false' ? 'false' : null);
      results.push(`   restore locked -> ${r.status} (was ${before})`);
    }
  }
  // 5. unauth write locked (expect 401)
  if (bids.length) {
    const oids = Object.keys(JSON.parse((await req('GET', `${DB}/businesses/${bids[0]}/outlets.json?auth=${idToken}`)).body) || {});
    if (oids.length) {
      r = await req('PUT', `${DB}/businesses/${bids[0]}/outlets/${oids[0]}/locked.json`, 'true');
      results.push(`5. unauth write locked: ${r.status} ${r.status !== 200 ? 'PASS (denied)' : 'FAIL (open!)'}`);
    }
  }
  // 6. unauth read onboardingRequests (expect 401)
  r = await req('GET', `${DB}/onboardingRequests.json`);
  results.push(`6. unauth read onboardingRequests: ${r.status} ${r.status !== 200 ? 'PASS (denied)' : 'FAIL (open!)'}`);

  // cleanup
  await admin.auth().deleteUser('verify-reject-tmp').catch(() => {});
  await admin.database().ref(`onboardingRequests/${REQ}`).remove().catch(() => {});
  await admin.database().ref('admins/verify-reject-tmp').remove().catch(() => {});
  console.log(results.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
