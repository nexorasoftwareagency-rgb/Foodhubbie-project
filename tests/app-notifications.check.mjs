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
import { spawnSync } from 'node:child_process';
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

// --- Review round 2 (2026-11-09): quiet-hours hole, inbox honesty, history ---

t('quiet hours gate every marketing send, including one-customer', () => {
    const server = fs.readFileSync(path.join(root, 'bot-control-api/server.js'), 'utf8');
    assert.ok(/return type !== 'order' && _isQuietHours\(\);/.test(js), '_quietBlocked must exempt only order type');
    const one = js.match(/if \(aud === 'one'\) \{[\s\S]*?\n    \}/);
    assert.ok(one, 'one-customer branch exists');
    assert.ok(one[0].includes('_quietBlocked(type)'), 'one-customer branch must apply quiet hours (server gates every promo entry)');
    assert.ok(/\/\/ Broadcast[\s\S]{0,400}_quietBlocked\(type\)/.test(js), 'broadcast branch must apply quiet hours');
    // Definition + the single helper call. A second direct call would bypass the gate.
    assert.equal((js.match(/_isQuietHours\(\)/g) || []).length, 2, 'exactly one quiet-hours call site');
    assert.ok(server.includes("notifyType = messageType === 'order' ? 'order' : 'promo'"), 'server quiet-gates every non-order type');
});

t('send result reports the in-app inbox (delivered independently of FCM)', () => {
    assert.ok(js.includes('result.inbox'), 'client must read the inbox count');
    assert.ok(js.includes('saved to the in-app inbox'), '0-push result must mention the inbox');
    assert.ok(/inbox > 0\) bits\.push\(`\$\{inbox\} in-app`\)/.test(js), 'success line must include the inbox count');
});

t('send history renders from notifyLog', () => {
    assert.ok(html.includes('id="pushHistory"') && html.includes('id="pushHistoryList"'), 'history container ids in markup');
    assert.ok(js.includes("Outlet.ref('notifyLog')"), 'module reads the notifyLog node');
    assert.ok(/function _renderHistory/.test(js), 'renderer exists');
    assert.ok(js.includes("'push-hist__row'"), 'row class literal so PurgeCSS keeps the style');
    assert.ok(css.includes('.push-history') && css.includes('.push-hist__row'), 'history styles exist');
    assert.ok(/_loadHistory\(\)/.test(js), 'history loads with the tab');
});

t('disabled send button has a visible disabled state', () => {
    assert.ok(/\.push-actions \.btn-primary:disabled/.test(css), 'scoped disabled style for the send button');
});

t('server logs every accepted send, capped at 20 rows', () => {
    const server = fs.readFileSync(path.join(root, 'bot-control-api/server.js'), 'utf8');
    assert.ok(server.includes('notifyLog'), 'server writes notifyLog');
    assert.equal((server.match(/logNotifySend\(/g) || []).length, 3, 'helper defined + called at both exit points');
    assert.ok(server.includes('keys.length > 20'), 'prune keeps the newest 20 rows');
    assert.ok(/historyRow\(successCount, failureCount, inboxCount, tokens\.length\)/.test(server), 'post-send row');
    assert.ok(/historyRow\(0, 0, 0, 0\)/.test(server), 'empty-token exit still logs');
});

t('notifyLog rule: admin read only, no client write', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(root, 'database.rules.json'), 'utf8'));
    const find = (node, key) => {
        if (node && typeof node === 'object') {
            if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
            for (const v of Object.values(node)) { const hit = find(v, key); if (hit) return hit; }
        }
        return null;
    };
    const n = find(rules, 'notifyLog');
    assert.ok(n, 'notifyLog rule exists');
    assert.ok(String(n['.read']).includes('isSuper'), 'read gated to admins');
    assert.equal(n['.write'], undefined, 'no client write grant (server writes via Admin SDK)');
});

// The caps module used to call ADMIN.database() at load, but server.js requires
// it BEFORE initializeApp() - a guaranteed boot crash the moment the file ships.
t('notification-caps loads before initializeApp (control-API boot order)', () => {
    const r = spawnSync(process.execPath, ['-e', "require('./bot/notification-caps.js')"], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, 'module must load with no Firebase app initialized:\n' + (r.stderr || '').slice(0, 300));
});

// server.js and notification-caps.js resolve DIFFERENT firebase-admin copies,
// so the caps module needs the control-API's database injected after init -
// and injected AFTER initializeApp, never before (admin.database() throws
// "The default Firebase app does not exist" at send time).
t('server injects its database into notification-caps after initializeApp', () => {
    const server = fs.readFileSync(path.join(root, 'bot-control-api/server.js'), 'utf8');
    const caps = fs.readFileSync(path.join(root, 'bot/notification-caps.js'), 'utf8');
    assert.ok(server.includes("const { checkAndConsumeCap, setDatabase } = require('../bot/notification-caps');"), 'server imports setDatabase from the caps module');
    const initIdx = server.indexOf('admin.initializeApp(');
    const injectIdx = server.indexOf('setDatabase(admin.database())');
    assert.ok(initIdx > 0, 'initializeApp present');
    assert.ok(injectIdx > 0, 'setDatabase(admin.database()) call present');
    assert.ok(injectIdx > initIdx, `injection must come after initializeApp (init@${initIdx}, inject@${injectIdx})`);
    assert.ok(caps.includes('function setDatabase('), 'caps module exports setDatabase');
    assert.ok(/return _injectedDb \|\| ADMIN\.database\(\)/.test(caps), 'db() prefers the injected instance');
});

console.log(failed ? `\n${failed} check(s) failed` : '\napp notifications guard ok');
process.exit(failed ? 1 : 0);
