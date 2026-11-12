/**
 * Web/app order finalizer — SOCKET-FREE (batch 23b).
 *
 * `menu/js/delivery.js` / `menu/js/app-checkout.js` write orders straight to
 * Firebase from the customer's browser, so every money field is a claim. This
 * module is the server's answer: re-price the lines from the catalog, re-derive
 * tax + delivery fee from the outlet's settings, re-run the discount, burn a
 * claimed loyalty code, deduct stock, mirror the customer profile and record
 * discount usage.
 *
 * It was extracted verbatim out of `bot/index.js` so the SAME pipeline can run
 * as an RTDB trigger in Cloud Functions (batch 23c). Nothing here may import
 * Baileys, Redis, `bot/firebase` or `bot/index.js`: the database access and the
 * two socket calls (`notify`, the low-stock WhatsApp alert) arrive through the
 * injected deps/`sock`, and both are optional — a dead socket must never
 * swallow a tender or stock. That injection is what lets the Functions bundle
 * supply its own `db/getData/updateData/resolvePath/getLoyaltyConfig`.
 */

const { formatJid, isDineInOrder } = require('./utils');

// Pure order-totals math shared with the menu checkout and Admin POS.
// require(esm) needs Node >= 22.12; a partial deploy missing shared/ falls back
// to the legacy verify formulas (never a WRONG total) and warns in pm2/Functions log.
let moneyMath = null;
try { moneyMath = require('../shared/money-math.js'); }
catch (e) {
    console.warn('[MoneyMath] shared/money-math.js failed to load — order re-verification falls back to legacy totals.'
        + ' Ensure the deploy includes the repo shared/ folder and Node >= 22.12. Detail:', e && e.message);
}

let geo = null;
try { geo = require('../shared/geo/geo.js'); }
catch (e) {
    console.warn('[Geo] shared/geo/geo.js failed to load — a web order keeps its claimed delivery fee.'
        + ' Detail:', e && e.message);
}

let loyaltyMath = null;
try { loyaltyMath = require('../shared/loyalty-math.js'); }
catch (e) {
    console.warn('[LoyaltyMath] shared/loyalty-math.js failed to load — tender validation is skipped (customer pays full total).'
        + ' Detail:', e && e.message);
}

// Dine-in classification lives in bot/utils.js (shared with the bot's loyalty
// paths) — imported above so stock restore and loyalty cannot drift apart.

/**
 * Build the finalizer for one process/outlet.
 *
 * @param {object} deps
 * @param {object} deps.db                firebase-admin database instance
 * @param {(p: string, o: string) => Promise<any>} deps.getData
 * @param {(p: string, v: any, o: string) => Promise<any>} deps.updateData
 * @param {(p: string, o: string) => string} deps.resolvePath
 * @param {(jid: string, profile: object) => Promise<any>} deps.saveUserProfile
 * @param {(outlet: string) => Promise<object>} deps.getLoyaltyConfig
 * @param {object} deps.discountEngine  bot/discount-engine.js
 * @param {object} deps.orderPricing    bot/order-pricing.js
 * @param {(sock: any, orderId: string, order: object, type?: string) => Promise<any>} [deps.notify]
 *        WhatsApp new-order alert. Optional: the Functions trigger passes none.
 * @param {string} [deps.defaultOutlet] used only when an order carries no outlet
 */
