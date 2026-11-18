/**
 * Chat-tab bot-liveness truth guard (static).
 *
 * Why this exists (2026-11-18):
 *   The Admin's WhatsApp Chat tab rendered every reply as DELIVERED ("✓✓")
 *   while it was only a COMMAND in `bot/commands`, and the liveness it
 *   showed came from a snapshot that never expires:
 *     - `Admin/js/bot-status.js` computed "online" only when RTDB delivered a
 *       new snapshot. A dead worker never writes again, so the last "Online"
 *       snapshot stayed in the client for ever - the dashboard widget claimed
 *       a bot that died a week ago was still online.
 *     - `Admin/js/features/chat.js` ignored liveness completely: the reply was
 *       painted with the delivered ticks, so a queued command looked sent.
 *
 *   The truth model now: liveness = a heartbeat younger than FRESH_MS,
 *   re-evaluated locally on a ticker; a reply that was only written to the
 *   queue renders as "queued"/"sending", never as ✓✓.
 *
 * Run: node tests/chat-bot-liveness.check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readAt = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(root, p), 'utf8');

// Env overrides so the mutation self-test can point the guard at a pre-fix copy.
const BOT_STATUS_FILE = process.env.BOT_STATUS_FILE || 'Admin/js/bot-status.js';
const CHAT_FILE = process.env.CHAT_FILE || 'Admin/js/features/chat.js';
const HTML_FILE = process.env.HTML_FILE || 'Admin/index.html';
const CSS_FILE = process.env.CSS_FILE || 'Admin/chat.css';
const SW_FILE = process.env.SW_FILE || 'Admin/sw.js';
const AUTH_FILE = process.env.AUTH_FILE || 'Admin/js/auth.js';

const botStatus = readAt(BOT_STATUS_FILE);
const chat = readAt(CHAT_FILE);
const html = readAt(HTML_FILE);
const css = readAt(CSS_FILE);
const sw = readAt(SW_FILE);
const auth = readAt(AUTH_FILE);

let pass = 0, fail = 0;
const ok = (cond, label) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label); }
};

// ---- 1. liveness is re-evaluated locally, not from a frozen snapshot -------
const freshMs = Number((botStatus.match(/FRESH_MS\s*=\s*(\d+)\s*\*\s*1000/) || [])[1] || 0);
ok(freshMs >= 90, `the heartbeat freshness window is >= 90s (found ${freshMs ? freshMs + 's' : 'none'})`);
ok(/setInterval\(/.test(botStatus),
    'bot-status.js re-checks liveness on a local timer (a dead worker writes nothing)');
ok(/_setStatus\(_rawStatus,\s*_lastSeen,\s*false\)/.test(botStatus),
    'the timer re-evaluates the stored heartbeat instead of trusting the last snapshot');
ok(/Date\.now\(\)\s*-\s*_lastSeen/.test(botStatus),
    'liveness is derived from the age of the heartbeat at read time');
ok(/SKEW_MS/.test(botStatus) && /seen > Date\.now\(\) \+ SKEW_MS/.test(botStatus),
    'a heartbeat dated in the future is rejected (the demo seeds one a year ahead)');
ok(!/const fresh = \(Date\.now\(\) - seen\)/.test(botStatus),
    'the old snapshot-only freshness calculation is gone');
ok(/new CustomEvent\('botStatusChange'/.test(botStatus),
    'the botStatusChange event is still dispatched (dashboard + promotions consume it)');

// ---- 2. the Chat tab reads the heartbeat, not the frozen pair status -------
ok(/window\._botOnline/.test(chat),
    'the Chat tab reads the heartbeat liveness global');
ok(/window\._botLastSeen/.test(chat),
    'the Chat tab reads the last heartbeat timestamp');
ok(/botStatusChange/.test(chat),
    'the Chat tab reacts to liveness changes while it is open');

// ---- 3. a queued reply never looks delivered ------------------------------
const stateExpr = (chat.match(/const state = isPending[\s\S]*?;/ ) || [])[0] || '';
ok(/isPending/.test(stateExpr),
    'the bubble renderer branches on the pending (queued) marker');
ok(stateExpr.includes('✓✓') === false || /isBot \? ' <span class="chat-ticks">✓✓/.test(stateExpr),
    'the delivered ✓✓ ticks are only on real (non-pending) bot messages');
ok(/pending:\s*true/.test(chat),
    'the optimistic echo is marked as pending (a queued command, not a delivery)');
ok(/chat-msg-state--queued/.test(chat) && /chat-msg-state--sending/.test(chat),
    'a pending bubble states whether it is queued or still sending');
ok(/chat-msg-state--demo/.test(chat),
    'in the public demo a pending bubble says it is never delivered');
ok(/Bot offline — reply queued/.test(chat),
    'sending while the bot is offline tells the admin the reply was queued');

// ---- 4. the offline state is visible, not implied --------------------------
ok(/function _renderBotStatus\(\)/.test(chat),
    'the Chat tab renders a liveness strip');
ok(/Bot offline — last heartbeat/.test(chat),
    'the strip says the bot is offline and how long the silence is');
ok(/Bot status unknown/.test(chat),
    'a missing heartbeat is reported as unknown, not as online');
ok(/Sandbox — replies are stored in this demo/.test(chat),
    'the public demo says replies are never delivered');
ok(/Bot offline — this reply will be queued/.test(chat),
    'the composer placeholder warns that the reply will be queued');

// ---- 5. markup + styles ---------------------------------------------------
ok(/id="chatBotStatus"/.test(html),
    'the liveness strip element exists in the Chat pane');
ok(/class="chat-bot-status hidden"/.test(html),
    'the strip starts hidden (shown only when there is something to say)');
ok(/\.chat-bot-status\b/.test(css) && /\.chat-bot-status\.hidden/.test(css),
    'the strip is styled and can be hidden');
ok(/\.chat-msg-state--queued/.test(css),
    'the queued bubble state is styled');
ok(/\.chat-msg-state--demo/.test(css),
    'the demo bubble state is styled');
const cssVer = (html.match(/chat\.css\?v=([\d.]+)/) || [])[1] || '';
ok(cssVer >= '5.3.33', `chat.css is version-bumped so the browser refetches it (found ${cssVer || 'none'})`);

// ---- 6. the served-file rule: a SW-served file changed -> cache bumped ----
const cacheName = (sw.match(/CACHE_NAME\s*=\s*'([^']+)'/) || [])[1] || '';
const version = (cacheName.match(/v5\.12\.(\d+)/) || [])[1];
ok(!!version && Number(version) >= 61,
    `the Admin SW CACHE_NAME is bumped to >= v5.12.61 (found ${cacheName || 'none'})`);

// ---- 7. the listener is bound to the SIGNED-IN admin's tenant --------------
// A module-eval attach resolves the tenant BEFORE auth.js has read the admin
// node (window.currentBusinessId / currentOutlet are set later), so it bound
// to the default tenant: the public demo read the pizza bot's heartbeat.
ok(/function _resolvedPath\(\)/.test(botStatus),
    'the tenant path is resolved by a helper (not hard-coded at module eval)');
ok(!/_attachListener\(\s*\)/.test(botStatus),
    'there is no eager module-eval attach (it would bind to the default tenant)');
ok(/onAuthStateChanged\(auth/.test(botStatus),
    'the listener binds only once an admin is signed in');
ok(/_authed/.test(botStatus),
    'the listener tracks whether anyone is signed in');
ok(/_resolvedPath\(\)\s*!==\s*_attachedPath/.test(botStatus),
    'the ticker re-binds when the resolved tenant changed (late auth / outlet switch)');
ok(/_attachedPath\s*=\s*path/.test(botStatus),
    'the bound tenant path is remembered so a re-bind is idempotent');
ok(/window\.__botStatusPath\s*=\s*path/.test(botStatus),
    'the bound tenant path is exposed (a support question must be answerable)');
ok(/window\.currentBusinessId/.test(botStatus) && /BUSINESS_BY_OUTLET/.test(botStatus),
    'the tenant is resolved from the signed-in business id (legacy map as fallback)');
ok(/tenantResolved/.test(botStatus) && /tenantResolved/.test(auth),
    'auth.js announces the resolved tenant and the listener re-binds on it');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
