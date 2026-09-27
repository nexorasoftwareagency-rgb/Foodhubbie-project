// One-off: assign platform-wide outletNo (01, 02, ...) to existing outlets so
// order IDs read like 03-161126-12. Dry-run by default; pass --apply to write.
// Uses REST ?shallow=true to list keys without pulling order trees.
// Run: node bot/backfill-outlet-no.cjs [--apply]
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const FIREBASE_URL = 'https://foodhubbie-10-default-rtdb.firebaseio.com';
const keyPath = path.join(__dirname, 'service-account.json');
if (!fs.existsSync(keyPath)) { console.error('missing bot/service-account.json'); process.exit(1); }
const serviceAccount = require(keyPath);
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: FIREBASE_URL });
const db = admin.database();
const APPLY = process.argv.includes('--apply');

const cred = admin.credential.cert(serviceAccount);
let tokenP = null;
async function headers() {
  if (!tokenP) tokenP = cred.getAccessToken();
  return { Authorization: `Bearer ${(await tokenP).access_token}` };
}
async function restKeys(p) { // shallow: keys only
  const res = await fetch(`${FIREBASE_URL}${p}.json?shallow=true`, { headers: await headers() });
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  const j = await res.json();
  return j ? Object.keys(j) : [];
}
async function restVal(p) { // small primitive read
  const res = await fetch(`${FIREBASE_URL}${p}.json`, { headers: await headers() });
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  return res.json(); // null | number | string
}

(async () => {
  const counter = (await db.ref('meta/outletCounter').once('value')).val() || 0;
  const bids = await restKeys('/businesses');
  console.log(`businesses: ${bids.length}, current counter: ${counter}`);

  const outlets = [];
  for (const bid of bids) {
    const bizCreated = await restVal(`/businesses/${bid}/createdAt`);
    const oids = await restKeys(`/businesses/${bid}/outlets`);
    for (const oid of oids) {
      const [existingNo, outletCreated] = await Promise.all([
        restVal(`/businesses/${bid}/outlets/${oid}/outletNo`),
        restVal(`/businesses/${bid}/outlets/${oid}/createdAt`),
      ]);
      outlets.push({ bid, oid, existingNo, created: outletCreated ?? bizCreated ?? 0 });
    }
  }

  // Seeds (no timestamps) sort first; ties broken deterministically.
  outlets.sort((a, b) => a.created - b.created || (a.bid < b.bid ? -1 : a.bid > b.bid ? 1 : 0) || (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0));

  let maxAssigned = 0;
  for (const o of outlets) if (o.existingNo) maxAssigned = Math.max(maxAssigned, parseInt(o.existingNo, 10) || 0);
  let next = Math.max(counter, maxAssigned);
  const plan = {};
  for (const o of outlets) {
    if (o.existingNo) { console.log(`  keep  ${o.existingNo}  ${o.bid}/${o.oid}`); continue; }
    next += 1;
    const no = String(next).padStart(2, '0');
    plan[`businesses/${o.bid}/outlets/${o.oid}/outletNo`] = no;
    console.log(`${APPLY ? 'assign' : 'would '} ${no}  ${o.bid}/${o.oid}  (created ${o.created || 'seed'})`);
  }
  if (next > counter) plan['meta/outletCounter'] = next;

  const n = Object.keys(plan).length;
  if (!n) { console.log('nothing to do'); process.exit(0); }
  if (!APPLY) { console.log(`\nDRY-RUN: ${n} writes planned. Re-run with --apply.`); process.exit(0); }
  await db.ref().update(plan);
  console.log(`\nAPPLIED ${n} writes. outletCounter = ${next}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
