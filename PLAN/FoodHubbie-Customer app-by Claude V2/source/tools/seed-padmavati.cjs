// Re-seeds the padmavati-test demo outlet (deleted during cleanup).
// Business + outlet + store name + category + dishes + one table.
const admin = require('firebase-admin');
const serviceAccount = require('../bot/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});

const db = admin.database();

const now = Date.now();
const bid = 'padmavati-test';
const oid = 'padmavati';

async function main() {
  const tableToken = 'PADM2026TESTA';
  await db.ref(`businesses/${bid}`).update({
    name: 'Padmavati',
    contactPhone: '+919999999999',
    contactEmail: 'padmavati@example.com',
    plan: 'starter',
    createdAt: now,
  });
  await db.ref(`businesses/${bid}/outlets/${oid}`).update({
    name: 'Padmavati',
    contactPhone: '+919999999999',
    createdAt: now,
    whatsapp: { status: 'pending' },
    adminLogin: { email: 'padmavati@example.com' },
    settings: {
      Store: { storeName: 'Padmavati Restaurant' },
      Delivery: { enabled: true },
    },
    dineinSettings: { qrBaseUrl: 'https://foodhubbie-qrmenu.web.app/' },
  });
  await db.ref(`businesses/${bid}/outlets/${oid}/categories`).set({
    c1: { name: 'Starters', position: 1 },
    c2: { name: 'Main Course', position: 2 },
  });
  await db.ref(`businesses/${bid}/outlets/${oid}/dishes`).set({
    d1: { name: 'Paneer Tikka', price: 199, categoryId: 'c1', available: true, position: 1 },
    d2: { name: 'Dal Tadka', price: 149, categoryId: 'c2', available: true, position: 2 },
  });
  await db.ref(`businesses/${bid}/outlets/${oid}/tables`).set({
    t1: { number: 'T1', capacity: 4, token: tableToken, active: true, status: 'free' },
  });
  console.log('Seeded padmavati-test, table token', tableToken);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });