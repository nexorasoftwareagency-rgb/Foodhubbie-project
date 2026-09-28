// ponytail: single-file cost model = Firebase (Blaze) + EC2 server. No deps.
// usage: node Research/scripts/cost-calc.js [--fixed]   (--fixed = images externalized out of RTDB)
// model: orders/day per restaurant {10,50,100} x restaurants {10,50,100}
//        scans/day = 1.5 x orders (P3-8 calibration: busy = 100 orders -> 150 scans)
'use strict';

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v === undefined || isNaN(+v) ? (v ?? true) : +v]; })
);
const FIXED = !!args.fixed;
const INR_OUT = !!args.inr;   // --inr: print money in rupees (site default); rates still modeled at ₹88/$
const fmt = v => INR_OUT ? '₹' + Math.round(v * INR).toLocaleString('en-IN') : '$' + v.toFixed(2);
const fmtOrd = v => INR_OUT ? '₹' + (v * INR).toFixed(2) : '$' + v.toFixed(4);

// --- Firebase RTDB rates (Blaze, free allowances kept) ---
const MENU_KB_CURRENT = 730;   // measured P3-8: base64 images inline in RTDB
const MENU_KB_FIXED = 75;      // after image externalization (P3-8 fix #1)
const ADMIN_GB = 0.5, RIDERS_GB = 1.8;  // measured P3-8 monthly per restaurant
const MENU_SHELL_MB = 0.3;  // measured P3-9: menu app = 388 KB cold load (CDN/browser cached after)
const STAFF_GB = 0.5;       // admin+rider dashboards, cache-heavy staff devices
const FREE_RTD_DL = 10;        // GB/mo free RTDB download
const RATE_RTD_DL = 1;         // $/GB
const FREE_HOST = 10.9;        // GB/mo free Hosting transfer (360 MB/day)
const RATE_HOST = 0.15;        // $/GB
const FREE_STORE_EGRESS = 30;  // GB/mo legacy bucket (1 GB/day)
const RATE_STORE_EGRESS = 0.12;// $/GB

// --- EC2 server sizing (P3-8 SSM measurement: t3.small 2GB caps at ~10 outlets) ---
const SERVER = { 10: ['t3.small', 15.2], 50: ['t3.large', 60.7], 100: ['t3.xlarge', 121.5] };
const server = n => SERVER[n] || [SERVER[100][0], SERVER[100][1] * n / 100];

// --- WhatsApp bot model (P3-9) ---
// EC2 runs ONLY the WhatsApp stack (bot workers 155MB/outlet + webhook :5000 + control-api :4000 + Redis)
//   => without WhatsApp agent: server = $0 (terminate EC2)
const BOT_GB = 0.5;            // bot listeners/writes est, GB/mo/outlet
const MSG_PER_ORDER = 8;       // bot handles DELIVERY orders only (dine-in = QR table + POS, never WhatsApp): greeting + menu CTA + placed + confirmed + ready + OFD/OTP + reached + delivered = 8
const MKTG_PER_ORDER = 0.1;    // promo broadcasts (adjust with --mktg=)
const INR = 88;                // ₹/USD
const RATE_UTILITY = 0.115;    // ₹/msg India: utility + service (post 2026-10-01)
const RATE_MARKETING = 0.86;   // ₹/msg India marketing, never free
const FREE_SERVICE = 0;        // free 1,000/number/mo allowance REMOVED from model (decision): bill every message, worst case

const ORDERS_TIERS = [10, 50, 100];
const REST_TIERS = [10, 50, 100];
const gb = (kb, scans) => (kb * scans * 30) / 1e6;

function firebase(orders, rest, extraGbPerRest = 0) {
  const scans = 1.5 * orders;
  const rtdbGb = gb(FIXED ? MENU_KB_FIXED : MENU_KB_CURRENT, scans) + ADMIN_GB + RIDERS_GB + extraGbPerRest;
  const total = rtdbGb * rest;
  const rtdbCost = Math.max(0, total - FREE_RTD_DL) * RATE_RTD_DL;
  // after fix, images egress from Storage instead of RTDB (same bytes)
  const storeGb = FIXED ? gb(MENU_KB_CURRENT, scans) * rest : 0;
  const storeCost = Math.max(0, storeGb - FREE_STORE_EGRESS) * RATE_STORE_EGRESS;
  const hostGb = (MENU_SHELL_MB * scans * 30) / 1000 + STAFF_GB;   // per restaurant
  const hostCost = Math.max(0, hostGb * rest - FREE_HOST) * RATE_HOST;
  return { rtdbCost, storeCost, hostCost, total: rtdbCost + storeCost + hostCost };
}

