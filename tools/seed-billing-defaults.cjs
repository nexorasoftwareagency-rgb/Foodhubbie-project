// seed-billing-defaults.cjs — idempotent billing defaults + 15 FREE promo tokens.
// Creates businesses/{bid}/outlets/{oid}/billing for every outlet missing it.
// Re-run: outlets that already have billing are skipped (token balance untouched).
const admin = require('../bot/node_modules/firebase-admin');
const serviceAccount = require('../bot/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});

const db = admin.database();
const now = Date.now();

// Mirror of shared/cost-math.js DEFAULT_RATES + website pricing
const FREE_TOKENS = 15;
const DEFAULT_BILLING = {
  mode: 'per_order',
  rates: { QR: 2, POS: 1, webview_delivery: 3, WA: 3, other: 2, promo: 1, commission1pct: 0.01 },
  setup: { amount: 500, status: 'non_refundable', date: new Date(now).toISOString() },
  tokens: { balance: FREE_TOKENS, updatedAt: now },
  tokenPacks: { welcome: { qty: FREE_TOKENS, priceRs: 0, note: 'Free welcome pack', grantedAt: now, grantedBy: 'system' } },
};

async function main() {
  const bizSnap = await db.ref('businesses').get();
  if (!bizSnap.exists()) { console.log('No businesses found.'); return; }
  let seeded = 0, skipped = 0;
  for (const [bid, biz] of Object.entries(bizSnap.val())) {
    for (const oid of Object.keys(biz.outlets || {})) {
      const cur = await db.ref(`businesses/${bid}/outlets/${oid}/billing`).get();
      if (cur.exists()) {
        const val = cur.val() || {};
        // Wizard-stale billing (pre-2026-09-29): a bug shipped the abandoned
        // monthly-plan model (monthlyRate, no rates/setup/tokens). Replace
        // wholesale — those rows carry no money state (tokens.granted/used absent).
        if (val.monthlyRate != null) {
          await db.ref(`businesses/${bid}/outlets/${oid}/billing`).set(DEFAULT_BILLING);
          console.log(`REPAIR ${bid}/${oid} — stale monthly-plan billing replaced with defaults`);
          seeded++; continue;
        }
        // Rate migrations on existing billing: POS ₹1/order (was ₹2), promo ₹1/token (was ₹0.86)
        for (const [key, want] of [['POS', 1], ['promo', 1]]) {
          const have = val.rates?.[key];
          if (have != null && have !== want) {
            await db.ref(`businesses/${bid}/outlets/${oid}/billing/rates/${key}`).set(want);
            console.log(`PATCH ${bid}/${oid} rates/${key} ${have} → ${want}`);
          }
        }
        // Setup policy: fee is non-refundable (2026-09-29). Only rows still in the
        // old 'refundable' default move; paid/adjusted/refunded history is kept.
        if (val.setup?.status === 'refundable') {
          await db.ref(`businesses/${bid}/outlets/${oid}/billing/setup/status`).set('non_refundable');
          console.log(`PATCH ${bid}/${oid} setup.status refundable → non_refundable`);
        }
        console.log(`skip  ${bid}/${oid} (billing exists)`); skipped++; continue;
      }
      await db.ref(`businesses/${bid}/outlets/${oid}/billing`).set(DEFAULT_BILLING);
      console.log(`SEEDED ${bid}/${oid} — billing defaults + ${FREE_TOKENS} free promo tokens`);
      seeded++;
    }
  }
  console.log(`Done. seeded=${seeded} skipped=${skipped}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
