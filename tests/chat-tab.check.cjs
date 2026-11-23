/**
 * Chat tab guard (tests/chat-tab.check.cjs)
 * ============================================================================
 * Pins the invariants that broke the WhatsApp (Chat) tab in production:
 *   - the thread list reads the flat chatMeta mirror through query()
 *     (a Reference has no .orderByChild — that bug left the list empty on
 *     every open for months; see tests/admin-query-chain.check.cjs);
 *   - message bodies bind only for the ONE open thread (never the list);
 *   - replies go through the existing bot/commands channel (no new send path);
 *   - the bot-onboarding wall is dismissible — chat history must stay
 *     reachable while the bot is stopped / awaiting a QR re-pair
 *     (pair.status is frozen state, not a live heartbeat).
 *
 * AND the WhatsApp-style contact-management invariants:
 *   - the Chat tab must NOT read the block list through a global owned by
 *     the lazily-imported Settings module (that made Block Contact a no-op);
 *   - the block list must be stored in the canonical digit form the bot's
 *     isBlockedJid() actually matches;
 *   - labels/archive must live in chatState, NOT in chatMeta — the bot
 *     overwrites chatMeta with .set() on every inbound message;
 *   - a reply outside the 24h customer-service window must cost a second,
 *     deliberate confirmation (it is billed as a service message).
 *
 * Run: node tests/chat-tab.check.cjs   (npm run test:chat-tab)
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const src = read('Admin/js/features/chat.js');
const html = read('Admin/index.html');
const contacts = read('Admin/js/chat-contacts.js');
const math = read('Admin/js/chat-contacts-math.js');
const settings = read('Admin/js/features/settings.js');
// The WRITER, not the binding: since batch 23m the persistence lives in
// `bot/chat-log-core.js` (socket-free, shared with Cloud Functions) and
// `bot/chat-log.js` only supplies the bot's database handle.
const chatLog = read('bot/chat-log-core.js');
const botUtils = read('bot/utils.js');
const rules = JSON.parse(read('database.rules.json'));
const OUTLET_RULES = rules.rules.businesses['$businessId'].outlets['$outletId'];

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  PASS ' + msg); else { console.error('  FAIL ' + msg); fails++; } };

// Strip comments so the negative checks judge CODE, not prose — chat.js and
// settings.js both quote the old buggy call in their explanatory comments.
// Normalize CRLF first: `.` does not match `\r`, so an anchored `.*$` never
// reaches the end of a CRLF line.
function stripComments(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
        .split('\n')
        .map(l => l.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n');
}
const code = stripComments(src);
const codeSettings = stripComments(settings);
const codeChatLog = stripComments(chatLog);

ok(/_listener = onValue\(query\(Outlet\.ref\('chatMeta'\), orderByChild\('lastTs'\), limitToLast\(_limit\)\)/.test(src),
   'thread list = query(chatMeta, orderByChild(lastTs), limitToLast(_limit)) — never a whole-node listen');
ok(/let _limit = 50;/.test(src), 'the list query starts at 50 threads');
ok(/_limit \+= 50;/.test(src) && /_bindThreadListener\(true\)/.test(src),
   '“Load older chats” raises the limit and re-binds the listener');
ok(!/_chatRef\(''\)\s*\.\s*orderBy/.test(code), 'no Reference.orderByChild ordering (the bug class)');
ok(/onValue\(_chatRef\(`\$\{customerId\}\/messages`\)/.test(src), 'message bodies bind per open thread only');
ok(/push\(Outlet\.ref\('bot\/commands'\)\)/.test(src) && /action:\s*'SEND_GENERIC_MESSAGE'/.test(src),
   'replies go through the existing bot/commands channel');
ok(/let _onboardingDismissed = false;/.test(src), 'onboarding dismissal state exists');
ok(/_onboardingDismissed = false; \/\/ fresh visit/.test(src), 'dismissal resets on every loadChat (fresh visit sees onboarding)');
ok(/else if \(!_onboardingDismissed\) _showOnboarding\(pair\)/.test(src),
   'apply() honours dismissal — the wall cannot re-cover history mid-visit');
ok(/id="waViewHistory"/.test(src) && /_onboardingDismissed = true;/.test(src) && /_hideOnboarding\(\);/.test(src),
   'escape hatch button wired: dismiss + hide');

// ── Block list: one owner, canonical form ──────────────────────────────────
ok(!/__blockedNumbers/.test(code),
   'the Chat tab does NOT read the block list through a global owned by the lazy Settings module');
ok(!/window\.__blockedNumbers/.test(codeSettings),
   'the lazy Settings module no longer owns a block-list global');
ok(/import\s*\{[^}]*blockedContacts[^}]*\}\s*from\s*'\.\.\/chat-contacts\.js'/.test(src),
   'the Chat tab imports the shared contact module');
ok(/import\s*\{[^}]*blockedContacts[^}]*\}\s*from\s*'\.\.\/chat-contacts\.js'/.test(settings),
   'the Settings tab imports the SAME shared module (one source of truth)');
ok(/blockedContacts\.isBlocked\(_currentChatPhone\)/.test(src),
   'the block state of the open thread comes from the shared module');
ok(/export function normalizePhone/.test(math) && /\.replace\(\/\\D\/g, ''\)/.test(math),
   'phone numbers are normalised to digits (the form the bot matches)');
ok(/isBlockedJid/.test(botUtils) && /blockedSet\.has\(phone\)/.test(botUtils),
   'the bot still matches the block list by digits (unchanged contract)');
ok(/blockedContacts\.block\(phone\)/.test(src) && /blockedContacts\.unblock\(phone\)/.test(src),
   'block/unblock go through the shared module (one writer for the list)');

// ── Labels + archive live outside chatMeta ──────────────────────────────────
ok(/chatState/.test(contacts) && /chatState\//.test(contacts),
   'per-thread state (labels + archive) is stored in chatState');
// The unread counter IS legitimately written to chatMeta (the bot owns the
// row, the Admin only clears `unread`) — but label/archival fields must
// never go there, because the bot rewrites the row with set() on every
// inbound message.
ok(!/chatMeta[^;\n]*labels/i.test(code) && !/chatMeta[^;\n]*archived/i.test(code),
   'no label/archival field is written into chatMeta');
ok(/\.set\(mirrored\)/.test(codeChatLog),
   'the bot still overwrites chatMeta with set() — so chatMeta cannot hold Admin state');
ok(!/chatState/.test(codeChatLog),
   'the bot never writes chatState (the Admin owns it)');
ok(OUTLET_RULES.chatState && OUTLET_RULES.chatState['.write'] && OUTLET_RULES.chatLabels && OUTLET_RULES.chatLabels['.write'],
   'rules expose chatState + chatLabels to outlet admins');
// The rules CANNOT cap an array: Realtime Database rules have no isArray,
// no size() and no hasOnly (hasOnly is Firestore). `firebase deploy` rejects
// the whole ruleset when it sees one — which is how this was found.
// So the thread's labels are a MAP and the rules validate each label id
// against the library instead (a real integrity guarantee).
const stateRules = JSON.stringify(OUTLET_RULES.chatState);
ok(!/isArray|hasOnly/.test(stateRules),
   'the chatState rules use no Firestore-only helpers (they fail the rules deploy)');
ok(/chatLabels'?\)?\.child\(\$labelId\)\.exists\(\)/.test(stateRules) ||
   /chatLabels'\)\.child\(\$labelId\)\.exists\(\)/.test(stateRules),
   'an assigned label must exist in the label library (rules-level integrity)');
ok(/newData\.isBoolean\(\)/.test(stateRules),
   'an assigned label is stored as a boolean flag');
ok(/isBoolean\(\)/.test(stateRules) && /archived/.test(stateRules),
   'the archived flag must be a boolean');
ok(/export const MAX_LABELS = 20;/.test(math) && /MAX_LABELS/.test(contacts),
   'the client enforces the 20-label cap (WhatsApp parity)');
ok(/chatLabels\.create/.test(src) && /chatState\.toggleLabel/.test(src) && /chatState\.setArchived/.test(src),
   'labels, assignment and archive are wired to the shared module');
// The labels modal opens but nothing works if loadChat forgets to wire it —
// that exact miss shipped once, so it is pinned here.
ok(/export function loadChat\(\)[\s\S]{0,700}_wireLabelsModal\(\);/.test(src),
   'loadChat wires the labels modal (create / assign / rename / delete)');
ok(/function _wireLabelsModal\(\)[\s\S]{0,6000}#btnCreateLabel/.test(src),
   'the labels modal handles the “Add label” button');

// ── Every element the module looks up exists in the markup ───────────────────
// A missing id is a silent no-op: the modal opens and nothing happens.
// (The three wa-* ids are injected by the onboarding wall at runtime.)
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const RUNTIME_IDS = new Set(['wa-onboarding', 'wa-qr-container', 'wa-pair-status']);
const looked = [...code.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
const missing = [...new Set(looked)].filter(id => !htmlIds.has(id) && !RUNTIME_IDS.has(id));
ok(missing.length === 0,
   'every id chat.js looks up exists in Admin/index.html' + (missing.length ? ' — missing: ' + missing.join(', ') : ''));
for (const id of ['chatLabelsModal', 'chatLabelAssignList', 'chatLabelManageList', 'chatNewLabelInput',
                  'btnCreateLabel', 'chatLabelChips', 'chatLoadMore', 'chatThreadWindow', 'chatWindowNotice',
                  'btnArchiveChat', 'btnChatLabels', 'btnManageLabels', 'chatThreadLabels']) {
    ok(htmlIds.has(id), 'markup: #' + id + ' exists');
}
// A modal nested inside a hidden tab pane can never be seen (`display:none`
// on the ancestor hides it). The Blocked Contacts modal shipped inside
// #tab-settings and was therefore invisible AND unclickable from the Chat tab.
const lastMainEnd = html.lastIndexOf('</main>');
for (const id of ['blockedContactsModal', 'chatLabelsModal']) {
    const idx = html.indexOf('id="' + id + '"');
    ok(idx > lastMainEnd, 'markup: #' + id + ' lives outside the tab panes (after </main>)');
}
// The Admin modal pattern is `.modal` + `.active` — without `active` the
// modal stays invisible (visibility:hidden; pointer-events:none).
ok(/classList\.add\('active'\)/.test(code) && /classList\.remove\('active'/.test(code),
   'the chat modals are opened/closed with the .active class');

// ── 24h reply window (the cost guard) ───────────────────────────────────────
ok(/export const CUSTOMER_WINDOW_MS = 24 \* 60 \* 60 \* 1000;/.test(math),
   'the customer-service window is 24h');
ok(/export function replyWindow/.test(math) && /m\.from === 'customer'/.test(math),
   'the window opens on a CUSTOMER message only');
ok(/_guardClosedWindow\(win\)/.test(src) && /if \(!_guardClosedWindow\(win\)\) return;/.test(src),
   'a reply outside the window is stopped before it is queued');
ok(/_windowConfirmArmed/.test(src),
   'the closed-window warning needs a second, deliberate confirmation');
ok(/chatThreadWindow/.test(src) && /chatWindowNotice/.test(src),
   'the window state is shown in the header and above the composer');

// ── The maths are actually right (behavioural, not source) ───────────────────
(async () => {
    const m = await import(pathToFileURL(path.join(ROOT, 'Admin', 'js', 'chat-contacts-math.js')).href);
    const now = 1_700_000_000_000;
    const H = 3600000;

    ok(m.normalizePhone('+91 98765 43210') === '919876543210', 'normalizePhone: a 10-digit number gets the 91 prefix');
    ok(m.normalizePhone('919876543210@s.whatsapp.net') === '919876543210', 'normalizePhone: a JID reduces to digits');
    ok(m.normalizePhone('15551234567') === '15551234567', 'normalizePhone: a 12-digit non-Indian number keeps its digits');
    ok(m.normalizePhone('') === '', 'normalizePhone: an empty value stays empty');

    const open = m.replyWindow([{ from: 'customer', ts: now - H }], now);
    ok(open.open === true && open.unknown === false, 'replyWindow: open one hour after a customer message');
    const closed = m.replyWindow([{ from: 'customer', ts: now - 25 * H }], now);
    ok(closed.open === false, 'replyWindow: closed 25h after the last customer message');
    const botOnly = m.replyWindow([{ from: 'bot', ts: now - H }], now);
    ok(botOnly.unknown === true && botOnly.open === false,
       'replyWindow: our own reply does NOT open the window');
    const empty = m.replyWindow([], now);
    ok(empty.unknown === true, 'replyWindow: an empty thread has no window');
    ok(m.windowLabel(open, now).includes('23h'), 'windowLabel: shows the remaining time');
    ok(m.windowLabel(closed) === 'Reply window closed', 'windowLabel: a closed window says so');
    ok(m.labelId('Festival Orders', {}) === 'festival-orders', 'labelId: a readable storage key');
    ok(m.labelId('Festival Orders', { 'festival-orders': {} }) === 'festival-orders-2', 'labelId: never collides');

    // Deleting a label must strip it from every thread that carried it.
    // (The mapping used to be computed inside a filter callback and read in
    // the write loop — a ReferenceError at delete time.)
    const state = { a: { labels: ['vip', 'fest'], archived: false }, b: { labels: ['fest'], archived: true }, c: { labels: [], archived: false } };
    const stripped = m.stripLabelFromState(state, 'fest');
    ok(Object.keys(stripped).length === 2, 'stripLabelFromState: only the threads that carried the label are returned');
    ok(stripped.a.labels.join(',') === 'vip', 'stripLabelFromState: the label is removed');
    ok(stripped.b.archived === true, 'stripLabelFromState: the rest of the thread state is preserved');
    ok(stripped.c === undefined, 'stripLabelFromState: untouched threads are not returned');
    ok(Object.keys(m.stripLabelFromState({}, 'x')).length === 0, 'stripLabelFromState: an empty map is safe');

    if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
    console.log('\nAll chat-tab checks passed');
})();
