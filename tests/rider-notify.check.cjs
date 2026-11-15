#!/usr/bin/env node
/**
 * Rider push relay guard (batch 23h).
 *
 *   node tests/rider-notify.check.cjs
 *
 * Two jobs:
 *
 *  1. BEHAVIOUR — run the real `bot/rider-push.js` (the module vendored into
 *     the deployed Functions bundle) against a fake RTDB/FCM and assert the
 *     copy, the email->uid resolution, the data-only payload and the dead-token
 *     prune are exactly what the bot used to send.
 *
 *  2. WIRING — pin the one switch (`config/riderRelay/enabled === true`), the
 *     bot standing down, the two RTDB triggers (leaf refs, demo skip, durable
 *     claim) and the vendor entry, so neither side can be enabled alone and the
 *     two runners cannot send different messages.
 *
 * Static + in-memory only — no network, no credentials.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const {
    createRiderPush, riderPushCopy, riderStatusEvent, isWhatsAppJid,
} = require(path.join(ROOT, 'bot', 'rider-push.js'));

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ok  ' + label); };
const eq = (a, b, msg) => assert.deepEqual(a, b, msg);

// ---------------------------------------------------------------------------
// Fake RTDB + FCM
// ---------------------------------------------------------------------------
function fakeDb(initial = {}) {
    const store = new Map(Object.entries(initial));
    const calls = { removed: [], set: [] };
    return {
        store, calls,
        ref(p) {
            return {
                once: async () => ({ val: () => (store.has(p) ? store.get(p) : null) }),
                remove: async () => { store.delete(p); calls.removed.push(p); },
                set: async (v) => { store.set(p, v); calls.set.push([p, v]); },
            };
        },
    };
}

function makeHarness({ token = 'tok-1', riders = {}, sendError = null } = {}) {
    const db = fakeDb(token ? { 'outlets/pizza/riders/rider-1/fcmToken': token } : {});
    const sent = [];
    const push = createRiderPush({
        db,
        resolvePath: (p) => 'outlets/pizza/' + p,
        getRiderByEmail: async (email) => riders[String(email).toLowerCase()] || null,
        isDeadPushCode: (code) => code === 'messaging/registration-token-not-registered',
        messaging: {
            send: async (msg) => {
                if (sendError) { const e = new Error('boom'); e.code = sendError; throw e; }
                sent.push(msg);
                return 'id';
            },
        },
        formatOrderId: (id) => 'T-' + id,
    });
    return { db, sent, push };
}

// ---------------------------------------------------------------------------
// 1. Copy — byte-for-byte the bot's old wording
// ---------------------------------------------------------------------------
ok('assignment copy matches the bot', () => {
    eq(riderPushCopy('assigned', { displayId: 'X9', total: 250 }), {
        title: 'New Order Assigned!',
        body: 'Order #X9 for ₹250 — Please check the app.',
        data: { type: 'rider_assigned', url: '/active' },
    });
});
ok('ready copy matches the bot', () => {
    eq(riderPushCopy('ready', { displayId: 'X9' }), {
        title: 'Order #X9',
        body: 'Order #X9 is ready for pickup!',
        data: { type: 'status_change' },
    });
});
ok('cancelled copy matches the bot', () => {
    eq(riderPushCopy('cancelled', { displayId: 'X9' }), {
        title: 'Order #X9',
        body: 'Order #X9 has been cancelled.',
        data: { type: 'status_change' },
    });
});
ok('unknown event builds no copy', () => {
    eq(riderPushCopy('delivered', { displayId: 'X9' }), null);
});
ok('status mapping: ready|packed|cooked, cancelled, nothing else', () => {
    eq(['ready', 'packed', 'cooked'].map(riderStatusEvent), ['ready', 'ready', 'ready']);
    eq(riderStatusEvent('CANCELLED'), 'cancelled');
    for (const s of ['placed', 'confirmed', 'picked up', 'delivered', '', null]) {
        eq(riderStatusEvent(s), '', `${s} must not push`);
    }
});

// ---------------------------------------------------------------------------
// 2. Resolution — UID passes through, email resolves, JIDs are dropped
//    (the awaited cases run in the final block below)
// ---------------------------------------------------------------------------
ok('WhatsApp JIDs are not device riders', () => {
    eq(isWhatsAppJid('919999999999@s.whatsapp.net'), true);
    eq(isWhatsAppJid('919999999999@g.us'), true);
    eq(isWhatsAppJid('AbCdEf0123456789'), false);
});

// ---------------------------------------------------------------------------
// 3. Send — data-only, high urgency, dead-token prune
// ---------------------------------------------------------------------------
const assignedOrder = { orderId: 'A1', riderId: 'rider-1', total: 499, status: 'Placed' };

ok('an assignment sends one data-only high-urgency push', async () => {
    const { sent, push } = makeHarness();
    const res = await push.push({ orderId: 'K1', order: assignedOrder, outlet: 'pizza', event: 'assigned' });
    eq(res.sent, true);
    eq(res.uid, 'rider-1');
    eq(sent.length, 1);
    const msg = sent[0];
    eq(msg.token, 'tok-1');
    eq(msg.notification, undefined, 'never a notification payload (double popup)');
    eq(msg.android, { priority: 'high' });
    eq(msg.webpush, { headers: { Urgency: 'high' } });
    eq(msg.data, {
        orderId: 'K1',
        outlet: 'pizza',
        type: 'rider_assigned',
        url: '/active',
        title: 'New Order Assigned!',
        body: 'Order #T-A1 for ₹499 — Please check the app.',
    });
});
ok('a status push carries the status', async () => {
    const { sent, push } = makeHarness();
    await push.push({ orderId: 'K1', order: assignedOrder, outlet: 'pizza', event: 'ready', status: 'packed' });
    eq(sent[0].data.type, 'status_change');
    eq(sent[0].data.status, 'packed');
    eq(sent[0].data.url, undefined, 'status pushes carry no deep link (bot parity)');
});
ok('no token: nothing is sent', async () => {
    const { sent, push } = makeHarness({ token: null });
    const res = await push.push({ orderId: 'K1', order: assignedOrder, outlet: 'pizza', event: 'assigned' });
    eq({ sent: res.sent, reason: res.reason }, { sent: false, reason: 'no-token' });
    eq(sent.length, 0);
});
ok('no rider on the order: nothing is resolved or sent', async () => {
    const { sent, push } = makeHarness();
    const res = await push.push({ orderId: 'K1', order: { orderId: 'A1' }, outlet: 'pizza', event: 'assigned' });
    eq(res.reason, 'no-rider');
    eq(sent.length, 0);
});
ok('a dead token is removed and the rider record stamped', async () => {
    const { db, push } = makeHarness({ sendError: 'messaging/registration-token-not-registered' });
    const res = await push.push({ orderId: 'K1', order: assignedOrder, outlet: 'pizza', event: 'assigned' });
    eq({ sent: res.sent, reason: res.reason }, { sent: false, reason: 'fcm-error' });
    eq(db.calls.removed, ['outlets/pizza/riders/rider-1/fcmToken']);
    eq(db.calls.set.length, 1);
    eq(db.calls.set[0][0], 'outlets/pizza/riders/rider-1/fcmTokenInvalidAt');
});
ok('a transient failure keeps the token', async () => {
    const { db, push } = makeHarness({ sendError: 'messaging/internal-error' });
    await push.push({ orderId: 'K1', order: assignedOrder, outlet: 'pizza', event: 'assigned' });
    eq(db.calls.removed, []);
    eq(db.calls.set, []);
});

// ---------------------------------------------------------------------------
// 4. The module stays socket-free
// ---------------------------------------------------------------------------
ok('no Baileys / bot/firebase / bot/index imports (safe to vendor)', () => {
    const src = read('bot/rider-push.js');
    for (const banned of ['baileys', "require('./firebase')", "require('./index')", 'redis']) {
        assert.ok(!src.includes(banned), `rider-push.js must not reference ${banned}`);
    }
    assert.ok(!/notification\s*:/.test(src), 'rider-push.js must never send a notification payload');
});

// ---------------------------------------------------------------------------
// 5. Bot side: one switch, and the bot stands down under it
// ---------------------------------------------------------------------------
const botSrc = read('bot/index.js');
ok('the bot has the rider relay switch (explicit true only)', () => {
    assert.ok(botSrc.includes("db.ref('config/riderRelay/enabled')"), 'flag path');
    assert.ok(/async function isRiderRelayEnabled\(\)/.test(botSrc), 'helper');
    assert.ok(/snap\.val\(\) === true/.test(botSrc), 'only an explicit true turns it on');
    assert.ok(/_riderRelayCache\.at < 30000/.test(botSrc), '30 s cache (runs on every order change)');
});
ok('the bot gates the rider push and delegates to the shared module', () => {
    const start = botSrc.indexOf('if (!riderPush || !after.riderId) return;');
    assert.ok(start !== -1, 'rider branch present');
    const branch = botSrc.slice(start, botSrc.indexOf('});', start));
    assert.ok(/if \(await isRiderRelayEnabled\(\)\) return;/.test(branch), 'stands down when the cloud owns it');
    assert.ok(/riderPush\.push\(/.test(branch), 'uses the shared module');
    assert.ok(!/sendFCMToRider\(/.test(botSrc), 'the old inline sender is gone');
});
ok('the WhatsApp rider_assigned TEMPLATE stays in the bot (socket-only)', () => {
    assert.ok(botSrc.includes("'rider_assigned'"), 'the template send must not be deleted with the FCM path');
});

// ---------------------------------------------------------------------------
// 6. Functions side: two leaf triggers, one flag, durable claim, demo skip
// ---------------------------------------------------------------------------
const src = path.join('FIREBASE_SERVER_MIGRATION', 'functions', 'src');
const trigger = read(path.join(src, 'triggers', 'riderRelay.ts'));
const factory = read(path.join(src, 'shared', 'rider', 'factory.ts'));
const entry = read(path.join(src, 'index.ts'));
const vendor = read(path.join('FIREBASE_SERVER_MIGRATION', 'functions', 'scripts', 'copy-vendor.cjs'));

ok('both triggers export and listen on leaves, never the whole order', () => {
    assert.ok(/export \{ onRiderAssigned, onRiderStatus \}/.test(entry), 'index.ts exports both');
    assert.ok(/orders\/\{orderId\}\/riderId/.test(trigger), 'assignment leaf');
    assert.ok(/orders\/\{orderId\}\/status/.test(trigger), 'status leaf');
    eq((trigger.match(/onValueWritten\(/g) || []).length, 2, 'exactly two write triggers');
});
ok('one switch: config/riderRelay/enabled === true, both triggers no-op otherwise', () => {
    assert.ok(/RELAY_FLAG = 'config\/riderRelay\/enabled'/.test(trigger));
    assert.ok(/snap\.val\(\) === true/.test(trigger));
    eq((trigger.match(/if \(!\(await relayEnabled\(\)\)\) return;/g) || []).length, 2);
});
ok('the demo tenant is hard-skipped in both triggers', () => {
    assert.ok(/DEMO_BUSINESS_ID = 'foodhubbie-demo'/.test(trigger));
    eq((trigger.match(/bid === DEMO_BUSINESS_ID/g) || []).length, 2);
});
ok('the durable claim makes a replayed event a no-op', () => {
    assert.ok(/\/_riderFcm\/assigned/.test(trigger) && /\/_riderFcm\/status/.test(trigger));
    assert.ok(/cur && cur\.rider === riderId \? undefined/.test(trigger));
    assert.ok(/cur && cur\.status === statusAfter/.test(trigger));
    eq((trigger.match(/if \(!claim\.committed\) return;/g) || []).length, 2);
});
ok('what actually happened is recorded for support', () => {
    assert.ok(/\/_riderFcm\/last/.test(trigger));
    assert.ok(/sent: result\.sent === true/.test(trigger));
});
ok('the factory pins the tenant from the event path and vendors the real module', () => {
    assert.ok(/export function makeRiderPush\(bid: string, oid: string\)/.test(factory));
    assert.ok(/businesses\/\$\{bid\}\/outlets\/\$\{oid\}/.test(factory));
    assert.ok(/vendor\/bot\/rider-push\.js/.test(factory), 'requires the vendored module');
    assert.ok(!/rider-push\.js'\)/.test(factory.replace(/vendor\/bot\/rider-push\.js/, '')), 'no second copy of the rules');
    assert.ok(vendor.includes("'bot/rider-push.js'"), 'copy-vendor ships it');
});

(async () => {
    const a = makeHarness();
    assert.equal(await a.push.resolveRiderUid('AbCdEf0123456789', 'pizza'), 'AbCdEf0123456789');
    const b = makeHarness({ riders: { 'rider@example.com': { uid: 'rider-1' } } });
    assert.equal(await b.push.resolveRiderUid('Rider@Example.com', 'pizza'), 'rider-1');
    const c = makeHarness();
    assert.equal(await c.push.resolveRiderUid('ghost@example.com', 'pizza'), '');
    pass++;
    console.log('  ok  resolution: UID passes through, email resolves, unknown email drops');
    console.log(`\n${pass} passed, 0 failed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
