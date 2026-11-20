// ============================================================================
// CUSTOMER NOTIFICATION CHECKLIST — PURE ELIGIBILITY + DRAFT ENGINE
//
// The Customers tab lets a restaurant pick guests and send them ONE message,
// either as a Customer APP push or as a WhatsApp promotional message.
//
// This module is the HONESTY LAYER. It answers, for every selected guest,
// "can this channel actually reach them, and if not, why" — using the SAME
// rules the server and the bot enforce:
//
//   Customer APP push -> FIREBASE_SERVER_MIGRATION/functions/src/api/tenantNotify.ts
//                        (offers consent on the subscription, quiet hours
//                         21:00-09:00 IST, per-phone daily caps of 3)
//   WhatsApp promo   -> bot/promotions.js (hasPromoConsent, STOP opt-out,
//                        promo toggle, kill switch, meta-transport gate,
//                        prepaid promo tokens)
//
// It is PURE (no Firebase, no DOM, no clock of its own - `now` is injected) so
// node can exercise it straight from the source tree.
//
// The counters here are an UPPER BOUND: the server suppresses anyone who
// already had 3 marketing pushes today, and Meta caps marketing templates per
// user behind our back. The UI must say "up to N", never "N".
// ============================================================================

/** Why a guest cannot be reached on a channel. `short` is the chip label. */
export const BLOCK_REASONS = {
    'no-device': { label: 'No app device on file', short: 'no device' },
    'offers-off': { label: 'Offers switched off', short: 'offers off' },
    'no-consent': { label: 'No marketing consent', short: 'no consent' },
    'opted-out': { label: 'They sent STOP', short: 'opted out' },
    'promo-off': { label: 'Promotional sending is switched off', short: 'sending off' },
    'kill-switch': { label: 'The promo kill switch is on', short: 'kill switch' },
    'transport': { label: 'WhatsApp is not on the official API yet', short: 'not connected' },
    'no-tokens': { label: 'No prepaid promo tokens left', short: 'no tokens' },
    'too-many': { label: 'Over the campaign recipient cap', short: 'over the cap' },
};

/** The WhatsApp recipient cap - the same number the Promotions tab uses. */
export const MAX_WA_RECIPIENTS = 300;

/**
 * OUTLET-level gates for the WhatsApp channel. These block EVERY guest, so
 * they are reported once, not per row.
 *
 * A value we could not read (undefined) never gates: the bot re-checks all of
 * them before it sends, and a failed read must not make the UI promise a
 * blocked channel (or hide a working one).
 */
export function outletGates(ctx = {}) {
    const gates = [];
    if (ctx.promoEnabled === false) gates.push('promo-off');
    if (ctx.killSwitch === true) gates.push('kill-switch');
    if (ctx.transport !== undefined && String(ctx.transport || '') !== 'meta') gates.push('transport');
    // A balance we could not read (undefined) is not a zero balance.
    if (ctx.tokenBalance !== undefined && ctx.tokenBalance !== null && !(Number(ctx.tokenBalance) > 0)) {
        gates.push('no-tokens');
    }
    return gates;
}

/**
 * PER-GUEST gates.
 *
 * WhatsApp: the customer's own "Offers" switch wins both ways and STOP is
 * absolute - exactly what bot/promotions.js hasPromoConsent + isOptedOut do.
 * The row already carries that verdict in `consent` (consentState).
 *
 * Push: the server pushes to `entries.map(e => e.token).filter(Boolean)`, so a
 * subscription record without a device token is a subscriber the phone cannot
 * receive. The server also filters by `prefs.offers` for non-order types.
 */
export function guestGates(row, ctx = {}) {
    const consent = (row && row.consent) || {};
    const wa = [];
    if (consent.source === 'STOP') wa.push('opted-out');
    else if (consent.state === 'opted-out') wa.push('offers-off');
    else if (consent.state !== 'opted-in') wa.push('no-consent');

    const subs = ctx.subscriptions || {};
    const sub = subs[(row && row.phone) || ''] || null;
    const push = [];
    if (!sub || !sub.hasToken) push.push('no-device');
    else if (sub.offers === false) push.push('offers-off');

    return { push, wa };
}

/**
 * Evaluate the whole selected batch.
 *
 * @param rows  the selected customer rows (from customers-view.js)
 * @param ctx   { subscriptions, quiet, promoEnabled, killSwitch, transport,
 *                tokenBalance, storeName, maxWaRecipients }
 */
export function evaluateBatch(rows, ctx = {}) {
    const list = rows || [];
    const per = {};
    const pushBlocked = {};
    const waBlocked = {};
    let pushReach = 0;
    let waReach = 0;

    for (const r of list) {
        const g = guestGates(r, ctx);
        per[r.phone] = g;
        if (g.push.length) {
            for (const b of g.push) pushBlocked[b] = (pushBlocked[b] || 0) + 1;
        } else pushReach++;
        if (g.wa.length) {
            for (const b of g.wa) waBlocked[b] = (waBlocked[b] || 0) + 1;
        } else waReach++;
    }

    const cap = Number(ctx.maxWaRecipients) > 0 ? Number(ctx.maxWaRecipients) : MAX_WA_RECIPIENTS;
    const gates = outletGates(ctx);

    return {
        total: list.length,
        push: {
            reachable: pushReach,
            blocked: pushBlocked,
            blockedTotal: list.length - pushReach,
            // Quiet hours suppress EVERY promo recipient server-side, so this is
            // a channel-wide block, not a per-guest one.
            quiet: !!ctx.quiet,
        },
        wa: {
            reachable: waReach,
            blocked: waBlocked,
            blockedTotal: list.length - waReach,
            cap,
            capped: waReach > cap,
            gates,
        },
        per,
    };
}

