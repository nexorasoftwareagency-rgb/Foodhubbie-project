'use strict';
/**
 * bot/meta-cost.js — the ONE socket-free Meta send-cost recorder + spend guard.
 *
 * Batch 23b/23f/23g pattern: the logic lives here with its dependencies injected,
 * so the WhatsApp bot and Cloud Functions run the same bytes. It requires only
 * `shared/meta-cost-math.js` (pure ESM) — no `./firebase`, no firebase-admin, no
 * Redis — which is what makes it vendorable.
 *
 * WHY THIS FILE EXISTS
 *   `bot/transport.js` used to hold both halves. Its `recordMetaCost` called
 *   `resolveBusinessIdFor(outlet)` from MODULE scope, where `outlet` is not
 *   defined: the whole body threw `ReferenceError` on the first line and was
 *   swallowed by its own catch, so no `metaUsage` row had ever been written by
 *   the bot. The guard half worked (it reads a balance the cloud publisher
 *   writes) — and the two shapes disagree about `billableMessages` /
 *   `dailyCostPaise` (objects on disk, numbers inside `canSend`), which made the
 *   daily and message-count caps dead. Both are fixed here, once.
 *
 * THE MONEY
 *   Meta India charges per delivered message after the first 1,000 free SERVICE
 *   messages per number per month. Rates come from `shared/meta-cost-math.js`
 *   (`DEFAULT_RATE_TABLE`, ₹0.115 utility/auth/service · ₹0.86 marketing), never
 *   a literal. A reply inside the 24 h customer-service window is technically a
 *   service message, but the recorder deliberately bills it at the utility rate:
 *   over-recording only blocks a tenant early, under-recording drains the shared
 *   Meta credit line that every number on the WABA draws from (error 131042).
 *
 * THE GUARD
 *   Arms ONLY when `walletBilling/{bid}/{oid}/balancePaise` is numeric — that
 *   node is written by the `metaCostPublisher` function. A missing snapshot means
 *   "not armed"; reading it as 0 would block every send on a fresh outlet.
 */

const { canSend, DEFAULT_RATE_TABLE } = require('../shared/meta-cost-math');

/**
 * Template names whose approved body lives on the WABA in MARKETING category, so
 * the send bills at the marketing rate when no caller supplies a category.
 * Add new marketing shells here once approved; existing callers need no change.
 */
const MARKETING_TEMPLATE_NAMES = new Set([
  'proactive_promo',
  'promo_hinglish_discount',
  'promo_hinglish_festive',
  'promo_hinglish_offer',
  'promo_hinglish_winback',
  // CTA-button shells submitted 2026-11-08 — same single-{{1}} body shape as the
  // Hinglish shells, plus a static URL button and an Unsubscribe quick reply.
  'promo_cta_flash',
  'promo_cta_cart',
  'promo_cta_winback',
  'promo_cta_birthday',
  'promo_cta_weekend',
  'promo_cta_newitem',
]);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** YYYY-MM / YYYY-MM-DD in IST — the keys the publisher and dashboards read. */
function istKeys(ms) {
  const iso = new Date(ms + IST_OFFSET_MS).toISOString();
  return { monthKey: iso.slice(0, 7), dayKey: iso.slice(0, 10) };
}

/** `canSend` expects numbers; both usage fields are written as objects. */
function usageView(usage, dayKey) {
  const u = usage || {};
  const byCat = u.billableMessages;
  const count = byCat && typeof byCat === 'object'
    ? Object.values(byCat).reduce((n, v) => n + (Number(v) || 0), 0)
    : Number(byCat) || 0;
  const byDay = u.dailyCostPaise;
  const daily = byDay && typeof byDay === 'object'
    ? Number(byDay[dayKey]) || 0
    : Number(byDay) || 0;
  return { ...u, totalCostPaise: Number(u.totalCostPaise) || 0, billableMessages: count, dailyCostPaise: daily };
}

/**
 * @param {Object}   o
 * @param {Object}   o.db          firebase-admin Database (`.ref(path)`)
 * @param {string}   o.bid         business id (`roshani-pizza`)
 * @param {string}   o.oid         outlet id (`pizza`)
 * @param {Function}[o.now]        () => ms
 * @param {Function}[o.log]        (...args) => void
 * @returns {{ record: Function, guard: Function, categoryForTemplate: Function }}
 */
