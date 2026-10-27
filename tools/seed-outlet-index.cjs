// One-off: backfill the rider-readable outletIndex node from businesses.
// outletIndex/{oid} = { bid, name, disabled, createdAt }
const admin = require('../bot/node_modules/firebase-admin');
const serviceAccount = require('../bot/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});

const db = admin.database();

db.ref('businesses').once('value').then(async (snap) => {
  const businesses = snap.val() || {};
  const updates = {};
  for (const [bid, business] of Object.entries(businesses)) {
    for (const [oid, outlet] of Object.entries(business.outlets || {})) {
      updates[`outletIndex/${oid}`] = {
        bid,
        name: (outlet && outlet.name) || oid,
        disabled: (outlet && outlet.disabled) === true,
      };
      console.log(`  outletIndex/${oid} -> ${bid} (name: ${updates[`outletIndex/${oid}`].name}, disabled: ${updates[`outletIndex/${oid}`].disabled})`);
    }
  }
  if (Object.keys(updates).length === 0) {
    console.log('No outlets found — nothing to seed.');
    process.exit(0);
  }
  await db.ref().update(updates);
  console.log(`Seeded ${Object.keys(updates).length} outlet(s).`);
  process.exit(0);
}).catch((err) => { console.error(err); process.exit(1); });