/** Flatten a { reasonId: count } map into a sorted, readable list. */
export function blockedSummary(blocked = {}) {
    return Object.entries(blocked)
        .map(([id, count]) => ({
            id,
            count,
            label: (BLOCK_REASONS[id] || {}).label || id,
            short: (BLOCK_REASONS[id] || {}).short || id,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ------------------------------------------------------------------- draft

/** The intent behind a guest, used to pick a message pattern. */
export function intentOf(r) {
    if (!r) return 'regular';
    if (r.rfm && r.rfm.lapsed === true) return 'lapsed';
    const seg = String((r.rfm && r.rfm.segment) || '');
    if (seg === 'champion' || seg === 'loyal') return 'champion';
    if (seg === 'promising' || seg === 'potential') return 'promising';
    if (seg === 'at-risk' || seg === 'attention' || seg === 'dormant') return 'at-risk';
    if (r.lifetime && r.lifetime.paidCount === 0) return 'new';
    return 'regular';
}

/** The intent the batch is mostly about. */
export function dominantIntent(rows) {
    const counts = {};
    for (const r of rows || []) {
        const i = intentOf(r);
        counts[i] = (counts[i] || 0) + 1;
    }
    let best = 'regular';
    let bestN = 0;
    // A fixed order keeps the result stable when two intents tie.
    for (const i of ['lapsed', 'at-risk', 'new', 'champion', 'promising', 'regular']) {
        if ((counts[i] || 0) > bestN) { best = i; bestN = counts[i] || 0; }
    }
    return { intent: best, counts, total: (rows || []).length };
}

/** The dish the selected guests order most (one message, so one dish). */
export function dominantDish(rows) {
    const counts = {};
    for (const r of rows || []) {
        const favs = (r && r.favourites) || [];
        if (!favs.length) continue;
        const top = favs[0];
        const name = String((top && top.name) || '').trim();
        if (!name) continue;
        counts[name] = (counts[name] || 0) + 1;
    }
    let best = '';
    let bestN = 0;
    for (const [name, n] of Object.entries(counts)) {
        if (n > bestN) { best = name; bestN = n; }
    }
    return best ? { name: best, guests: bestN } : null;
}

/**
 * The deterministic draft. NOT AI - it composes the facts we already have
 * (favourite dish, last visit, store name) into the pattern that matches the
 * audience, and leaves the bot's own personalization tokens live so the
 * WhatsApp send can greet each guest by name.
 *
 * Channel-aware on purpose: a push is ONE message for every device, so it may
 * not contain {name} (it would be shown literally). A WhatsApp campaign is
 * personalized per recipient by bot/promotions.js personalizeTemplate, which
 * resolves {name}, {storeName}, {phone} and {lastOrderDate} - and NOTHING
 * else, so no other token may be used.
 *
 * The patterns never promise a discount: a promotional promise belongs to an
 * offer the owner picked, not to a generated greeting.
 */
export function generateDraft(rows, ctx = {}, opts = {}) {
    const channel = opts.channel === 'wa' ? 'wa' : 'push';
    const store = String(ctx.storeName || '').trim() || 'our restaurant';
    const dom = dominantIntent(rows);
    const dish = dominantDish(rows);
    const dishName = dish ? dish.name : '';

    let title = '';
    let body = '';
    let pattern = dom.intent;

    if (dom.intent === 'lapsed' || dom.intent === 'at-risk') {
        pattern = 'win-back';
        title = `We miss you`;
        body = channel === 'wa'
            ? `Hi {name}, it has been a while - we would love to welcome you back to ${store}.${dishName ? ` Your favourite ${dishName} is back on the menu.` : ''} What can we get you today?`
            : `We miss you at ${store}.${dishName ? ` Your favourite ${dishName} is back on the menu.` : ''} Tap to order again in a tap.`;
    } else if (dom.intent === 'new') {
        pattern = 'welcome';
        title = `Welcome to ${store}`;
        body = channel === 'wa'
            ? `Hi {name}, thanks for ordering from ${store}!${dishName ? ` We hope you enjoy the ${dishName}.` : ''} Order again any time - we will be here.`
            : `Welcome to ${store}.${dishName ? ` Your first order: ${dishName}.` : ''} Tap to browse the menu.`;
    } else if (dom.intent === 'champion' || dom.intent === 'promising') {
        pattern = 'thank-you';
        title = `Thank you, ${store}`;
        body = channel === 'wa'
            ? `Hi {name}, great to see you again - thank you for being our regular at ${store}.${dishName ? ` Our most-ordered dish, ${dishName}, is on the menu today.` : ''} What would you like today?`
            : `Thank you for being our regular at ${store}.${dishName ? ` Our most-ordered dish, ${dishName}, is on the menu today.` : ''} Tap to order.`;
    } else {
        pattern = 'hello';
        title = `Hello from ${store}`;
        body = channel === 'wa'
            ? `Hi {name}, a quick hello from ${store}.${dishName ? ` Your favourite ${dishName} is on the menu today.` : ''} What can we get you?`
            : `Hello from ${store}.${dishName ? ` Your favourite ${dishName} is on the menu today.` : ''} Tap to see the menu.`;
    }

    return {
        channel,
        pattern,
        title: title.slice(0, 100),
        body: body.slice(0, 300),
        dish: dishName,
        intent: dom.intent,
        intentCounts: dom.counts,
        tokens: channel === 'wa' ? ['{name}', '{storeName}', '{lastOrderDate}'] : [],
    };
}
