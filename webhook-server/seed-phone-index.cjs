const admin = require('firebase-admin');
const serviceAccount = require('./bot/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});

const db = admin.database();
const mappings = {
  '1211796118690392': { businessId: 'roshani-pizza', outletId: 'pizza' }
};

(async () => {
  for (const [phoneNumberId, routing] of Object.entries(mappings)) {
    await db.ref(`phoneNumberIndex/${phoneNumberId}`).set(routing);
    console.log(`Seeded phoneNumberIndex/${phoneNumberId} ->`, JSON.stringify(routing));
  }
  const snap = await db.ref('phoneNumberIndex').get();
  console.log('Verification readback:', JSON.stringify(snap.val()));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
