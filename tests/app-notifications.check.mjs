/**
 * App Notifications tab guard (static).
 *
 * Two real bugs this tab has shipped are invisible to `node --check`:
 *  1. a duplicate DOM id (Settings already owns `btnCopyAppLink`) made the
 *     "Copy app link" button dead - getElementById returned the hidden twin;
 *  2. an unclosed tab pane made Tables/Discounts/Costs render 0x0.
 * Plus: the client used to omit `type`, so the server defaulted to 'promo' and
 * every "Order update" was silently treated as marketing.
 *
 * Run: node tests/app-notifications.check.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'Admin/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'Admin/js/features/app-notifications.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'Admin/style.css'), 'utf8');

let failed = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); } };

// Pre-existing duplicates, unrelated to this tab (receipt print modals).
const KNOWN_DUPES = new Set(['receiptPreviewModal', 'receiptPreviewContainer']);

t('no duplicate DOM ids in Admin/index.html', () => {
    const counts = new Map();
    for (const m of html.matchAll(/\sid="([^"]+)"/g)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    const dupes = [...counts].filter(([id, n]) => n > 1 && !KNOWN_DUPES.has(id)).map(([id, n]) => `${id} x${n}`);
    assert.deepEqual(dupes, [], 'duplicate ids: ' + dupes.join(', '));
});

t('every tab pane shares one parent (nothing swallows the panes below it)', () => {
    // Strip comments so commented-out markup cannot unbalance the scan.
    const src = html.replace(/<!--[\s\S]*?-->/g, '');
    const stack = [];
    const panes = [];
    const re = /<(div|section)\b[^>]*>|<\/(div|section)>/gi;
    let m;
    while ((m = re.exec(src))) {
        if (m[1]) {
            const attrs = m[0];
            const id = attrs.match(/\bid="(tab-[a-z-]+)"/);
            if (id) panes.push({ id: id[1], depth: stack.length, parent: stack[stack.length - 1] || '(root)' });
            stack.push(m[1].toLowerCase());
        } else {
            stack.pop();
        }
    }
    assert.equal(stack.length, 0, 'unbalanced <div>/<section> in Admin/index.html');
    assert.ok(panes.length >= 10, 'expected every tab pane, saw ' + panes.length);
    const parents = new Set(panes.map(p => p.parent + '@' + p.depth));
    assert.equal(parents.size, 1, 'panes split across parents: ' + panes.filter(p => p.parent + '@' + p.depth !== [...parents][0]).map(p => `${p.id}=${p.parent}@${p.depth}`).join(', '));
});

t('every id the module looks up exists in the markup', () => {
    const ids = new Set();
    for (const m of js.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) ids.add(m[1]);
    for (const m of js.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) ids.add(m[1]);
    const missing = [...ids].filter(id => !html.includes(`id="${id}"`));
    assert.deepEqual(missing, [], 'ids missing from index.html: ' + missing.join(', '));
});

t('the request carries type / audience / phone (server defaults would mis-bill the send)', () => {
    assert.ok(/body:\s*JSON\.stringify\(\{[\s\S]*?\btype,/.test(js), 'type must be sent top-level');
    assert.ok(/audience:\s*aud === 'one' \? 'phone' : 'all'/.test(js), 'audience must be explicit');
    assert.ok(/aud === 'one' \? \{ phone \} : \{\}/.test(js), 'phone must travel with a single-customer send');
});

t('order updates are forced to one customer', () => {
    assert.ok(/if \(_currentType\(\) === 'order'\)[\s\S]{0,200}value="one"[\s\S]{0,80}checked = true/.test(js), 'order type must select the one-customer audience');
    assert.ok(/allRadio\.disabled = _currentType\(\) === 'order'/.test(js), 'all-subscribers must be disabled for order updates');
});

t('chip radios have a selected state and stay keyboard-focusable', () => {
    assert.ok(/\.promo-notifications-pane \.chip--radio:has\(input:checked\)/.test(css), 'selected chip style');
    assert.ok(/\.promo-notifications-pane \.chip--radio:has\(input:focus-visible\)/.test(css), 'focus ring');
    assert.ok(!/\.promo-notifications-pane \.chip--radio input\s*\{[^}]*display:\s*none/.test(css), 'input must stay focusable');
});

t('the tab is wired once (loadTabData re-runs on every visit)', () => {
    assert.ok(/_wired/.test(js), 'idempotent wiring flag');
    assert.ok(/function _wireOnce\(\)\s*\{\s*if \(_wired\) return;/.test(js), 'early return on the second visit');
});

t('result tone classes exist literally (PurgeCSS drops built-up names)', () => {
    for (const cls of ['is-ok', 'is-warn', 'is-error']) {
        assert.ok(js.includes(`'${cls}'`), `${cls} must appear as a literal so PurgeCSS keeps the rule`);
    }
});

console.log(failed ? `\n${failed} check(s) failed` : '\napp notifications guard ok');
process.exit(failed ? 1 : 0);