function createMetaCost({ db, bid, oid, now = () => Date.now(), log = () => {} } = {}) {
  if (!db || typeof db.ref !== 'function') throw new Error('createMetaCost: db is required');
  if (!bid || !oid) throw new Error('createMetaCost: bid and oid are required');

  const base = `walletBilling/${bid}/${oid}`;

  /** Category a template send bills as. Explicit caller value always wins. */
  function categoryForTemplate(name, explicit) {
    if (explicit) return String(explicit).toLowerCase();
    return MARKETING_TEMPLATE_NAMES.has(String(name)) ? 'marketing' : 'utility';
  }

  /** Record one delivered send. Fire-and-forget: never throws, never blocks. */
  async function record(category = 'utility') {
    try {
      const t = now();
      const { monthKey, dayKey } = istKeys(t);
      const cat = String(category || 'utility').toLowerCase();
      const costPaise = Math.round(Number(
        DEFAULT_RATE_TABLE[cat] !== undefined ? DEFAULT_RATE_TABLE[cat] : DEFAULT_RATE_TABLE.utility,
      ) || 0);
      await db.ref(`${base}/metaUsage/${monthKey}`).transaction((curr) => {
        const c = curr || {};
        const byCat = c.billableMessages && typeof c.billableMessages === 'object' ? c.billableMessages : {};
        const byDay = c.dailyCostPaise && typeof c.dailyCostPaise === 'object' ? c.dailyCostPaise : {};
        byCat[cat] = (Number(byCat[cat]) || 0) + 1;
        byDay[dayKey] = (Number(byDay[dayKey]) || 0) + costPaise;
        return {
          billableMessages: byCat,
          totalCostPaise: (Number(c.totalCostPaise) || 0) + costPaise,
          dailyCostPaise: byDay,
          lastSentAt: new Date(t).toISOString(),
          updatedAt: new Date(t).toISOString(),
        };
      });
    } catch (e) {
      // Cost recording is informational — a DB hiccup must never fail a send.
      log('[META-COST] record failed:', e && e.message);
    }
  }

  /**
   * True when this send must be dropped. Fails OPEN on any error: a guard bug
   * must never silence a restaurant's WhatsApp.
   */
  async function guard(to, category = 'utility') {
    try {
      const billing = (await db.ref(base).once('value')).val() || {};
      const balancePaise = Number(billing.balancePaise);
      if (!Number.isFinite(balancePaise)) return false; // not armed snapshot
      const { dayKey } = istKeys(now());
      const messageCaps = billing.messageCaps || { monthlyPaise: 500000 }; // default ₹5,000/mo
      const thresholdPaise = Number(billing.metaSpendThresholdPaise) || 10000;
      const allowed = canSend({
        metaUsage: usageView(billing.metaUsage && billing.metaUsage[dayKey.slice(0, 7)], dayKey),
        messageCaps,
        metaSpendThresholdPaise: thresholdPaise,
        currentWalletBalancePaise: balancePaise,
        category,
      });
      if (allowed) return false;
      log(`[META-COST-GUARD] Blocked ${category} to ${String(to).slice(-4)} — balance ${balancePaise}p < ${thresholdPaise}p or cap hit`);
      // Admin visibility only; never exposed to the customer.
      await db.ref(`${base}/blocked`).push({
        to, category, walletBalancePaise: balancePaise, thresholdPaise, metaUsage: billing.metaUsage || null,
        at: new Date(now()).toISOString(),
      }).catch(() => {});
      return true;
    } catch (e) {
      log('[META-COST-GUARD] Error (fails open):', e && e.message);
      return false;
    }
  }

  return { record, guard, categoryForTemplate };
}

module.exports = { createMetaCost, MARKETING_TEMPLATE_NAMES, istKeys, usageView };

