/**
 * Unit tests for the multi-tenant path resolution layer.
 * Run: node --test bot/tests/unit.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { resolvePath: firebaseResolvePath, stripUndefined } = require('../firebase');
const helpers = require('../helpers/outlet-resolution');

test('resolvePath: shared (platform-root) nodes pass through unchanged', () => {
    for (const root of ['admins', 'riders', 'riderStats', 'migrationStatus', 'logs', 'settlements', 'phoneNumberIndex']) {
        assert.strictEqual(firebaseResolvePath(`${root}/x/y`), `${root}/x/y`, `${root} should stay at root`);
    }
    // businesses/ absolute passes through too
    assert.strictEqual(firebaseResolvePath('businesses/bid/outlets/oid/orders'), 'businesses/bid/outlets/oid/orders');
});

test('resolvePath: tenant-scoped paths get businesses/{bid}/outlets/{oid} prefix', () => {
    // default outlet (pizza) maps to its own business
    assert.strictEqual(firebaseResolvePath('orders'), 'businesses/roshani-pizza/outlets/pizza/orders');
    assert.strictEqual(firebaseResolvePath('bot/commands'), 'businesses/roshani-pizza/outlets/pizza/bot/commands');
    assert.strictEqual(firebaseResolvePath('profiles/9197'), 'businesses/roshani-pizza/outlets/pizza/profiles/9197');
    // cake is its own separate business
    assert.strictEqual(firebaseResolvePath('inventory', 'cake'), 'businesses/roshani-cake/outlets/cake/inventory');
});

test('resolvePath: empty/null input returns empty string', () => {
    assert.strictEqual(firebaseResolvePath(''), '');
    assert.strictEqual(firebaseResolvePath(null), '');
    assert.strictEqual(firebaseResolvePath(undefined), '');
});

test('outlet-resolution: outletPath builds correct tenant path', () => {
    assert.strictEqual(helpers.outletPath('roshani-pizza', 'pizza', 'orders'), 'businesses/roshani-pizza/outlets/pizza/orders');
    assert.strictEqual(helpers.outletPath('roshani-pizza', 'pizza'), 'businesses/roshani-pizza/outlets/pizza');
    assert.strictEqual(helpers.outletPath('roshani-cake', 'cake', 'bot', 'commands'), 'businesses/roshani-cake/outlets/cake/bot/commands');
    // falsy args fall back to env/defaults (default outlet pizza -> roshani-pizza)
    assert.strictEqual(helpers.outletPath(null, null, 'orders'), 'businesses/roshani-pizza/outlets/pizza/orders');
});

test('outlet-resolution: resolvePath(scope, ...rest)', () => {
    assert.strictEqual(helpers.resolvePath({ businessId: 'b1', outletId: 'o1' }, 'orders'), 'businesses/b1/outlets/o1/orders');
    // scope outletId only -> business inferred from outlet map
    assert.strictEqual(helpers.resolvePath({ outletId: 'cake' }, 'settings'), 'businesses/roshani-cake/outlets/cake/settings');
});

test('outlet-resolution: env vars override defaults', (t) => {
    process.env.BUSINESS_ID = 'envbiz';
    process.env.OUTLET_ID = 'envoutlet';
    try {
        assert.strictEqual(helpers.resolveBusinessId(), 'envbiz');
        assert.strictEqual(helpers.resolveOutletId(), 'envoutlet');
    } finally {
        delete process.env.BUSINESS_ID;
        delete process.env.OUTLET_ID;
    }
});

test('outlet-resolution: defaults without env', () => {
    assert.strictEqual(helpers.resolveBusinessId(), 'roshani-pizza');
    assert.strictEqual(helpers.resolveOutletId(), 'pizza');
});

test('stripUndefined: removes undefined leaves, keeps null/arrays', () => {
    assert.deepStrictEqual(stripUndefined({ a: 1, b: undefined }), { a: 1, b: null });
    assert.deepStrictEqual(stripUndefined([{ a: undefined }, 2]), [{ a: null }, 2]);
    assert.strictEqual(stripUndefined(null), null);
    assert.strictEqual(stripUndefined(undefined), null);
    assert.strictEqual(stripUndefined(5), 5);
});

// G5 quota: the bot (getISTDateInfo().dateStr) and the quota endpoint (inline
// IST-shift) must key usage by the SAME day, or `used` never matches the
// counter. Mirrors the endpoint's exact expression.
test('quota usage day key matches bot getISTDateInfo().dateStr', () => {
    const { getISTDateInfo } = require('../utils');
    const botDay = getISTDateInfo().dateStr;
    const endpointDay = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
    assert.strictEqual(botDay, endpointDay);
});

// F1: template sends must carry a BODY component ONLY when the template has a
// {{1}} variable. Passing `text` to a no-variable template is rejected by Graph
// (code 100) — that rejection is what drives the text fallback in SEND_GENERIC
// _MESSAGE / promos, so the payload shape is load-bearing.
test('sendWhatsAppTemplate: body component only when a {{1}} variable is supplied', async () => {
    const waSend = require('../whatsapp-send');
    const captured = [];
    Object.defineProperty(global, 'fetch', {
        value: async (url, opts) => {
            captured.push({ url, body: JSON.parse(opts.body) });
            return { ok: true, json: async () => ({ id: 'wamid.X' }) };
        },
        writable: true, configurable: true
    });
    await waSend.sendWhatsAppTemplate('PN', 'TOK', '919700000000', { name: 'bot_live_update' });
    await waSend.sendWhatsAppTemplate('PN', 'TOK', '919700000000', { name: 'announcement', body: 'Hi {{1}}!' });
    assert.strictEqual(captured.length, 2);
    // no-variable template → no components
    assert.deepStrictEqual(captured[0].body.template.components, []);
    assert.deepStrictEqual(captured[0].body.type, 'template');
    // variable template → BODY component carrying the substituted value in
    // Meta's parameters array (the Graph API rejects a bare `text` key on a
    // BODY component with code 100 — this shape is what callers rely on).
    assert.deepStrictEqual(captured[1].body.template.components, [{ type: 'BODY', parameters: [{ type: 'text', text: 'Hi {{1}}!' }] }]);
    assert.strictEqual(captured[1].body.template.language.code, 'en');
});

// Chat history: thread key = last-10-digits of the sender JID — the same
// convention as customers/{cleanPhone} and promo opt-out keys, so Baileys
// (9197...@s.whatsapp.net) and Meta (9197...) map to ONE thread.
test('customerIdFromJid: last-10-digits thread key for Baileys and Meta jids', () => {
    const { customerIdFromJid } = require('../chat-log');
    assert.strictEqual(customerIdFromJid('919876543210@s.whatsapp.net'), '9876543210');
    assert.strictEqual(customerIdFromJid('919876543210'), '9876543210');
    assert.strictEqual(customerIdFromJid('9876543210'), '9876543210');
    // too short → null (never a real 10-digit Indian number)
    assert.strictEqual(customerIdFromJid('123@s.whatsapp.net'), null);
    assert.strictEqual(customerIdFromJid(null), null);
});
