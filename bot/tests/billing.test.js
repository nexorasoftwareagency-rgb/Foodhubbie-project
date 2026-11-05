/**
 * Promo-token billing path checks — the campaign guard/decrement read and
 * write the promo token balance on every send. The balance is MONEY, so it
 * lives at the root `walletBilling/{bid}/{oid}` node, never under
 * `businesses/{bid}` (the tenant holds `.write` on that subtree).
 * Run: node --test bot/tests/billing.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { billingPath } = require('../firebase');

test('wallet ledger resolves to the root walletBilling node per outlet', () => {
    assert.strictEqual(
        billingPath('tokens/balance'),
        'walletBilling/roshani-pizza/pizza/tokens/balance'
    );
    assert.strictEqual(
        billingPath('tokens/balance', 'cake'),
        'walletBilling/roshani-cake/cake/tokens/balance'
    );
});

test('wallet ledger never lives under the tenant-writable businesses subtree', () => {
    assert.ok(!billingPath('tokens/balance').startsWith('businesses/'));
    assert.ok(!billingPath('payments').startsWith('businesses/'));
});

test('token decrement clamp math', () => {
    const next = (v) => Math.max(Number(v || 0) - 1, 0);
    assert.strictEqual(next(1), 0);     // last token consumed
    assert.strictEqual(next(0), 0);     // never negative
    assert.strictEqual(next(null), 0);  // missing node behaves as empty
    assert.strictEqual(next(15), 14);
});