function createOrderFinalizer(deps) {
    const opts = deps || {};
    const {
        db, getData, updateData, resolvePath, saveUserProfile,
        getLoyaltyConfig, discountEngine, orderPricing,
    } = opts;
    for (const [name, value] of Object.entries({
        db, getData, updateData, resolvePath, saveUserProfile,
        getLoyaltyConfig, discountEngine, orderPricing,
    })) {
        if (!value) throw new Error(`order-finalizer: missing required dep "${name}"`);
    }
    const notify = typeof opts.notify === 'function' ? opts.notify : null;
    const defaultOutlet = opts.defaultOutlet || 'outlet';

    // Tax rates and the delivery fee are the RESTAURANT's numbers, not the
    // phone's. Orders from the app / delivery webview are written by the
    // customer's browser, so without this a tampered payload could zero the GST
    // on a valid order or have a 40 km delivery pay the ₹20 slab. Both are
    // re-derived from the outlet's own settings before the total is verified.
    // Both return the claimed value when the settings cannot be read, so the
    // caller keeps the order's stored numbers instead of inventing one.
    async function serverTaxRates(outlet) {
        const dine = await getData('dineinSettings', outlet);
        if (!dine || typeof dine !== 'object') return null;
        // Same derivation the menu uses (app.js / delivery-order.js /
        // app-checkout.js): explicit taxRates win, then taxName+taxPercent (5%
        // GST default), and taxEnabled:false means no tax at all.
        if (Array.isArray(dine.taxRates) && dine.taxRates.length > 0) {
            return dine.taxRates.map(r => ({ name: (r && r.name) || 'Tax', rate: Number(r && r.rate) || 0 }));
        }
        if (dine.taxEnabled === false) return [];
        return [{ name: dine.taxName || 'GST', rate: typeof dine.taxPercent === 'number' ? dine.taxPercent : 5 }];
    }

    async function serverDeliveryFee(order, outlet) {
        const claimed = Math.max(0, Number(order.deliveryFee) || 0);
        if (order.type === 'Pickup' || order.orderMode === 'pickup') return 0;   // a pickup never pays a fee
        if (!geo) return claimed;                                                // shared/geo missing on a partial deploy
        const lat = Number(order.lat), lng = Number(order.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return claimed;      // legacy order without coordinates
        try {
            const [store, slabs] = await Promise.all([
                getData('settings/Store', outlet),
                getData('settings/Delivery/slabs', outlet),
            ]);
            const oLat = parseFloat((store || {}).lat), oLng = parseFloat((store || {}).lng);
            if (!Array.isArray(slabs) || !Number.isFinite(oLat) || !Number.isFinite(oLng)) return claimed;
            const km = geo.calculateDistance(lat, lng, oLat, oLng);
            return Math.max(0, Number(geo.getFeeFromSlabs(km, slabs)) || 0);
        } catch (e) {
            console.warn('[WebOrder] Delivery fee re-check failed — claimed fee kept:', e.message);
            return claimed;
        }
    }

    // Server-side total re-verification for client-placed orders (QR dine-in +
    // webview/app delivery). Recomputes tax on the CORRECTED taxable value — the
    // client-claimed `tax` must never be reused once the discount has been
    // corrected, or an upward-corrected discount leaves tax stale and undercharges
    // (fixed 2026-10-26, Phase 1b). `taxRates` (from serverTaxRates) always wins
    // over the order's stored taxItems when we have it: the rates are the outlet's
    // settings, while taxItems came from the customer's browser. An empty
    // `taxRates` array is a real answer ("this outlet charges no tax") and must not
    // fall through to the client's claim.
    // Legacy fallback (order predates taxItems, settings unreadable, or
    // shared/money-math.js missing on a partial deploy): claimed tax + claimed SC +
    // fee − discount, matching the pre-Phase-1b formulas. Delivery orders never
    // carry service charge (owner decision: SC is dine-in-only) — callers pass 0.
    // Returns the verified tax breakdown as well as the total, so the corrected
    // order carries the server's numbers (Admin reports read order.tax).
    function verifiedOrderTotals({ subtotal, discount, taxItems, taxRates, claimedTax = 0, serviceCharge = 0, deliveryFee = 0 }) {
        const sub = Number(subtotal) || 0;
        const disc = Math.max(0, Number(discount) || 0);
        const sc = Number(serviceCharge) || 0;
        const fee = Math.max(0, Number(deliveryFee) || 0);
        if (moneyMath) {
            const taxable = moneyMath.round2(Math.max(0, sub - disc));
            const rates = Array.isArray(taxRates) ? taxRates : taxItems;
            const tax = Array.isArray(taxRates) && taxRates.length === 0
                ? 0
                : moneyMath.recomputeTaxOnTaxable(taxable, rates);
            if (tax != null) {
                const items = (Array.isArray(rates) ? rates : []).map(r => ({
                    name: (r && r.name) || 'Tax',
                    rate: Number(r && r.rate) || 0,
                    amount: moneyMath.round2(taxable * ((Number(r && r.rate) || 0) / 100)),
                }));
                return {
                    total: Math.max(0, moneyMath.round2(taxable + tax + sc + fee)),
                    tax,
                    taxItems: items,
                    taxName: items.map(i => i.name).join(' + '),
                };
            }
        }
        return {
            total: Math.max(0, Math.round((sub + (Number(claimedTax) || 0) + sc + fee - disc) * 100) / 100),
            tax: null,
            taxItems: null,
            taxName: null,
        };
    }

    // R2 reward tender (delivery webview only): the order claims a redeemed
    // loyalty code as partial payment. Codes are only trustworthy if the bot
    // itself validates and burns them — the menu app cannot write rewards
    // (rules deny it), so a forged or replayed claim fails here and the bill
    // stands at its verified total. Runs AFTER discount re-verification so the
    // tender is computed on the server-verified total; tender reduces the
    // amount PAYABLE (totalDue), never the taxable value, so tax is untouched.
    // A skipped/failed validation always errs toward FULL payment — never a
    // free discount the bot couldn't check.
    async function verifyRewardTender(orderId, order, outlet) {
        try {
            const claim = order && order.rewardCode;
            if (!claim || !claim.key || !claim.code) return null;
            if (!loyaltyMath) {
                console.warn(`[LoyaltyTender] ${orderId}: shared/loyalty-math.js unavailable — tender claim ignored, customer pays full total.`);
                return null;
            }
            const cleanPhone = order.phone ? String(order.phone).replace(/\D/g, '').slice(-10) : '';
            if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
                console.warn(`[LoyaltyTender] ${orderId}: no valid customer phone — tender claim ignored.`);
                return null;
            }
            const oid = outlet || order.outlet || defaultOutlet;
            const config = await getLoyaltyConfig(oid);
            const rewardRef = db.ref(resolvePath(`customers/${cleanPhone}/rewards/${String(claim.key)}`, oid));
            const rewardSnap = await rewardRef.once('value').catch(() => null);
            const reward = rewardSnap && rewardSnap.val();
            const claimCode = String(claim.code || '').trim().toUpperCase();
            if (!reward || reward.status !== 'active'
                || String(reward.code || '').toUpperCase() !== claimCode) {
                console.warn(`[LoyaltyTender] ${orderId}: reward claim invalid (missing/used/code mismatch) — ignored.`);
                return null;
            }
            const total = Number(order.total) || 0;
            // R10 cap base: the order's own pre-tax value (subtotal − discount,
            // legacy fallback total) — one bill can never be tendered for more
            // than maxRedeemPercentOfOrder% of itself.
            const capBaseRs = loyaltyMath.computeEarnBase(order);
            const tenderPaise = loyaltyMath.computeTenderPaise({
                points: Number(reward.cost) || 0,
                redeemValuePaisePerPoint: config.redeemValuePaisePerPoint,
                totalDuePaise: Math.round(total * 100),
                minSpendAfterRedemptionPaise: Math.round((Number(config.minSpendAfterRedemption) || 0) * 100),
                subtotalPaise: Math.round(capBaseRs * 100),
                maxRedeemPercentOfOrder: Number(config.maxRedeemPercentOfOrder) || 0
            });
            if (tenderPaise <= 0) {
                console.warn(`[LoyaltyTender] ${orderId}: tender computes to ₹0 (bill ₹${total} vs minSpend ₹${config.minSpendAfterRedemption || 0}) — code left active.`);
                return null;
            }
            // Burn the code FIRST (transaction — a replayed claim on a used code
            // aborts here, so a tender can never be honored twice). Cold-tx seed
            // (same as redeem.js): RTDB hands the first attempt null even when
            // the node exists, and returning undefined aborts — seed from the
            // validated read so only a genuinely inactive code aborts. A concurrent
            // burn between read and commit fails the CAS and retries with fresh
            // data, so the replay guard stays airtight.
            const now = Date.now();
            const burn = await rewardRef.transaction((cur) => {
                const node = cur || reward;
                if (!node || node.status !== 'active') return undefined;
                return { ...node, status: 'used', usedAt: now, usedOnOrder: String(orderId) };
            });
            if (!burn.committed) {
                console.warn(`[LoyaltyTender] ${orderId}: code already used — tender ignored.`);
                return null;
            }
            const tenderRs = loyaltyMath.round2(tenderPaise / 100);
            const totalDue = loyaltyMath.round2(Math.max(0, total - tenderRs));
            const tenderRecord = {
                rewardKey: String(claim.key),
                code: String(reward.code || claim.code),
                rewardId: reward.rewardId || '',
                label: reward.label || '',
                points: Number(reward.cost) || 0,
                amountPaise: tenderPaise,
                amount: tenderRs
            };
            await updateData(`orders/${orderId}`, { loyaltyTender: tenderRecord, totalDue }, oid);
            Object.assign(order, { loyaltyTender: tenderRecord, totalDue });
            console.log(`[LoyaltyTender] ${orderId}: -₹${tenderRs} tender (${tenderRecord.points} pts, ${tenderRecord.label}) → payable ₹${totalDue}`);
            return tenderRecord;
        } catch (e) {
            console.error('[LoyaltyTender] verifyRewardTender error:', e.message);
            return null;
        }
    }

    // Deducts the ordered quantities from `inventory`, matching catalog dishes by
    // name, and returns what was ACTUALLY taken per inventory id
    // ({ [invId]: qtyClampedByStock }) so a later cancel can give exactly that
    // back — a line for more than the shelf holds only ever took what existed.
    async function deductInventoryStock(sock, items, outlet = defaultOutlet) {
        const deducted = {};
        if (!items || !Array.isArray(items) || items.length === 0) return deducted;
        try {
            const inventoryRef = db.ref(resolvePath('inventory', outlet));
            const snapshot = await inventoryRef.once('value');
            const inventory = snapshot.val() || {};
            const deliverySettings = await getData("settings/Delivery", outlet) || {};
            const notifyPhone = deliverySettings.notifyPhone || deliverySettings.reportPhone;

            // Aggregate first. Two lines of the same dish used to each compute
            // `stock - qty` from the same snapshot, so the second overwrote the
            // first and only one line was ever deducted.
            const wanted = new Map();           // inventory id -> { data, qty }
            for (const item of items) {
                const itemName = String((item && (item.name || item.item)) || '').toLowerCase();
                const invEntry = Object.entries(inventory).find(([, data]) =>
                    data && String(data.name || '').toLowerCase() === itemName);
                if (!invEntry) continue;
                const [id, data] = invEntry;
                const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
                const cur = wanted.get(id);
                if (cur) cur.qty += qty;
                else wanted.set(id, { data, qty });
            }

            for (const [id, { data, qty }] of wanted) {
                const before = Number(data.stock) || 0;
                const newStock = Math.max(0, before - qty);
                const threshold = data.threshold || 0;

                await inventoryRef.child(id).update({
                    stock: newStock,
                    updatedAt: new Date().toISOString()
                });
                const taken = Math.max(0, before - newStock);
                if (taken > 0) deducted[id] = taken;

                if (newStock <= threshold && notifyPhone && sock) {
                    const alertMsg = `⚠️ *LOW STOCK ALERT* ⚠️\n━━━━━━━━━━━━━━━━━━━━\n` +
                        `📦 Item: *${data.name}*\n` +
                        `📉 Current Stock: *${newStock}*\n` +
                        `🚩 Threshold: *${threshold}*\n════════════════════════\n` +
                        `_Please refill stock from Admin Panel immediately!_`;

                    const jid = formatJid(notifyPhone);
                    if (jid) sock.sendMessage(jid, { text: alertMsg }).catch(() => {});
                }
            }
        } catch (e) {
            console.error("[INVENTORY] ❌ Stock Deduction Error:", e);
        }
        return deducted;
    }

    // A cancelled/refunded web/app order gives back exactly what its finalization
    // deducted (`inventoryDeducted`). Same at-most-once claim as the discount
    // release. Orders finalized before this shipped carry no map and are skipped —
    // guessing from item names could add stock that was never taken.
    async function restoreOrderInventory(orderId, order) {
        try {
            if (!order || order.stockDeducted !== true || order.stockRestored === true) return false;
            const statusLower = String(order.status || '').toLowerCase();
            if (statusLower !== 'cancelled' && statusLower !== 'refunded') return false;
            if (isDineInOrder(order)) return false;
            const deducted = order.inventoryDeducted;
            if (!deducted || typeof deducted !== 'object' || !Object.keys(deducted).length) return false;
            const outlet = order.outlet || defaultOutlet;
            const flagRef = db.ref(resolvePath(`orders/${orderId}/stockRestored`, outlet));
            const seed = ((await flagRef.once('value').catch(() => null)) || {}).val();
            const claim = await flagRef.transaction((cur) => ((cur || seed) ? undefined : true)).catch(() => null);
            if (!claim || !claim.committed) return false;

            const inventoryRef = db.ref(resolvePath('inventory', outlet));
            for (const [id, qty] of Object.entries(deducted)) {
                const n = Math.round(Number(qty) || 0);
                if (n <= 0) continue;
                const ref = inventoryRef.child(id);
                // Seed from a read: the first transaction ticket is null even for an
                // existing node, and returning a bare { stock } would wipe its name.
                const base = ((await ref.once('value').catch(() => null)) || {}).val();
                await ref.transaction((cur) => {
                    const node = cur || base;
                    if (!node) return undefined;          // item deleted since — nothing to restore into
                    return { ...node, stock: (Number(node.stock) || 0) + n, updatedAt: new Date().toISOString() };
                });
            }
            console.log(`[INVENTORY] Returned stock for cancelled order ${orderId}`);
            return true;
        } catch (e) { console.error('[INVENTORY] Stock restore error:', e.message); return false; }
    }

    /**
     * Server-side finalization of one browser-written order.
     *
     * MUST be idempotent-ish at the caller: every write below is either
     * overwrite-safe or claimed by a flag (`stockDeducted`,
     * `discountUsageRecorded`), because the bot's child_added catch-up can replay
     * it. Callers guard with `shouldFinalizeWebOrder(order)`.
     *
     * @returns {Promise<object>} a compact record of what the server decided, so
     *   a shadow run (batch 23c) can compare without diffing the whole order.
     */
    async function finalizeWebOrder({ orderId, order, sock = null }) {
        const outlet = (order && order.outlet) || defaultOutlet;
        const result = {
            orderId,
            outlet,
            ok: false,
            priceChanged: false,
            discount: null,
            total: null,
            tax: null,
            taxName: null,
            inventoryDeducted: null,
            tender: null,
            discountUsageRecorded: false,
        };
        try {
            // --- SAFEST-FIRST: server-side re-pricing ---
            // Every unit price above came from the customer's browser.
            // Rebuild each line from the outlet catalog BEFORE the
            // discount is verified against `order.subtotal`, so a
            // modified client cannot buy a ₹299 dish for ₹1. A line the
            // catalog cannot resolve keeps its claimed price and is
            // logged (inventing one would overcharge or give food away).
            try {
                const [catalogDishes, catalogCombos] = await Promise.all([
                    getData('dishes', outlet),
                    getData('combos', outlet),
                ]);
                const priced = orderPricing.repriceOrder({
                    items: order.items,
                    dishes: catalogDishes,
                    combos: catalogCombos,
                    subtotal: order.subtotal,
                });
                if (priced.unmatched.length) {
                    console.warn(`[WebOrder] ${orderId}: no catalog match for "${priced.unmatched.join('", "')}" — claimed price kept, order flagged for review.`);
                    // Flag it for the restaurant: Admin shows a "Check prices" chip
                    // and the new-order alert says so. The order still goes through
                    // (an item removed from the menu mid-order is legitimate), but
                    // it is never silently accepted.
                    const review = orderPricing.buildPriceReview(priced);
                    await updateData(`orders/${orderId}`, { priceReview: review }, outlet).catch(() => {});
                    order.priceReview = review;
                }
                if (priced.changed) {
                    console.warn(`[WebOrder] Price correction on ${orderId}: client subtotal ₹${order.subtotal} (${(order.items || []).length} lines), catalog ₹${priced.subtotal}.`);
                    await updateData(`orders/${orderId}`, { items: priced.items, subtotal: priced.subtotal }, outlet);
                    order.items = priced.items;
                    order.subtotal = priced.subtotal;
                    result.priceChanged = true;
                }
            } catch (priceErr) {
                // Keep the claimed prices rather than block the order —
                // this is the pre-existing behaviour, never worse.
                console.error('[WebOrder] Re-pricing failed:', priceErr);
            }

            // --- SAFEST-FIRST: settings-owned tax rates + delivery fee ---
            // The remaining money fields came from the browser too.
            // Re-derive them from the outlet's own settings before the
            // total is verified, so a tampered payload can neither zero
            // the GST nor ship a far delivery at the nearest slab.
            const resolvedTaxRates = await serverTaxRates(outlet);
            const resolvedDeliveryFee = await serverDeliveryFee(order, outlet);
            const moneyFields = (m) => ({
                deliveryFee: resolvedDeliveryFee,
                ...(m.taxItems ? { tax: m.tax, taxItems: m.taxItems, taxName: m.taxName } : {}),
            });

            // --- SAFEST-FIRST: server-side discount re-validation ---
            // This order was written directly by the customer's browser
            // (menu/js/delivery-order.js), which computed discount/total
            // client-side with nothing re-checking it server-side. Re-run
            // the SAME evaluation the bot already trusts for WhatsApp
            // orders, and overwrite whatever the client sent with the
            // server-computed truth before anything (admin notification,
            // stats, invoice) treats it as final.
            try {
                const cleanPhoneForDiscount = order.phone ? String(order.phone).replace(/\D/g, "").slice(-10) : null;
                const customerForDiscount = cleanPhoneForDiscount ? await getData(`customers/${cleanPhoneForDiscount}`, outlet) : null;
                const claimedCouponCode = (order.discountSource || '').startsWith('coupon:')
                    ? order.discountSource.slice('coupon:'.length)
                    : null;
                // channel: 'website' — matches the "QR / WhatsApp Webview only" option
                // in the discount editor; a discount scoped to 'whatsapp' or
                // 'pos' only will correctly NOT apply here even if the
                // client-side check let it through before this fix.
                const verified = await discountEngine.evaluateDiscount({
                    OUTLET: outlet,
                    customer: customerForDiscount,
                    subtotal: order.subtotal,
                    couponCode: claimedCouponCode,
                    cart: order.items,
                    channel: 'website'
                });
                const correctedDiscount = verified ? verified.amount : 0;
                const money = verifiedOrderTotals({
                    subtotal: order.subtotal,
                    discount: correctedDiscount,
                    taxItems: order.taxItems,
                    taxRates: resolvedTaxRates,
                    deliveryFee: resolvedDeliveryFee,
                });
                const correctedTotal = money.total;
                if (correctedDiscount !== (order.discount || 0) || correctedTotal !== (order.total || 0)) {
                    console.warn(`[WebOrder] Money mismatch on ${orderId}: client claimed ₹${order.discount || 0} discount / ₹${order.total || 0} total, server verified ₹${correctedDiscount} / ₹${correctedTotal}. Correcting.`);
                }
                const correction = verified ? {
                    discount: correctedDiscount,
                    discountId: verified.discount.id,
                    discountLabel: verified.label,
                    discountSource: verified.source,
                    discountMode: verified.discount.mode || 'fixed',
                    discountValue: verified.discount.value || 0,
                    discountGlobalLimit: verified.discount.globalLimit || 0,
                    total: correctedTotal,
                    ...moneyFields(money)
                } : {
                    discount: 0, discountId: null, discountLabel: null, discountSource: null,
                    discountMode: null, discountValue: 0, discountGlobalLimit: 0,
                    total: correctedTotal,
                    ...moneyFields(money)
                };
                await updateData(`orders/${orderId}`, correction, outlet);
                Object.assign(order, correction); // keep everything below consistent with the verified truth
            } catch (discErr) {
                console.error("[WebOrder] Discount re-validation failed:", discErr);
                // Fail safe: if verification itself breaks, don't honor an
                // unverified client-supplied discount — zero it out rather
                // than risk giving away money on a check we couldn't run.
                // Tax still comes from the outlet settings (resolvedTaxRates).
                const safe = verifiedOrderTotals({
                    subtotal: order.subtotal,
                    discount: 0,
                    taxItems: order.taxItems,
                    taxRates: resolvedTaxRates,
                    deliveryFee: resolvedDeliveryFee,
                });
                const correction = { discount: 0, discountId: null, discountLabel: null, discountSource: null, discountMode: null, discountValue: 0, discountGlobalLimit: 0, total: safe.total, ...moneyFields(safe) };
                await updateData(`orders/${orderId}`, correction, outlet).catch(() => {});
                Object.assign(order, correction);
            }
            result.discount = Number(order.discount) || 0;
            result.total = Number(order.total) || 0;
            result.tax = order.tax == null ? null : Number(order.tax);
            result.taxName = order.taxName || null;

            // R2: honor a claimed loyalty reward code as tender against
            // the VERIFIED total (burns the code server-side, writes
            // loyaltyTender + totalDue for the invoice/admin views).
            result.tender = await verifyRewardTender(orderId, order, outlet);

            // Keep exactly what was taken: a cancel returns only this
            // map, never a guess from the item names (a line for more
            // than the shelf held only ever took what existed).
            // `stockDeducted` stays the finalization marker either way
            // — clearing it would let the order be finalized twice.
            const inventoryDeducted = await deductInventoryStock(sock, order.items, outlet)
                .catch(e => { console.error("[WebOrder] Stock deduction failed:", e); return {}; });
            await updateData(`orders/${orderId}`, { stockDeducted: true, inventoryDeducted }, outlet);
            result.inventoryDeducted = inventoryDeducted;

            if (notify) notify(sock, orderId, order, "NEW").catch(() => {});

            if (order.phone) {
                const cleanPhone = String(order.phone).replace(/\D/g, "").slice(-10);
                const jid = formatJid(order.phone);
                saveUserProfile(jid, {
                    name: order.customerName || "",
                    phone: order.phone,
                    address: order.address || "",
                    location: (order.lat && order.lng) ? { lat: order.lat, lng: order.lng } : null,
                    lastOutlet: outlet
                }).catch(() => {});

                const mapsLink = (order.lat && order.lng) ? `https://maps.google.com/?q=${order.lat},${order.lng}` : "";
                // Cold-tx seed: admin-SDK RTDB transactions hand the FIRST ticket
                // `null` even for an existing node (proven live 2026-10-27). Without
                // a seed `base` is {} and a guest order (no customerName) returns
                // `name: undefined`, which RTDB rejects — aborting the whole
                // finalization after the tender and stock writes landed, so the
                // discount usage was never recorded. Read once and seed, exactly
                // like the reward burn below.
                const custRef = db.ref(resolvePath(`customers/${cleanPhone}`, outlet));
                const custSeed = ((await custRef.once('value').catch(() => null)) || {}).val();
                custRef.transaction((existing) => {
                    const base = existing || custSeed || {};
                    return {
                        ...base,
                        registeredAt: base.registeredAt || Date.now(),
                        name: order.customerName || base.name || null,
                        phone: cleanPhone,
                        address: order.address || base.address || "",
                        location: (order.lat && order.lng) ? { lat: order.lat, lng: order.lng } : (base.location || null),
                        mapsLink: mapsLink || base.mapsLink || "",
                        lastOrderDate: order.createdAt || new Date().toISOString(),
                        // App customers choose Offers on/off themselves (customers/{phone}/app.consent);
                        // never force it on for them. Web/WhatsApp keeps its existing behaviour.
                        promotionalConsent: order.source === 'APP' ? (base.app?.consent?.offers === true || base.promotionalConsent === true) : true,
                        orderCount: (base.orderCount || 0) + 1,
                        totalSpent: (base.totalSpent || 0) + (order.total || 0),
                        lastSeen: Date.now()
                    };
                }).catch(() => {});
            }

            if (order.discount > 0 && order.discountId) {
                const recorded = await discountEngine.recordDiscountUsage({
                    OUTLET: outlet,
                    discountId: order.discountId,
                    orderId,
                    customerPhone: order.phone,
                    amountGiven: order.discount,
                    channel: "webview",
                    globalLimit: order.discountGlobalLimit,
                    discountLabel: order.discountLabel,
                    discountSource: order.discountSource
                }).catch(() => false);
                // The flag is what lets a later cancel give the usage
                // back — only orders whose usage really landed.
                if (recorded) {
                    await updateData(`orders/${orderId}`, { discountUsageRecorded: true }, outlet).catch(() => {});
                    result.discountUsageRecorded = true;
                }
            }
            result.ok = true;
        } catch (webOrderErr) {
            console.error("[WebOrder] Finalization error:", webOrderErr);
        }
        return result;
    }

    return {
        finalizeWebOrder,
        restoreOrderInventory,
        deductInventoryStock,
        verifyRewardTender,
        serverTaxRates,
        serverDeliveryFee,
        verifiedOrderTotals,
    };
}

module.exports = { createOrderFinalizer };
