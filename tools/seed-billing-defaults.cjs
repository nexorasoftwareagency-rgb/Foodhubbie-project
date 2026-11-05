// seed-billing-defaults.cjs — idempotent billing defaults + 15 FREE promo tokens.
// Seeds the ROOT node walletBilling/{bid}/{oid} (money is server-owned; it must
// not live under businesses/{bid}, which the tenant can write).
// Re-run: outlets that already have a wallet are skipped (token balance untouched).
//
// DRY RUN by default — pass --apply to write. A mode change re-prices every historical
// order in the wallet (computeCostIndex runs over all orders), so an accidental run
// must never move real money.
const admin = require('../bot/node_modules/firebase-admin');
const serviceAccount = require('../bot/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});

const db = admin.database();
const now = Date.now();
const APPLY = process.argv.includes('--apply');

async function write(path, value, label) {
  if (APPLY) await db.ref(path).set(value);
  console.log(`${APPLY ? '' : '[dry] '}${label}`);
}

// Mirror of shared/cost-math.js + shared/billing-defaults.cjs.
// Pricing 2026-11-01: 'percentage' is the mode — WhatsApp-based 3% · Customer App 2%
// · POS + QR menu 1%. `rates` is only read by the legacy 'per_order' mode.
// Setup fee removed 2026-11-01 (wallet-minimum model): new rows get 0 / 'none'.
const FREE_TOKENS = 15;
const DEFAULT_BILLING = {
  mode: 'percentage',
  rates: { QR: 2, POS: 1, webview_delivery: 5, WA: 5, other: 2, promo: 1, commission1pct: 0.01 },
  setup: { amount: 0, status: 'none', date: new Date(now).toISOString() },
  tokens: { balance: FREE_TOKENS, updatedAt: now },
  tokenPacks: { welcome: { qty: FREE_TOKENS, priceRs: 0, note: 'Free welcome pack', grantedAt: now, grantedBy: 'system' } },
};

async function main() {
  const bizSnap = await db.ref('businesses').get();
  if (!bizSnap.exists()) { console.log('No businesses found.'); return; }
  let seeded = 0, skipped = 0;
  for (const [bid, biz] of Object.entries(bizSnap.val())) {
    for (const oid of Object.keys(biz.outlets || {})) {
      const base = `walletBilling/${bid}/${oid}`;
      const cur = await db.ref(base).get();
      if (cur.exists()) {
        const val = cur.val() || {};
        // Wizard-stale billing (pre-2026-09-29): a bug shipped the abandoned
        // monthly-plan model (monthlyRate, no rates/setup/tokens). Replace
        // wholesale — those rows carry no money state (tokens.granted/used absent).
        if (val.monthlyRate != null) {
          await write(base, DEFAULT_BILLING, `REPAIR ${bid}/${oid} — stale monthly-plan billing replaced with defaults`);
          seeded++; continue;
        }
        // Pricing change 2026-11-01: flat ₹/order is replaced by percentage pricing.
        // Every row still on a flat/legacy mode moves to 'percentage' (rates live in
        // shared/cost-math.js PERCENT_RATES — 1% POS/QR, 2% Customer App, 3% WhatsApp).
        if (val.mode !== 'percentage') {
          await write(`${base}/mode`, 'percentage', `PATCH ${bid}/${oid} mode ${val.mode || '(unset)'} → percentage`);
        }
        // Legacy flat rates: POS ₹1/order (was ₹2), promo ₹1/token (was ₹0.86),
        // WhatsApp + delivery-webview ₹5/order (was ₹3 — commit 40f7d9d, 2026-10-21).
        // Inert under 'percentage' mode but kept correct if a row ever flips back.
        for (const [key, want] of [['POS', 1], ['promo', 1], ['WA', 5], ['webview_delivery', 5]]) {
          const have = val.rates?.[key];
          if (have != null && have !== want) {
            await write(`${base}/rates/${key}`, want, `PATCH ${bid}/${oid} rates/${key} ${have} → ${want}`);
          }
        }
        // Setup policy: no fee since 2026-11-01. Existing setup records are left
        // untouched (paid/refunded history is money state; new rows already get
        // amount 0 / status 'none').
        console.log(`skip  ${bid}/${oid} (billing exists)`); skipped++; continue;
      }
      await write(base, DEFAULT_BILLING, `SEEDED ${bid}/${oid} — billing defaults + ${FREE_TOKENS} free promo tokens`);
      seeded++;
    }
  }
  console.log(`Done. seeded=${seeded} skipped=${skipped}${APPLY ? '' : ' (dry run — re-run with --apply to write)'}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
