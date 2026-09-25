/**
 * Runnable check for the P0-3 (category matching) and P0-4 (table channel)
 * fixes in Admin/js/features/discount-evaluator.js.
 *
 *   node tests/discount-evaluator.check.mjs
 *
 * The module imports ../firebase.js (CDN URLs + window/document), so it can't
 * be loaded directly in Node — bundle it with esbuild (already a devDependency)
 * and stub that single file. Everything under test is the real source.
 *
 * Not named *.test.* on purpose: playwright.config.js uses testDir './tests'
 * and would otherwise try to load this as a Playwright spec.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const DISCOUNTS = {
    cat1: {
        type: 'category', categoryIds: ['keyA'], value: 10, mode: 'percent',
        channel: 'pos', enabled: true, startsAt: 0, endsAt: 0, name: 'Drinks 10% off',
    },
};

const FIREBASE_STUB = `
export const Outlet = { current: 'o1', ref: (p) => String(p) };
export const ref = (p) => p;
export const get = async (path) => ({
    exists: () => false,
    val: () => String(path) === 'categories'
        ? { keyA: { name: 'Hot Drinks' }, keyB: { name: 'Pizza' } }
        : String(path) === 'discounts' ? ${JSON.stringify(DISCOUNTS)} : {},
});
export const runTransaction = async () => ({ committed: true });
export const push = () => ({ key: 'pushKey' });
`;

const { outputFiles } = await build({
    entryPoints: ['Admin/js/features/discount-evaluator.js'],
    bundle: true, format: 'esm', write: false, platform: 'neutral', logLevel: 'silent',
    plugins: [{
        name: 'firebase-stub',
        setup(b) {
            b.onResolve({ filter: /firebase\.js$/ }, () => ({ path: 'stub', namespace: 'fb' }));
            b.onLoad({ filter: /^stub$/, namespace: 'fb' }, () => ({ contents: FIREBASE_STUB, loader: 'js' }));
        },
    }],
});

const mod = await import('data:text/javascript;base64,'
    + Buffer.from(outputFiles[0].text).toString('base64'));

const DRINKS_CART = [{ name: 'Masala Chai', category: 'Hot Drinks' }];

test('P0-4: discountAllowsChannel channel matrix', () => {
    const cases = [
        [{ channel: 'pos' }, 'table', true],        // the fix
        [{ channel: 'pos' }, 'pos', true],          // unchanged
        [{ channel: 'pos' }, 'whatsapp', false],    // unchanged
        [{ channel: 'pos' }, 'website', false],     // unchanged
        [{ channel: 'whatsapp' }, 'table', false],
        [{ channel: 'website' }, 'table', false],
        [{ channel: 'both' }, 'table', true],       // unchanged
        [{ channel: 'all' }, 'table', true],
        [{}, 'table', true],
        [{ channel: '' }, 'table', true],
    ];
    for (const [d, channel, expected] of cases) {
        assert.equal(mod.discountAllowsChannel(d, channel), expected,
            `discount.channel=${d.channel || '(unset)'} vs channel=${channel}`);
    }
});

test('P0-3: category discount matches a cart carrying the category NAME', async () => {
    const list = await mod.getEligibleOffersForDisplay(
        { cat1: DISCOUNTS.cat1 }, { channel: 'table', cart: DRINKS_CART });
    assert.equal(list.length, 1);
});

test('P0-3: raw push-key on the item still matches (unchanged behaviour)', async () => {
    const list = await mod.getEligibleOffersForDisplay(
        { cat1: DISCOUNTS.cat1 }, { channel: 'pos', cart: [{ name: 'x', categoryId: 'keyA' }] });
    assert.equal(list.length, 1);
});

test('P0-3: a different category never matches', async () => {
    const list = await mod.getEligibleOffersForDisplay(
        { cat1: DISCOUNTS.cat1 },
        { channel: 'table', cart: [{ name: 'Margherita', category: 'Pizza' }] });
    assert.equal(list.length, 0);
});

test('P0-3: an item with no category at all never matches', async () => {
    const list = await mod.getEligibleOffersForDisplay(
        { cat1: DISCOUNTS.cat1 }, { channel: 'table', cart: [{ name: 'Masala Chai (Large)' }] });
    assert.equal(list.length, 0);
});

test('P0-3 + P0-4: POS-only category discount pays out on a table bill', async () => {
    const r = await mod.evaluateDiscount({ subtotal: 500, channel: 'table', cart: DRINKS_CART });
    assert.equal(r?.amount, 50);
    assert.equal(r?.discount.id, 'cat1');
});

test('regression: the same discount never leaks into the website channel', async () => {
    const r = await mod.evaluateDiscount({ subtotal: 500, channel: 'website', cart: DRINKS_CART });
    assert.equal(r, null);
});

test('regression: wrong category pays nothing on a table bill', async () => {
    const r = await mod.evaluateDiscount({
        subtotal: 500, channel: 'table', cart: [{ name: 'Margherita', category: 'Pizza' }],
    });
    assert.equal(r, null);
});
