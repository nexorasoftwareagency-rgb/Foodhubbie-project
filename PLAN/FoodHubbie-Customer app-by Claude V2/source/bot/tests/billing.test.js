/**
 * Promo-token billing path checks — the campaign guard/decrement read and
 * write billing/tokens/balance on every send; if resolvePath ever stopped
 * tenant-scoping `billing` the guard would read null (pause everything) or
 * the decrement would land nowhere.
 * Run: node --test bot/tests/billing.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { resolvePath } = require('../firebase');

test('billing/tokens/balance resolves tenant-scoped per outlet', () => {
    assert.strictEqual(
        resolvePath('billing/tokens/balance'),
        'businesses/roshani-pizza/outlets/pizza/billing/tokens/balance'
    );
    assert.strictEqual(
        resolvePath('billing/tokens/balance', 'cake'),
        'businesses/roshani-cake/outlets/cake/billing/tokens/balance'
    );
});

test('billing is not a platform-shared root passthrough', () => {
    // Shared nodes (admins, logs, …) return unchanged; billing must not.
    assert.notStrictEqual(resolvePath('billing/tokens/balance'), 'billing/tokens/balance');
});

test('token decrement clamp math', () => {
    const next = (v) => Math.max(Number(v || 0) - 1, 0);
    assert.strictEqual(next(1), 0);     // last token consumed
    assert.strictEqual(next(0), 0);     // never negative
    assert.strictEqual(next(null), 0);  // missing node behaves as empty
    assert.strictEqual(next(15), 14);
});
