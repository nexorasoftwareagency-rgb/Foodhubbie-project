/* P3-8 part 2: per-visit payload sizes (menu load, admin listeners) */
const admin = require('firebase-admin');
const sa = require('./service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com' });
const db = admin.database();
const bs = v => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
(async () => {
  const out = db.ref('businesses/roshani-pizza/outlets/pizza');
  const [cats, dishes, tables, menuBank, logs] = await Promise.all([
    out.child('categories').once('value'), out.child('dishes').once('value'),
    out.child('tables').once('value'), db.ref('menuBank').once('value'),
    db.ref('logs').once('value')
  ]);
  const rows = { categories: bs(cats.val()), dishes: bs(dishes.val()), tables: bs(tables.val()), menuBank: bs(menuBank.val()), logs: bs(logs.val()) };
  for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(12), (v/1024).toFixed(1), 'KB');
  const menuPayload = rows.categories + rows.dishes;
  console.log('\nQR menu initial RTDB payload:', (menuPayload/1024).toFixed(1), 'KB');
  const adminPayload = rows.categories + rows.dishes + rows.tables;
  console.log('Admin (cat+dish+tables):', (adminPayload/1024).toFixed(1), 'KB (listeners then stream deltas)');
  // logs breakdown
  const lv = logs.val() || {};
  console.log('\nlogs children:', Object.keys(lv).map(k => k + ':' + Object.keys(lv[k]||{}).length).join(', '));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