// ---------------------------------------------------------------------------
// Self-check: node bot/meta-cost.js
// ---------------------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');

  function fakeDb(seed = {}) {
    const data = new Map(Object.entries(seed));
    const snap = (v) => ({ exists: () => v !== undefined && v !== null, val: () => (v === undefined ? null : v) });
    // A flat Map has no hierarchy: a read of a parent must assemble its subtree,
    // exactly like RTDB, or the guard would never see balancePaise.
    const read = (p) => {
      if (data.has(p)) return data.get(p);
      const prefix = p + '/';
      const out = {};
      let found = false;
      for (const [k, v] of data) {
        if (!k.startsWith(prefix)) continue;
        found = true;
        const rel = k.slice(prefix.length).split('/');
        let cur = out;
        for (let i = 0; i < rel.length - 1; i++) cur = cur[rel[i]] = cur[rel[i]] || {};
        cur[rel[rel.length - 1]] = v;
      }
      return found ? out : undefined;
    };
    return {
      data,
      ref(p) {
        return {
          async once() { return snap(read(p)); },
          async set(v) { data.set(p, v); },
          async transaction(fn) {
            const next = fn(read(p));
            if (next === undefined) return { committed: false, snapshot: snap(read(p)) };
            data.set(p, next);
            return { committed: true, snapshot: snap(next) };
          },
          async push(v) { const k = `${p}/k${data.size}`; data.set(k, v); return { key: k }; },
        };
      },
    };
  }

  (async () => {
    const T = Date.UTC(2026, 10, 20, 6, 0, 0); // 2026-11-20 11:30 IST
    const db = fakeDb();

    // 1. No balance snapshot → not armed → every send allowed.
    assert.strictEqual(await createMetaCost({ db, bid: 'b', oid: 'o', now: () => T }).guard('9199', 'utility'), false);

    // 2. A recorded send writes the IST month + day buckets and the rate-table cost.
    const cost = createMetaCost({ db, bid: 'b', oid: 'o', now: () => T });
    await cost.record('utility');
    await cost.record('marketing');
    const usage = db.data.get('walletBilling/b/o/metaUsage/2026-11');
    assert.strictEqual(usage.billableMessages.utility, 1);
    assert.strictEqual(usage.billableMessages.marketing, 1);
    assert.strictEqual(usage.totalCostPaise, 115 + 86, 'rates must come from shared/meta-cost-math');
    assert.strictEqual(usage.dailyCostPaise['2026-11-20'], 201);

    // 3. Armed + healthy → allowed; armed + below the ₹100 threshold → blocked + logged.
    db.data.set('walletBilling/b/o/balancePaise', 50000);
    assert.strictEqual(await cost.guard('9199', 'utility'), false);
    db.data.set('walletBilling/b/o/balancePaise', 500);
    assert.strictEqual(await cost.guard('9199', 'utility'), true);
    assert.ok([...db.data.keys()].some((k) => k.startsWith('walletBilling/b/o/blocked/')), 'block logged');

    // 4. The daily cap now binds (it never did: dailyCostPaise is an object on disk).
    db.data.set('walletBilling/b/o/balancePaise', 50000);
    db.data.set('walletBilling/b/o/messageCaps', { dailyPaise: 100 });
    assert.strictEqual(await cost.guard('9199', 'utility'), true, 'daily cap must be enforced');
    db.data.set('walletBilling/b/o/messageCaps', { maxMessages: 2 });
    assert.strictEqual(await cost.guard('9199', 'utility'), true, 'message-count cap must be enforced');
    db.data.delete('walletBilling/b/o/messageCaps');
    assert.strictEqual(await cost.guard('9199', 'utility'), false);

    // 5. Marketing templates classify by name; an explicit category always wins.
    assert.strictEqual(cost.categoryForTemplate('promo_cta_flash'), 'marketing');
    assert.strictEqual(cost.categoryForTemplate('order_update'), 'utility');
    assert.strictEqual(cost.categoryForTemplate('anything', 'MARKETING'), 'marketing');

    // 6. Fails open: a DB error while guarding must not silence the outlet.
    const broken = { ref() { throw new Error('boom'); } };
    assert.strictEqual(await createMetaCost({ db: broken, bid: 'b', oid: 'o' }).guard('9199'), false);

    console.log('meta-cost self-check: 6/6 OK');
  })().catch((e) => { console.error('meta-cost self-check FAILED:', (e && e.stack) || e); process.exit(1); });
}
