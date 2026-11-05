/* P3-8: measure RTDB size, node counts, daily volumes */
const admin = require('firebase-admin');
const path = require('path');
const sa = require('./service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com' });
const db = admin.database();

function byteSize(v) { return Buffer.byteLength(JSON.stringify(v ?? null), 'utf8'); }
function countNodes(v) {
  if (v === null || typeof v !== 'object') return 1;
  return Object.values(v).reduce((s, x) => s + countNodes(x), 0);
}

(async () => {
  const snap = await db.ref('/').once('value');
  const root = snap.val();
  const totalBytes = byteSize(root);
  const totalNodes = countNodes(root);
  console.log('TOTAL bytes:', totalBytes, '=', (totalBytes / 1048576).toFixed(2), 'MB');
  console.log('TOTAL nodes:', totalNodes);

  const tops = root && typeof root === 'object' ? Object.keys(root) : [];
  const rows = [];
  for (const k of tops) {
    const b = byteSize(root[k]);
    rows.push({ top: k, bytes: b, kb: +(b / 1024).toFixed(1), nodes: countNodes(root[k]) });
  }
  rows.sort((a, b) => b.bytes - a.bytes);
  console.log('\n--- TOP-LEVEL BY SIZE ---');
  rows.forEach(r => console.log(`${r.top.padEnd(30)} ${String(r.kb).padStart(10)} KB  ${String(r.nodes).padStart(8)} nodes`));

  // orders per day (last 60 days)
  const orders = root?.businesses?.['roshani-pizza']?.outlets?.pizza?.orders || {};
  const byDay = {};
  let szOrders = 0;
  for (const [id, o] of Object.entries(orders)) {
    const d = (o.createdAt || '').slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
    szOrders += byteSize({ [id]: o });
  }
  const days = Object.keys(byDay).sort();
  console.log('\n--- ORDERS ---');
  console.log('count:', Object.keys(orders).length, 'size KB:', +(szOrders / 1024).toFixed(1));
  console.log('day range:', days[0], '→', days[days.length - 1]);
  const daily = days.map(d => byDay[d]);
  const avg = daily.reduce((a, b) => a + b, 0) / (daily.length || 1);
  const max = Math.max(...daily, 0);
  console.log('days with orders:', days.length, 'avg/day:', avg.toFixed(1), 'max/day:', max);

  // sessions (active + total)
  const sess = root?.businesses?.['roshani-pizza']?.outlets?.pizza?.tableSessions || {};
  console.log('\ntableSessions:', Object.keys(sess).length, 'KB:', +(byteSize(sess) / 1024).toFixed(1));

  // menu/catalog size
  const cat = root?.businesses?.['roshani-pizza']?.outlets?.pizza?.catalog || root?.businesses?.['roshani-pizza']?.outlets?.pizza?.menu;
  console.log('catalog/menu present:', !!cat);

  // businesses count (multi-tenant readiness)
  const biz = root?.businesses ? Object.keys(root.businesses) : [];
  console.log('\nbusinesses:', biz.length, biz);
  for (const b of biz) {
    const outs = root.businesses[b]?.outlets ? Object.keys(root.businesses[b].outlets) : [];
    console.log(' ', b, 'outlets:', outs.join(','));
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