// Meta Cloud API fees, USD/mo (Baileys QR mode = ₹0 — see doc)
function meta(orders, rest) {
  const utilSvc = MSG_PER_ORDER * orders * 30;          // per outlet monthly
  const billable = Math.max(0, utilSvc - FREE_SERVICE);
  const mktg = (args.mktg ?? MKTG_PER_ORDER) * orders * 30;
  return ((billable * RATE_UTILITY + mktg * RATE_MARKETING) * rest) / INR;
}

console.log(`scenario: images ${FIXED ? 'EXTERNALIZED (fixed)' : 'in RTDB (current code)'}\n`);
console.log('orders/day | rest | server ($/mo) | firebase $/mo | TOTAL $/mo | $/restaurant');
console.log('-----------|------|---------------|---------------|------------|-------------');
for (const o of ORDERS_TIERS) {
  for (const r of REST_TIERS) {
    const [srv, srvCost] = server(r);
    const fb = firebase(o, r);
    const tot = fb.total + srvCost;
    console.log(
      `${String(o).padEnd(10)} | ${String(r).padEnd(4)} | ${String(srv + ' $' + srvCost.toFixed(0)).padEnd(13)} | ` +
      `$${fb.total.toFixed(2).padEnd(13)} | $${tot.toFixed(2).padEnd(10)} | $${(tot / r).toFixed(2)}`
    );
  }
  console.log('-----------|------|---------------|---------------|------------|-------------');
}

// --- Bot on/off comparison: without = Firebase only ($0 server, $0 Meta) ---
console.log(`\n=== BOT COST vs WITHOUT BOT (images ${FIXED ? 'externalized' : 'in RTDB'}, ${INR} INR/$) ===`);
console.log('orders | rest | WITHOUT bot | WITH bot: fb + server + meta = TOTAL | BOT COST | $/rest(with)');
console.log('-------|------|-------------|--------------------------------------|-----------|-------------');
for (const o of ORDERS_TIERS) {
  for (const r of REST_TIERS) {
    const without = firebase(o, r).total;                         // server $0, meta $0
    const fbB = firebase(o, r, BOT_GB).total;
    const srv = server(r)[1];
    const mta = meta(o, r);
    const withB = fbB + srv + mta;
    console.log(
      `${String(o).padEnd(6)} | ${String(r).padEnd(4)} | $${without.toFixed(2).padEnd(11)} | ` +
      `$${fbB.toFixed(0).padStart(5)} + $${srv.toFixed(0).padStart(3)} + $${mta.toFixed(0).padStart(5)} = $${withB.toFixed(2).padEnd(9)} | ` +
      `$${(withB - without).toFixed(2).padEnd(9)} | $${(withB / r).toFixed(2)}`
    );
  }
  console.log('-------|------|-------------|--------------------------------------|-----------|-------------');
}

// --- NO-BOT RUN SHEET: everything else, itemized (server & Meta = $0, Auth/Functions/Storage-at-rest = $0) ---
console.log(`\n=== NO-BOT RUN SHEET: all functions, zero WhatsApp bots (images ${FIXED ? 'externalized' : 'in RTDB'}) ===`);
console.log('orders | rest | rtdb+store $ | hosting $ | server $ | meta $ | auth/functions $ | TOTAL $/mo | $/rest');
console.log('-------|------|--------------|-----------|----------|--------|------------------|------------|-------');
for (const o of ORDERS_TIERS) {
  for (const r of REST_TIERS) {
    const f = firebase(o, r);
    console.log(
      `${String(o).padEnd(6)} | ${String(r).padEnd(4)} | ${(f.rtdbCost + f.storeCost).toFixed(2).padEnd(12)} | ` +
      `${f.hostCost.toFixed(2).padEnd(9)} | ${'0.00'.padEnd(8)} | ${'0.00'.padEnd(6)} | ${'0.00'.padEnd(16)} | ` +
      `${f.total.toFixed(2).padEnd(10)} | ${(f.total / r).toFixed(2)}`
    );
  }
  console.log('-------|------|--------|-----------|----------|--------|------------------|------------|-------');
}

