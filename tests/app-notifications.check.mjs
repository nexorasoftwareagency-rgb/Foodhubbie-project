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
// The endpoint, the bearer token, the server-anchored IST clock and the POST
// itself live in the SHARED notify client (the Customers notification
// checklist is its second caller), so the clock checks read THAT file.
const client = fs.readFileSync(path.join(root, 'Admin/js/features/notify-client.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'Admin/style.css'), 'utf8');

let failed = 0;
const t = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '-', e.message); } };

// Pre-existing duplicates, unrelated to this tab (receipt print modals).
const KNOWN_DUPES = new Set([
    'receiptPreviewModal', 'receiptPreviewContainer',
    // Shared between combos tab and Customer APP offers pane
    'btnBulkEnable', 'btnBulkDisable', 'btnBulkDelete', 'btnBulkCancel',
    // P2/P3 preview close (header + footer in same modal)
    'btnPreviewClose', 'btnVisPreviewClose',
    // Dynamically created via document.createElement in app-notifications.js
    'pushTemplatesModal', 'tplCancel', 'tplSave', 'tplName', 'tplTitle', 'tplBody', 'tplList',
]);

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
    // Dynamically created via document.createElement in _openTemplatesModal - not in static HTML
    const dynamicIds = new Set(['pushTemplatesModal', 'tplCancel', 'tplSave', 'tplName', 'tplTitle', 'tplBody', 'tplList']);
    const missing = [...ids].filter(id => !html.includes(`id="${id}"`) && !dynamicIds.has(id));
    assert.deepEqual(missing, [], 'ids missing from index.html: ' + missing.join(', '));
});

t('the request carries type / audience / phone (server defaults would mis-bill the send)', () => {
    assert.ok(/sendNotify\(\{[\s\S]*?\btype,/.test(js), 'type must be sent top-level');
    assert.ok(/audience:\s*aud === 'one' \? 'phone' : 'all'/.test(js), 'audience must be explicit');
    assert.ok(/aud === 'one' \? \{ phone \} : \{\}/.test(js), 'phone must travel with a single-customer send');
    assert.ok(/body:\s*JSON\.stringify\(payload \|\| \{\}\)/.test(client), 'the shared client serialises the payload as-is');
    assert.ok(/await sendNotify\(\{/.test(js), 'the tab sends through the shared client');
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
    assert.ok(/return type !== 'order' && isQuietHours\(\);/.test(js), '_quietBlocked must exempt only order type');
    const one = js.match(/if \(aud === 'one'\) \{[\s\S]*?\n    \}/);
    assert.ok(one, 'one-customer branch exists');
    assert.ok(one[0].includes('_quietBlocked(type)'), 'one-customer branch must apply quiet hours (server gates every promo entry)');
    assert.ok(/\/\/ Broadcast[\s\S]{0,400}_quietBlocked\(type\)/.test(js), 'broadcast branch must apply quiet hours');
    // Definition in the shared client + the single helper call. A second
    // direct call would bypass the gate.
    assert.equal((client.match(/isQuietHours\(\)/g) || []).length, 1, 'the shared client defines the helper once');
    assert.equal((js.match(/isQuietHours\(\)/g) || []).length, 1, 'the tab calls the shared helper once');
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
    assert.ok(/loadHistory\(\)/.test(js) && !/_loadHistory/.test(js), 'history loads with the tab');
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
    // The destructured names may grow (batch caps added CAPS/istBucketKey);
    // what must never change is that this file imports setDatabase from the
    // caps module — the whole point of the injection.
    assert.match(server, /const \{[^}]*\bsetDatabase\b[^}]*\} = require\(['"]\.\.\/bot\/notification-caps['"]\);/,
        'server imports setDatabase from the caps module');
    const initIdx = server.indexOf('admin.initializeApp(');
    const injectIdx = server.indexOf('setDatabase(admin.database())');
    assert.ok(initIdx > 0, 'initializeApp present');
    assert.ok(injectIdx > 0, 'setDatabase(admin.database()) call present');
    assert.ok(injectIdx > initIdx, `injection must come after initializeApp (init@${initIdx}, inject@${injectIdx})`);
    assert.ok(caps.includes('function setDatabase('), 'caps module exports setDatabase');
    assert.ok(/return _injectedDb \|\| ADMIN\.database\(\)/.test(caps), 'db() prefers the injected instance');
});

// --- Review round 3 (2026-11-10): test-mode send, blank composer, re-entrancy, honest stat label ---

t('a test send never carries an audience (the server rejects an empty phone before checking testMode)', () => {
    // An order-type send forces the one-customer audience; with test mode on
    // and no phone typed, the server answered 400 "A valid phone is required
    // for this audience" - the recommended first action failed.
    assert.ok(/\.\.\.\(testMode \? \{\} : \{[\s\S]{0,220}audience:/.test(js), 'audience must be gated on !testMode');
    assert.ok(/\.\.\.\(testMode \? \{\} : \{[\s\S]{0,220}\.\.\.\(aud === 'one' \? \{ phone \} : \{\}\)/.test(js), 'phone travels only with a real one-customer send');
});

t('a test send never depends on the subscriber list (test mode only needs the admin token)', () => {
    const iTest = js.indexOf('if (testMode) {');
    const iLoaded = js.indexOf('if (!_loaded)');
    const iErr = js.indexOf('if (_loadError)');
    assert.ok(iTest > 0 && iLoaded > 0 && iErr > 0, 'all three gates must exist');
    assert.ok(iTest < iLoaded && iTest < iErr,
        `test mode must be evaluated before the subscriber gates (test@${iTest}, loaded@${iLoaded}, err@${iErr})`);
});

t('the send button stays disabled until there is a title and a message', () => {
    assert.ok(/const contentOk = !!/.test(js), 'content gate must be computed');
    assert.ok(/btn\.disabled = _sending \|\| !ev\.ok \|\| !contentOk/.test(js), 'button must be gated on content');
    assert.ok(js.includes("'Add title and message'"), 'label must say what is missing');
    // Typing has to refresh the gate, otherwise the button could never re-enable.
    const titleListener = js.match(/pushNotifTitle'\)\?\.addEventListener\('input'[\s\S]{0,220}?_syncUi\(\)/);
    assert.ok(titleListener, 'title input must re-run _syncUi');
    const bodyListener = js.match(/pushNotifBody'\)\?\.addEventListener\('input'[\s\S]{0,220}?_syncUi\(\)/);
    assert.ok(bodyListener, 'body input must re-run _syncUi');
});

t('a second tap while the confirm is open cannot queue a second send', () => {
    const fn = js.match(/async function _sendPushNotification\(\) \{[\s\S]{0,400}/);
    assert.ok(fn && fn[0].includes('if (_sending) return;'), 'early return while a send is in flight');
});

t('the subscription stat says "Last updated" (updatedAt is not an app-open signal)', () => {
    assert.ok(html.includes('>Last updated</span>'), 'honest label in the markup');
    assert.ok(!/>Last active<\/span>/.test(html), 'no overstated label');
});

// Batch 23d-2: the live send path called `_loadPushSubscriptions()` /
// `_loadHistory()`, which do not exist (the real names have no underscore), so
// every successful send overwrote its own result with a ReferenceError. A call
// to an undefined name is invisible to every static bundler — pin the names.
t('the send path refreshes through functions that exist', () => {
    assert.ok(!/_loadPushSubscriptions|_loadHistory/.test(js), 'no call to the phantom underscored names');
    assert.ok(/export async function loadPushSubscriptions\(/.test(js), 'loadPushSubscriptions is defined');
    assert.ok(/export async function loadHistory\(/.test(js), 'loadHistory is defined');
    assert.ok(/await loadPushSubscriptions\(\);\s*\n\s*await loadHistory\(\);/.test(js),
        'the post-send refresh awaits both defined functions');
});

// --- Audit round 4 (2026-11-16): CB1-CB5 - the Push pane must not promise
// more than the server can deliver, and it must not offer actions the
// platform cannot perform.

t('CB1: "Offers reachable" counts only subscribers the server can push to (token + offers on)', () => {
    assert.ok(/function _reachable\(type\)/.test(js), '_reachable helper exists');
    assert.ok(/s\.hasToken && \(!marketing \|\| s\.offers\)/.test(js), 'a record without a device token is not reachable');
    assert.ok(/pushOffersReach'\)\.textContent = String\(reach\)/.test(js), 'the stat uses the reachable set');
    assert.ok(/_reachable\('promo'\)\.length/.test(js), 'the stat is computed from the reachable set');
    // The server pushes to `entries.map(e => e.token).filter(Boolean)`.
    const server = fs.readFileSync(path.join(root, 'FIREBASE_SERVER_MIGRATION/functions/src/api/tenantNotify.ts'), 'utf8');
    assert.ok(/entries\.map\([^\n]*e\.token\)\.filter\(Boolean\)/.test(server), 'server pushes only to records with a token');
});

t('CB1: a one-customer send is blocked when the record has no device token', () => {
    const one = js.match(/if \(aud === 'one'\) \{[\s\S]*?\n    \}/);
    assert.ok(one, 'one-customer branch exists');
    assert.ok(/devices === 0/.test(one[0]), 'the branch must check for a token');
    assert.ok(/has no push token on file/.test(one[0]), 'the reason must name the missing token');
});

t('CB2: the count is an upper bound ("up to") and the daily limit is stated', () => {
    assert.ok(/Will reach up to \$\{ev\.count\} of \$\{total\}/.test(js), 'the reach line must say "up to"');
    assert.ok(/Send to up to \$\{ev\.count\} subscriber/.test(js), 'the button label must say "up to"');
    assert.ok(/up to \$\{ev\.count\} subscriber\$\{ev\.count === 1 \? '' : 's'\}\?/.test(js), 'the confirm dialog must say "up to"');
    assert.ok(js.includes('up to 3 offer pushes a day'), 'the daily cap must be stated');
    assert.ok(/skipped \(daily limit\)/.test(js), 'a capped recipient is reported as a daily-limit skip');
});

t('CB3: quiet hours are anchored to the server clock, not the device clock', () => {
    assert.ok(/export async function syncServerClock\(\)/.test(client), 'clock sync helper exists in the shared client');
    assert.ok(/payload\.iat/.test(client), 'the server clock comes from the Auth token iat claim');
    assert.ok(/export function istHour\(\)[\s\S]{0,160}_clockSkewMs/.test(client), 'the IST hour uses the server offset');
    assert.ok(!/getUTCHours\(\) \+ 5/.test(client), 'the old device-clock arithmetic must be gone');
    assert.ok(!/getUTCHours\(\) \+ 5/.test(js), 'the old device-clock arithmetic must be gone from the tab');
    assert.ok(/await syncServerClock\(\);/.test(js), 'the pane syncs the clock before it evaluates a send');
});

t('CB4: a test send says it ignores quiet hours and the daily limit', () => {
    assert.ok(js.includes('ignore quiet hours and the daily limit'), 'the test-mode note must state the carve-out');
    assert.ok(/pushTestHint'\)[\s\S]{0,400}ignore quiet hours/.test(js), 'the test hint states it too');
});

t('CB5: no fake recall - notifyLog is server-written and read-only for the client', () => {
    assert.ok(!/notifyLog\/\$\{|update\(Outlet\.ref\(`notifyLog/.test(js), 'the client must not write notifyLog');
    assert.ok(!/recalled: true/.test(js), 'no fake recall flag');
    assert.ok(/logChange\(\s*'recall'/.test(js), 'the flag writes an audit entry instead');
    assert.ok(js.includes('cannot be pulled back'), 'the copy must say a delivered push cannot be pulled back');
    assert.ok(/push notification/.test(js), 'the audit target names the push');
    // The Activity trail needs a label for the new action.
    const appJs = fs.readFileSync(path.join(root, 'Admin/js/features/customer-app.js'), 'utf8');
    assert.ok(/recall: 'Flagged'/.test(appJs), 'the Activity trail labels the recall action');
});

t('the reach note has markup and a style (PurgeCSS drops unused classes)', () => {
    assert.ok(html.includes('id="pushReachText"') && html.includes('id="pushReachNote"'), 'reach text + note ids in markup');
    assert.ok(css.includes('.push-reach__note'), 'the note class exists in the stylesheet');
    assert.ok(js.includes("$('pushReachNote')"), 'the module fills the note');
});

console.log(failed ? `\n${failed} check(s) failed` : '\napp notifications guard ok');
process.exit(failed ? 1 : 0);
