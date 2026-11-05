// One-time backfill: mirrors every existing outlet's categories + dishes into
// the platform menu bank (menuBank/{categories,dishes}), deduped by slug.
// Run with admin SDK:
//   $env:NODE_PATH = "D:\Foodhubbie Project\bot\node_modules"; node tools/seed-menu-bank.cjs
const admin = require('firebase-admin');
const serviceAccount = require('../bot/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});

const db = admin.database();
const slug = (name) => String(name || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';

async function main() {
  const bizSnap = await db.ref('businesses').once('value');
  const catUpdates = {};
  const dishUpdates = {};
  let cats = 0;
  let dishes = 0;

  for (const [bid, biz] of Object.entries(bizSnap.val() || {})) {
    for (const [oid, out] of Object.entries(biz.outlets || {})) {
      const catsSnap = await db.ref(`businesses/${bid}/outlets/${oid}/categories`).once('value');
      catsSnap.forEach(c => {
        const v = c.val();
        if (!v || !v.name) return;
        catUpdates[`menuBank/categories/${slug(v.name)}`] = {
          ...v,
          sourceBid: bid,
          sourceOid: oid,
          updatedAt: Date.now(),
        };
        cats++;
      });

      const dishSnap = await db.ref(`businesses/${bid}/outlets/${oid}/dishes`).once('value');
      dishSnap.forEach(d => {
        const v = d.val();
        if (!v || !v.name) return;
        dishUpdates[`menuBank/dishes/${slug(`${v.name}-${v.category || 'other'}`)}`] = {
          ...v,
          sourceBid: bid,
          sourceOid: oid,
          updatedAt: Date.now(),
        };
        dishes++;
      });
    }
  }

  const writes = { ...catUpdates, ...dishUpdates };
  console.log(`Scanned ${Object.keys(bizSnap.val() || {}).length} businesses → ${cats} categories, ${dishes} dishes. Writing ${Object.keys(writes).length} unique bank entries...`);
  await db.ref().update(writes);
  console.log('Menu bank seeded ✓');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });