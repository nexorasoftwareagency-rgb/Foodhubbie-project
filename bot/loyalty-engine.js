/**
 * Loyalty accrual / clawback engine (batch 23g).
 *
 * Extracted from `bot/index.js` so Cloud Functions can run the SAME bytes as
 * the WhatsApp bot — the established 23b/23f pattern: a socket-free factory
 * with injected deps, vendored into `lib/vendor/` by `scripts/copy-vendor.cjs`.
 *
 * Nothing here touches Baileys, Redis or `bot/index.js`. The only non-DB
 * dependency is the optional `onTierUp` callback: the bot passes its FCM
 * `notifyTierUp` (which itself stands down while the 23e push relay is on),
 * and the cloud passes nothing because `onLoyaltyTierUp` is an RTDB trigger on
 * `customers/{phone}/loyalty` and fires from the write itself.
 *
 * ── Earn (research R1) ──────────────────────────────────────────────
 * Fires when a sale is actually PAID:
 *   • Delivery / WhatsApp orders — order status reaches Delivered/Served.
 *   • Dine-in QR orders — `paymentStatus` flips to 'Paid' at table settlement:
 *     the bill-level discount only exists at that moment, and the order record
 *     carries no phone (PII lives in `tableSessionsContact`).
 * Earn base = subtotal − discount ONLY (tax, service charge and the delivery
 * fee never earn points); legacy orders without a subtotal fall back to
 * `order.total`.
 *
 * ── Clawback (R3) ───────────────────────────────────────────────────
 * Reverses an accrual when the order is cancelled/refunded or a settled bill is
 * voided (`paymentStatus` → 'Unpaid'). Deletes the accrual record (audit copy
 * under `loyalty/clawbacks`) so a voided-then-repaid bill earns again.
 *
 * Everything is idempotent per orderId via `loyalty/accruals` + the
 * `lastAccruedOrderId` transaction guard, so the bot and a Function can both
 * evaluate the same event without double counting. All parameters come from
 * `loyalty/config` (Admin settings).
 *
 * @param {object} deps
 * @param {object} deps.db                  firebase-admin database instance
 * @param {(p: string, o: string) => string} deps.resolvePath
 * @param {object|null} [deps.loyaltyMath]  shared/loyalty-math.js (pure)
 * @param {object|null} [deps.moneyMath]    shared/money-math.js (pure)
 * @param {object} deps.redeem              bot/redeem.js (pointsLapsed)
 * @param {(order: object) => boolean} deps.isDineInOrder
 * @param {(id: string) => string} [deps.formatOrderId]
 * @param {(outlet: string) => string} [deps.businessIdFor]
 * @param {string} [deps.defaultOutlet]
 * @param {(phone: string, newTier: string, oldTier: string, outlet: string, bid: string) => Promise<any>} [deps.onTierUp]
 */
