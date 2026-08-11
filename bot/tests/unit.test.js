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
    assert.strictEqual(firebaseResolvePath('orders'), 'businesses/roshani/outlets/pizza/orders');
    assert.strictEqual(firebaseResolvePath('bot/commands'), 'businesses/roshani/outlets/pizza/bot/commands');
    assert.strictEqual(firebaseResolvePath('profiles/9197'), 'businesses/roshani/outlets/pizza/profiles/9197');
    assert.strictEqual(firebaseResolvePath('inventory', 'cake'), 'businesses/roshani/outlets/cake/inventory');
});

test('resolvePath: empty/null input returns empty string', () => {
    assert.strictEqual(firebaseResolvePath(''), '');
    assert.strictEqual(firebaseResolvePath(null), '');
    assert.strictEqual(firebaseResolvePath(undefined), '');
});

test('outlet-resolution: outletPath builds correct tenant path', () => {
    assert.strictEqual(helpers.outletPath('roshani', 'pizza', 'orders'), 'businesses/roshani/outlets/pizza/orders');
    assert.strictEqual(helpers.outletPath('roshani', 'pizza'), 'businesses/roshani/outlets/pizza');
    assert.strictEqual(helpers.outletPath('roshani', 'cake', 'bot', 'commands'), 'businesses/roshani/outlets/cake/bot/commands');
    // falsy args fall back to env/defaults
    assert.strictEqual(helpers.outletPath(null, null, 'orders'), 'businesses/roshani/outlets/pizza/orders');
});

test('outlet-resolution: resolvePath(scope, ...rest)', () => {
    assert.strictEqual(helpers.resolvePath({ businessId: 'b1', outletId: 'o1' }, 'orders'), 'businesses/b1/outlets/o1/orders');
    // scope wins over env
    assert.strictEqual(helpers.resolvePath({ outletId: 'cake' }, 'settings'), 'businesses/roshani/outlets/cake/settings');
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
    assert.strictEqual(helpers.resolveBusinessId(), 'roshani');
    assert.strictEqual(helpers.resolveOutletId(), 'pizza');
});

test('stripUndefined: removes undefined leaves, keeps null/arrays', () => {
    assert.deepStrictEqual(stripUndefined({ a: 1, b: undefined }), { a: 1, b: null });
    assert.deepStrictEqual(stripUndefined([{ a: undefined }, 2]), [{ a: null }, 2]);
    assert.strictEqual(stripUndefined(null), null);
    assert.strictEqual(stripUndefined(undefined), null);
    assert.strictEqual(stripUndefined(5), 5);
});