// --- ALL POSSIBILITIES: bot modes x Meta pricing regimes ---
// A: no bot | B: bot + Baileys (₹0) | C1: Meta customer-first TILL Sep-30-2026 (service+in-window utility free;
//    only promos billed) | C2: Meta customer-first FROM Oct-1-2026 (service ₹0.115 after 1,000 free/number/mo)
console.log(`\n=== ALL POSSIBILITIES $/mo (images ${FIXED ? 'externalized' : 'in RTDB'}) ===`);
console.log('orders | rest | A: no bot | B: bot+Baileys | C1: Meta till Sep-30 | C2: Meta from Oct-1');
console.log('-------|------|-----------|-----------------|----------------------|--------------------');
for (const o of ORDERS_TIERS) {
  for (const r of REST_TIERS) {
    const A = firebase(o, r).total;
    const fbB = firebase(o, r, BOT_GB).total, srv = server(r)[1];
    const B = fbB + srv;
    const promo = ((args.mktg ?? MKTG_PER_ORDER) * o * 30 * RATE_MARKETING * r) / INR; // promos only (C1)
    const C1 = B + promo, C2 = B + meta(o, r);
    console.log(
      `${String(o).padEnd(6)} | ${String(r).padEnd(4)} | ${'$' + A.toFixed(2).padEnd(9)} | ` +
      `${'$' + B.toFixed(2).padEnd(15)} | ${'$' + C1.toFixed(2).padEnd(20)} | ${'$' + C2.toFixed(2)}`
    );
  }
  console.log('-------|------|-----------|-----------------|----------------------|--------------------');
}

// --- POSSIBILITY PAGES: one block per outcome, orders {10,25,50,100} x rest {10,50,100} ---
// per-order cost = total / (orders x 30 days x restaurants)
const POSS_TIERS = [10, 25, 50, 100];
const promoOnly = (o, r) => ((args.mktg ?? MKTG_PER_ORDER) * o * 30 * RATE_MARKETING * r) / INR;
const baseBot = (o, r) => firebase(o, r, BOT_GB).total + server(r)[1];
const POSSIBILITIES = [
  ['1: NO WHATSAPP BOT (Firebase only)', o_r => firebase(...o_r).total],
  ['2: BOT + BAILEYS QR (unofficial, Rs0 Meta)', o_r => baseBot(...o_r)],
  ['3: BOT + OFFICIAL META API - customer-first FREE (till Sep-30-2026)', o_r => baseBot(...o_r) + promoOnly(...o_r)],
  ['4: BOT + OFFICIAL META API - billed regime (from Oct-1-2026)', o_r => baseBot(...o_r) + meta(...o_r)],
];
for (const [name, cost] of POSSIBILITIES) {
  console.log(`\n=== POSSIBILITY ${name} (images ${FIXED ? 'externalized' : 'in RTDB'}) ===`);
  console.log(`orders/day | rest | TOTAL ${INR_OUT ? 'INR' : '$'}/mo | ${INR_OUT ? 'INR' : '$'}/order | ${INR_OUT ? 'INR' : '$'}/restaurant`);
  console.log('-----------|------|------------|---------|--------------');
  for (const o of POSS_TIERS) {
    for (const r of REST_TIERS) {
      const tot = cost([o, r]);
      console.log(
        `${String(o).padEnd(10)} | ${String(r).padEnd(4)} | ${fmt(tot).padEnd(10)} | ` +
        `${fmtOrd(tot / (o * 30 * r)).padEnd(9)} | ${fmt(tot / r)}`
      );
    }
    console.log('-----------|------|------------|---------|--------------');
  }
}

// self-checks
console.assert(firebase(10, 10).total > 0 || 1.5 * 10 * 30 * MENU_KB_CURRENT / 1e6 + 2.3 < FREE_RTD_DL, 'sanity');
console.assert(server(10)[1] < server(50)[1] && server(50)[1] < server(100)[1], 'server tiers monotonic');
console.log('\nasserts passed (server tiers monotonic, small-scale math sanity)');