function createLoyaltyEngine(deps) {
    const opts = deps || {};
    const {
        db, resolvePath, loyaltyMath, moneyMath, redeem, isDineInOrder, formatOrderId,
    } = opts;
    const defaultOutlet = opts.defaultOutlet;
    const businessIdFor = typeof opts.businessIdFor === 'function' ? opts.businessIdFor : () => '';
    const onTierUp = typeof opts.onTierUp === 'function' ? opts.onTierUp : null;
    const oidOf = (id) => (formatOrderId ? formatOrderId(id) : String(id));

    for (const [name, value] of Object.entries({ db, resolvePath, isDineInOrder })) {
        if (!value) throw new Error(`[Loyalty] createLoyaltyEngine: missing dep "${name}"`);
    }
    if (!redeem || typeof redeem.pointsLapsed !== 'function') {
        throw new Error('[Loyalty] createLoyaltyEngine: missing dep "redeem.pointsLapsed"');
    }

    // loyalty/config + defaults in one place — every loyalty path reads this.
    async function getLoyaltyConfig(outlet) {
        const snap = await db.ref(resolvePath('loyalty/config', outlet)).once('value').catch(() => null);
        const config = (snap && snap.val()) || {};
        return {
            ...config,
            earnRatePaisePerPoint: config.earnRatePaisePerPoint || 5000, // 1 point per ₹50 (~2% back at ₹1/pt)
            expiryDays: Number(config.expiryDays) > 0 ? Number(config.expiryDays) : 0, // 0 = never (older configs)
            tiers: config.tiers || {
                bronze: { min: 0, multiplier: 1 },
                silver: { min: 1000, multiplier: 1.25 },
                gold: { min: 5000, multiplier: 1.5 }
            }
        };
    }

    // Same 10-digit rule `customerAppPhone` applies in bot/index.js. Kept local
    // so the vendored engine has no dependency on the WhatsApp index.
    function customerPhone(order) {
        const digits = String((order && order.phone) || '').replace(/\D/g, '');
        const last10 = digits.slice(-10);
        return /^[6-9]\d{9}$/.test(last10) ? last10 : '';
    }

    // R1 earn base in rupees. Falls back to the pre-Phase-2 order.total base if
    // shared/loyalty-math.js failed to load on a partial deploy.
    function loyaltyEarnBase(order) {
        if (loyaltyMath) return loyaltyMath.computeEarnBase(order);
        const sub = Number(order.subtotal);
        const base = Number.isFinite(sub) ? sub - (Number(order.discount) || 0) : Number(order.total || 0);
        return Math.max(0, base);
    }

    function loyaltyTierFor(points, tiers) {
        if (loyaltyMath) return loyaltyMath.tierForPoints(points, tiers);
        let tier = 'bronze';
        for (const name of ['bronze', 'silver', 'gold']) {
            const t = tiers && tiers[name];
            if (t && points >= (t.min || 0)) tier = name;
        }
        return tier;
    }

    // Shared earn tail: idempotency check → tier multiplier → accrual record →
    // loyalty transaction → rankings mirror → customer order history. BOTH earn
    // paths (status-based, dine-in settlement) end here so there is exactly ONE
    // writer for the customer loyalty record. Returns points earned (0 = none).
    async function _writeLoyaltyAccrual({ orderId, order, phone, outlet, bid, earnBaseRs, statusLower }) {
        const config = await getLoyaltyConfig(outlet);
        if (config.earnEnabled === false) return 0;

        const accrualRef = db.ref(resolvePath(`loyalty/accruals/${String(orderId)}`, outlet));
        const existing = await accrualRef.once('value').catch(() => null);
        if (existing && existing.exists()) return 0;

        // Read current loyalty to apply the tier multiplier. Canonical path is
        // customers/{phone}/loyalty — what the customer app reads and what the
        // rules validate.
        const loyaltyRef = db.ref(resolvePath(`customers/${phone}/loyalty`, outlet));
        const loyaltySnap = await loyaltyRef.once('value').catch(() => null);
        const current = (loyaltySnap && loyaltySnap.val()) || {};
        const currentTier = current.tier || 'bronze';
        const multiplier = (config.tiers[currentTier] && config.tiers[currentTier].multiplier) || 1;

        const pointsEarned = loyaltyMath
            ? loyaltyMath.computeEarnPoints(earnBaseRs, config.earnRatePaisePerPoint, multiplier)
            : Math.floor(Math.floor((earnBaseRs * 100) / config.earnRatePaisePerPoint) * multiplier);
        if (pointsEarned <= 0) return 0;

        const total = Number(order.total || 0);
        const now = Date.now();
        const newLifetimePoints = (current.lifetimePoints || 0) + pointsEarned;
        const newTotalSpent = (current.totalSpent || 0) + total;
        const newTier = loyaltyTierFor(newLifetimePoints, config.tiers);

        // Mark accrual (idempotency lock) BEFORE the balance tx so a crash
        // between the two can never double-count; the tx guard below also
        // refuses a replayed orderId.
        await accrualRef.set({
            orderId: String(orderId),
            phone,
            outlet,
            business: bid,
            pointsEarned,
            earnBase: earnBaseRs,
            total,
            status: statusLower,
            createdAt: now
        });

        await loyaltyRef.transaction((cur) => {
            const c = cur || {};
            if (c.lastAccruedOrderId === String(orderId)) return undefined;
            // Inactivity expiry: a lapsed balance is written off by marking it all
            // spent (tier stays on lifetime). Without carrying pointsSpent forward
            // this tx used to WIPE it, handing redeemed points back on every earn.
            const lapsed = redeem.pointsLapsed(c.lastOrderAt, config.expiryDays, now);
            const spent = lapsed ? (c.lifetimePoints || 0) : (c.pointsSpent || 0);
            const lifetime = (c.lifetimePoints || 0) + pointsEarned;
            return {
                pointsSpent: spent,
                phone,
                outlet,
                business: bid,
                // points = spendable balance (what the customer app displays).
                // The tx REPLACES the whole node — omitting this field wiped the
                // customer's balance on every earn (found in live E2E).
                points: Math.max(0, lifetime - spent),
                lifetimePoints: lifetime,
                totalSpent: (c.totalSpent || 0) + total,
                orderCount: (c.orderCount || 0) + 1,
                tier: newTier,
                tierReachedAt: newTier !== (c.tier || 'bronze') ? now : (c.tierReachedAt || null),
                lastOrderAt: now,
                lastAccruedOrderId: String(orderId),
                lastClawedOrderId: null,
                updatedAt: now
            };
        });

        // Mirror for the outlet leaderboard. Rank is computed here (server-side)
        // because customers may only read their own entry — the client cannot
        // count the whole leaderboard.
        const rankSnap = await db.ref(resolvePath('loyalty/rankings', outlet)).get().catch(() => null);
        const rankPool = Object.values((rankSnap && rankSnap.val()) || {});
        const rank = rankPool.filter(r => Number(r && r.lifetimePoints) > newLifetimePoints).length + 1;
        await db.ref(resolvePath(`loyalty/rankings/${phone}`, outlet)).set({
            phone,
            outlet,
            business: bid,
            lifetimePoints: newLifetimePoints,
            totalSpent: newTotalSpent,
            tier: newTier,
            rank,
            updatedAt: now
        });

        // Order record with points earned (customer reads this for history).
        // MERGE (update), not replace: a set() here used to wipe the placement-time
        // fields (createdAt, itemsSummary, table, paymentStatus) from the customer's
        // order history. Payment fields come from the order itself.
        await db.ref(resolvePath(`customers/${phone}/orders/${String(orderId)}`, outlet)).update({
            orderId: String(orderId),
            outlet,
            business: bid,
            customerPhone: phone,
            customerName: order.customerName || '',
            status: statusLower,
            total,
            placedAt: order.createdAt || now,
            deliveredAt: now,
            pointsEarned,
            source: order.source || 'QR',
            itemCount: order.itemCount || Object.keys(order.items || {}).length,
            ...(order.paymentStatus ? { paymentStatus: String(order.paymentStatus) } : {}),
            ...(order.paymentMethod ? { paymentMethod: String(order.paymentMethod) } : {})
        });

        // Tier-up news through the in-app channel (silver/gold only — a bronze
        // regression pushes nothing). Fire-and-forget: must never delay the accrual.
        if (newTier !== currentTier && phone && onTierUp) {
            const p = onTierUp(phone, newTier, currentTier, outlet, bid);
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }

        return pointsEarned;
    }

    async function accrueLoyaltyPoints(orderId, order, status) {
        try {
            if (!order) return;
            const statusLower = String(status || order.status || '').toLowerCase();
            if (statusLower !== 'delivered' && statusLower !== 'served') return;
            // Dine-in earns at table settlement instead (see accrueDineInPaidOrder).
            if (isDineInOrder(order)) return;

            const phone = customerPhone(order);
            if (!phone) return;

            const outlet = order.outlet || defaultOutlet;
            const bid = businessIdFor(outlet);
            const earnBase = loyaltyEarnBase(order);
            if (earnBase <= 0) return;

            const pointsEarned = await _writeLoyaltyAccrual({ orderId, order, phone, outlet, bid, earnBaseRs: earnBase, statusLower });
            if (pointsEarned > 0) console.log(`[LOYALTY] Order #${oidOf(orderId)}: +${pointsEarned} pts for ${phone} (base ₹${earnBase})`);
        } catch (e) {
            console.error('[LOYALTY] accrueLoyaltyPoints error:', e.message);
        }
    }

    // Phone for a dine-in order: the order record intentionally carries no phone
    // (PII decision) — resolve it from tableSessionsContact instead.
    async function dineInPhoneFor(order, outlet) {
        const direct = customerPhone(order);
        if (direct) return direct;
        const sid = order.sessionId || order.tableSessionId;
        if (!sid) return '';
        const snap = await db.ref(resolvePath(`tableSessionsContact/${String(sid)}`, outlet)).once('value').catch(() => null);
        const contact = (snap && snap.val()) || {};
        const digits = String(contact.customerPhone || contact.guestPhone || '').replace(/\D/g, '');
        const last10 = digits.slice(-10);
        return /^[6-9]\d{9}$/.test(last10) ? last10 : '';
    }

    // R1 base for a dine-in order at settlement: the order's own subtotal −
    // discount, minus this order's proportional share of the BILL-level discount
    // (applied at settlement on the session or group record — largest-remainder
    // split across the covered orders so shares sum to the bill discount exactly).
    async function dineInEarnBaseRs(orderId, order, outlet) {
        const ownBase = loyaltyEarnBase(order);
        const sessId = order.sessionId || order.tableSessionId;
        if (!sessId || !loyaltyMath) return ownBase;
        try {
            const sessSnap = await db.ref(resolvePath(`tableSessions/${String(sessId)}`, outlet)).once('value').catch(() => null);
            const sess = (sessSnap && sessSnap.val()) || {};
            let billDiscount = Number(sess.discount) || 0;
            let coveredIds = Array.isArray(sess.orders) ? sess.orders.filter(Boolean) : [];
            for (const g of Object.values(sess.orderGroups || {})) {
                if (g && Array.isArray(g.orders) && g.orders.includes(String(orderId))) {
                    billDiscount = Number(g.discount) || 0;
                    coveredIds = g.orders.filter(Boolean);
                    break;
                }
            }
            if (!(billDiscount > 0) || coveredIds.length === 0) return ownBase;
            const sibs = await Promise.all(coveredIds.map(id =>
                db.ref(resolvePath(`orders/${id}`, outlet)).once('value').catch(() => null)));
            const bases = sibs.map(s => {
                const o = (s && s.val()) || {};
                return String(o.status) === 'Cancelled' ? 0 : loyaltyEarnBase(o);
            });
            const shares = loyaltyMath.distributeBillDiscountPaise(billDiscount, bases);
            const idx = coveredIds.indexOf(String(orderId));
            const sharePaise = idx >= 0 ? (shares[idx] || 0) : 0;
            const net = ownBase - sharePaise / 100;
            return Math.max(0, moneyMath ? moneyMath.round2(net) : net);
        } catch (e) {
            console.warn('[LOYALTY] dine-in base computation failed, using order base only:', e.message);
            return ownBase;
        }
    }

    // Dine-in earn: fires when the order's paymentStatus flips to 'Paid' (table
    // settlement / group settlement). Gated by loyalty/config.dineInEarnEnabled.
    async function accrueDineInPaidOrder(orderId, order) {
        try {
            if (!order) return;
            if (order.paymentStatus !== 'Paid') return;
            if (!isDineInOrder(order)) return;
            const outlet = order.outlet || defaultOutlet;
            const bid = businessIdFor(outlet);
            const config = await getLoyaltyConfig(outlet);
            if (config.earnEnabled === false || config.dineInEarnEnabled === false) return;
            const phone = await dineInPhoneFor(order, outlet);
            if (!phone) return; // anonymous table guest — nothing to attach points to
            const earnBase = await dineInEarnBaseRs(orderId, order, outlet);
            if (earnBase <= 0) return;
            const statusLower = String(order.status || '').toLowerCase();
            const pointsEarned = await _writeLoyaltyAccrual({ orderId, order, phone, outlet, bid, earnBaseRs: earnBase, statusLower });
            if (pointsEarned > 0) console.log(`[LOYALTY] Dine-in #${oidOf(orderId)}: +${pointsEarned} pts for ${phone} (base ₹${earnBase})`);
        } catch (e) {
            console.error('[LOYALTY] accrueDineInPaidOrder error:', e.message);
        }
    }

    // R2 fairness: a burned reward code on this order goes back to active so a
    // cancellation/void doesn't eat the customer's reward. The usedOnOrder guard
    // means we only resurrect OUR burn - never a code spent again elsewhere.
    // Idempotent, so it is safe to call from more than one place (the 23f cloud
    // cancel trigger runs its own copy).
    async function resurrectRewardTender(orderId, order, outlet) {
        try {
            const tender = order && order.loyaltyTender;
            const tenderPhone = order && order.phone ? String(order.phone).replace(/\D/g, '').slice(-10) : '';
            if (!tender || !tender.rewardKey || !/^[6-9]\d{9}$/.test(tenderPhone)) return;
            // Cold-tx seed (redeem.js pattern) - null-first attempt otherwise
            // aborts the resurrect silently.
            const resRef = db.ref(resolvePath(`customers/${tenderPhone}/rewards/${String(tender.rewardKey)}`, outlet));
            const resSeed = (await resRef.once('value').catch(() => null) || {}).val();
            await resRef.transaction((cur) => {
                const node = cur || resSeed;
                if (!node || node.usedOnOrder !== String(orderId)) return undefined;
                return { ...node, status: 'active', usedAt: null, usedOnOrder: null };
            }).catch(() => {});
        } catch (e) { console.error('[LOYALTY] resurrectRewardTender error:', e.message); }
    }

    // R3 clawback: reverse an accrual when the sale falls through — the order is
    // cancelled/refunded, or a settled table bill is voided (paymentStatus flips
    // back to 'Unpaid' once voidTableBill's revert transaction runs). Deletes the
    // accrual record (audit copy under loyalty/clawbacks) and clears
    // lastAccruedOrderId so a voided-then-repaid bill earns again. Gated by
    // loyalty/config.clawbackEnabled.
    async function clawLoyaltyPoints(orderId, order, status) {
        try {
            if (!order) return;
            const statusLower = String(status || order.status || '').toLowerCase();
            const isCancel = statusLower === 'cancelled' || statusLower === 'refunded';
            const isVoidedDineIn = isDineInOrder(order) && order.paymentStatus === 'Unpaid';
            if (!isCancel && !isVoidedDineIn) return;
            const outlet = order.outlet || defaultOutlet;
            const bid = businessIdFor(outlet);
            const now = Date.now();
            // A cancelled order that never earned points (cancelled before delivery,
            // e.g. the customer cancelled in the app) must still give the reward back.
            if (isCancel) await resurrectRewardTender(orderId, order, outlet);
            // Accrual lookup AFTER the reward release — unpaid dine-in orders hit
            // this path on every routine update, and most have nothing to reverse
            // (one cheap read).
            const accrualRef = db.ref(resolvePath(`loyalty/accruals/${String(orderId)}`, outlet));
            const snap = await accrualRef.once('value').catch(() => null);
            const rec = snap && snap.val();
            if (!rec) return; // never accrued — nothing to reverse
            const config = await getLoyaltyConfig(outlet);
            if (config.clawbackEnabled === false) return;
            const phone = String(rec.phone || '');
            if (!/^[6-9]\d{9}$/.test(phone)) return;
            const reason = isCancel ? statusLower : 'bill-void';
            // Audit copy first, then remove the idempotency lock, then reverse.
            await db.ref(resolvePath(`loyalty/clawbacks/${String(orderId)}`, outlet)).set({
                ...rec,
                clawedAt: now,
                clawedFromStatus: rec.status || '',
                reason
            });
            await accrualRef.remove();
            await resurrectRewardTender(orderId, order, outlet);
            const loyaltyRef = db.ref(resolvePath(`customers/${phone}/loyalty`, outlet));
            const loyaltySnap = await loyaltyRef.once('value').catch(() => null);
            const current = (loyaltySnap && loyaltySnap.val()) || {};
            const newLifetime = Math.max(0, (current.lifetimePoints || 0) - (rec.pointsEarned || 0));
            const newTier = loyaltyTierFor(newLifetime, config.tiers);
            await loyaltyRef.transaction((cur) => {
                const c = cur || {};
                // Double-claw guard: a second event for the same clawback aborts
                // here (the accrual record it validated is already gone).
                if (c.lastClawedOrderId === String(orderId)) return undefined;
                return {
                    ...c,
                    // Reverse the earned spendable balance too — the accrual added
                    // pointsEarned to `points`, so the claw must subtract it.
                    points: Math.max(0, (c.points || 0) - (rec.pointsEarned || 0)),
                    lifetimePoints: Math.max(0, (c.lifetimePoints || 0) - (rec.pointsEarned || 0)),
                    totalSpent: Math.max(0, (c.totalSpent || 0) - (Number(rec.total) || 0)),
                    orderCount: Math.max(0, (c.orderCount || 0) - 1),
                    tier: newTier,
                    lastAccruedOrderId: null,
                    lastClawedOrderId: String(orderId),
                    updatedAt: now
                };
            });
            // Rankings mirror (rank recomputed server-side — same as accrual).
            const rankSnap = await db.ref(resolvePath('loyalty/rankings', outlet)).get().catch(() => null);
            const rankPool = Object.values((rankSnap && rankSnap.val()) || {});
            const rank = rankPool.filter(r => Number(r && r.lifetimePoints) > newLifetime).length + 1;
            await db.ref(resolvePath(`loyalty/rankings/${phone}`, outlet)).update({
                lifetimePoints: newLifetime,
                totalSpent: Math.max(0, ((current.totalSpent || 0) - (Number(rec.total) || 0))),
                tier: newTier,
                rank,
                updatedAt: now
            }).catch(() => {});
            // Customer order history reflects the reversal.
            await db.ref(resolvePath(`customers/${phone}/orders/${String(orderId)}`, outlet)).update({
                status: isCancel ? statusLower : 'cancelled',
                pointsEarned: 0,
                clawedBackAt: now
            }).catch(() => {});
            console.log(`[LOYALTY] Clawed back ${rec.pointsEarned || 0} pts from ${phone} for #${oidOf(orderId)} (${reason})`);
        } catch (e) {
            console.error('[LOYALTY] clawLoyaltyPoints error:', e.message);
        }
    }

    // Single loyalty entry point. Runs independent of WhatsApp plumbing (dine-in
    // orders carry no JID by design) and must be called BEFORE any status debounce
    // gate so a paymentStatus-only flip can never swallow an accrual or clawback.
    async function processLoyalty(orderId, order) {
        if (!order) return;
        const statusLower = String(order.status || '').toLowerCase();
        await clawLoyaltyPoints(orderId, order, statusLower);
        await accrueLoyaltyPoints(orderId, order, statusLower);
        await accrueDineInPaidOrder(orderId, order);
    }

    return {
        getLoyaltyConfig,
        loyaltyEarnBase,
        loyaltyTierFor,
        accrueLoyaltyPoints,
        accrueDineInPaidOrder,
        clawLoyaltyPoints,
        dineInPhoneFor,
        resurrectRewardTender,
        processLoyalty,
        isDineIn: isDineInOrder,
    };
}

module.exports = { createLoyaltyEngine };
