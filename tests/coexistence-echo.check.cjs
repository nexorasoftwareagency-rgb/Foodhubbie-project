#!/usr/bin/env node
/**
 * Coexistence echo guard (batch 23p).
 *
 *   node tests/coexistence-echo.check.cjs
 *
 * With the number on the WhatsApp Business App AND the Cloud API (Path B
 * companion mode), every message the restaurant sends from the phone comes back
 * as `smb_message_echoes` — `value.message_echoes`, and an EMPTY `messages`
 * array. Before this batch the webhook logged "nothing to route" and dropped it,
 * so the Admin Chat tab showed the customer as unanswered and the operator
 * answered a second time.
 *
 * Pins:
 *   - The echo branch is handled BEFORE the `messages` branch and never reaches
 *     `enqueueInbox` — feeding an echo to the inbound handler would run the state
 *     machine on the business's own number and the bot would answer itself.
 *   - The tenant comes from `phoneNumberIndex/{metadata.phone_number_id}`, never
 *     from a field in the payload.
 *   - The thread row is written through the vendored `chat-log-core`
 *     (`makeTenantChatLog`) with `from:'app'`, and an echo also records
 *     `whatsapp/coexistence` — it is the definitive proof coexistence is ON.
 *   - `revoke` / `edit` / `reaction` are not new messages; an echo without `to`
 *     cannot be threaded and is skipped (no invented customer id).
 *   - `chat-log-core`: a customer message increments `unread`; a reply from the
 *     phone CLEARS it (that staff member plainly read the thread); a bot reply
 *     leaves it alone. The `chatMeta` mirror always matches `chats/{id}/meta`.
 *   - Admin renders `from:'app'` as an outgoing, labelled bubble — otherwise it
 *     looks like a customer message on the wrong side of the conversation.
 *   - Rules allow `'app'` in the message validate.
 *
 * No network, no credentials.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// `path.resolve` (not `join`) so a mutation self-test can point at an absolute
// copy of a reverted file outside the repo.
const read = (p) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Overrides let the mutation self-test point at reverted copies. */
const WEBHOOK = process.env.WEBHOOK_FILE || 'FIREBASE_SERVER_MIGRATION/functions/src/api/whatsappWebhook.ts';
const FACTORY = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/whatsapp/factory.ts';
const CHATLOG = process.env.CHATLOG_FILE || 'bot/chat-log-core.js';
const CHATJS = process.env.CHATJS_FILE || 'Admin/js/features/chat.js';
const CHATCSS = process.env.CSS_FILE || 'Admin/chat.css';
const RULES = process.env.RULES_FILE || 'database.rules.json';
const VENDOR = 'FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs';

let pass = 0;
let total = 0;
const ok = (label, cond, detail) => {
  total++;
  if (!cond) {
    console.error('  FAIL  ' + label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
    process.exitCode = 1;
    return;
  }
  pass++;
  console.log('  ok  ' + label);
};

// ---------------------------------------------------------------------------
// 1. Webhook — the echo path
// ---------------------------------------------------------------------------
const webhookSrc = stripComments(read(WEBHOOK));

const echoAt = webhookSrc.indexOf('change.message_echoes');
const messagesAt = webhookSrc.indexOf('const phoneNumberId = change.metadata?.phone_number_id');
ok('Webhook reads change.message_echoes', echoAt > 0);
ok('Echo branch runs BEFORE the customer-messages branch', echoAt > 0 && messagesAt > echoAt, { echoAt, messagesAt });

const echoSlice = echoAt > 0 && messagesAt > echoAt ? webhookSrc.slice(echoAt, messagesAt) : '';

ok('Echo branch routes on phoneNumberIndex (tenant from the number, not the payload)',
  /phoneNumberIndex\/\$\{echoPhoneId\}/.test(echoSlice) || /phoneNumberIndex\/' \+ echoPhoneId/.test(echoSlice), echoSlice.slice(0, 160));
ok('Echo branch NEVER enqueues into webhookInbox', echoSlice.length > 0 && !/enqueueInbox/.test(echoSlice));
ok('Echo branch ends with continue (no fall-through into enqueue)',
  /continue;/.test(echoSlice.trim().slice(-400)));
ok('Echo is written through the vendored chat log (makeTenantChatLog)',
  /makeTenantChatLog\(/.test(echoSlice));
ok('Echo is stored as from: app', /from:\s*'app'/.test(echoSlice));
ok('Echo records whatsapp/coexistence',
  /recordCoexistence\(/.test(echoSlice) && /whatsapp\/coexistence/.test(webhookSrc));
ok('revoke / edit / reaction are skipped', /\.revoke/.test(echoSlice) && /\.edit/.test(echoSlice) && /'reaction'/.test(echoSlice));
ok('An echo without `to` is skipped, no invented thread id',
  /MessageId|Missing `to`|missing .to./.test(echoSlice) && /continue;/.test(echoSlice));
ok('Echo text covers text, captions, button and interactive replies',
  /text\?\.body/.test(webhookSrc)
  && /image\?\.caption/.test(webhookSrc)
  && /button\?\.text/.test(webhookSrc)
  && /interactive\?\.button_reply\?\.title/.test(webhookSrc));
ok('Factory exposes makeTenantChatLog', /export function makeTenantChatLog/.test(read(FACTORY)));
ok('chat-log-core is in the vendor list', /'bot\/chat-log-core\.js'/.test(read(VENDOR)));

// ---------------------------------------------------------------------------
// 2. chat-log-core — unread semantics
// ---------------------------------------------------------------------------
const { createChatLog, customerIdFromJid } = require(path.resolve(ROOT, CHATLOG));

function makeDb() {
  const store = {};
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const ref = (p) => ({
    set: async (v) => { store[p] = clone(v); },
    transaction: async (fn) => {
      const cur = store[p] === undefined ? null : clone(store[p]);
      const next = fn(cur);
      if (next === undefined || next === null) {
        return { committed: false, snapshot: { val: () => cur } };
      }
      store[p] = clone(next);
      return { committed: true, snapshot: { val: () => clone(store[p]) } };
    },
  });
  return { db: { ref }, store };
}

(async () => {
  const { db, store } = makeDb();
  const log = createChatLog({ db, resolvePath: (p) => `t/${p}`, now: () => 1000 });
  // Same convention the ORDER path uses: last 10 digits (919812345678 -> 9812345678).
  const CID = customerIdFromJid('919812345678');
  const META = `t/chats/${CID}/meta`;
  const MIRROR = `t/chatMeta/${CID}`;
  const MSGS = `t/chats/${CID}/messages`;

  await log.logChatMessage({ jid: '919812345678', msgId: 'm1', from: 'customer', text: 'hello', name: 'Ravi' });
  const meta1 = store[META];
  ok('Customer message increments unread', meta1 && meta1.unread === 1, meta1);
  ok('Customer message stores the full jid as phone', meta1 && meta1.phone === '919812345678');
  ok('Message row carries from/customer', store[`${MSGS}/m1`]?.from === 'customer');

  await log.logChatMessage({ jid: '919812345678', msgId: 'm2', from: 'customer', text: 'again' });
  ok('Second customer message increments again', store[META]?.unread === 2);

  await log.logChatMessage({ jid: '919812345678', msgId: 'm3', from: 'bot', text: 'bot reply' });
  ok('Bot reply does NOT clear unread (automation is not a read receipt)',
    store[META]?.unread === 2, store[META]);
  ok('Bot reply keeps the thread name', store[META]?.name === 'Ravi');

  // A real Meta id is `wamid.XXX` — the dot is not a legal Firebase key, so the
  // log replaces reserved characters. Derive the expectation the same way
  // instead of hard-coding, so this check proves the mapping.
  const APP_MSG_ID = 'wamid.ABC=123';
  const APP_KEY = APP_MSG_ID.replace(/[.#$\[\]]/g, '_');
  await log.logChatMessage({ jid: '919812345678', msgId: APP_MSG_ID, from: 'app', text: 'from the phone' });
  const meta2 = store[META];
  ok('App reply clears unread', meta2 && meta2.unread === 0, meta2);
  ok('App reply sets lastDir app', meta2 && meta2.lastDir === 'app');
  ok('App reply row carries from/app',
    store[`${MSGS}/${APP_KEY}`]?.from === 'app',
    Object.keys(store).filter((k) => k.startsWith(MSGS + '/')));
  ok('chatMeta mirror equals chats/{id}/meta',
    JSON.stringify(store[MIRROR]) === JSON.stringify(meta2));

  await log.logChatMessage({ jid: '919812345678', msgId: 'm1', from: 'customer', text: 'hello' });
  const msgKeys = Object.keys(store).filter((k) => k.startsWith(MSGS + '/'));
  ok('Replayed msgId does not duplicate the row', msgKeys.length === 4, msgKeys);

  const before = JSON.stringify(store);
  await log.logChatMessage({ jid: '', msgId: 'x', from: 'customer', text: 'no jid' });
  await log.logChatMessage({ jid: '123', msgId: 'x', from: 'customer', text: 'too short' });
  ok('Unusable jid writes nothing', JSON.stringify(store) === before);

  // -------------------------------------------------------------------------
  // 3. Admin render
  // -------------------------------------------------------------------------
  const chatJs = stripComments(read(CHATJS));
  ok('Admin detects from: app', /m\.from === 'app'/.test(chatJs));
  ok('Admin treats app as OUTGOING (same bubble side as bot)', /const isOut = isBot \|\| isApp/.test(chatJs));
  ok('Bubble side uses isOut', /isOut \? 'out' : 'in'/.test(chatJs));
  ok('App reply is labelled in the bubble (via app)', /chat-src-app/.test(chatJs) && /Business App/.test(chatJs));
  ok('Thread-list preview counts an app reply as outgoing',
    /meta\.lastDir === 'app'/.test(chatJs));
  ok('CSS styles the app label', /\.chat-src-app\s*\{/.test(read(CHATCSS)));

  // -------------------------------------------------------------------------
  // 4. Rules
  // -------------------------------------------------------------------------
  const rules = JSON.parse(read(RULES));
  const messages = rules?.rules?.businesses?.$businessId?.outlets?.$outletId?.chats?.$customerId?.messages?.$msgId;
  const validate = String(messages?.['.validate'] || '');
  ok("Rules allow from == 'app'", /== 'app'/.test(validate), validate);

  console.log(`\ncoexistence-echo guard ${pass}/${total} passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
  process.exit(process.exitCode || 0);
})().catch((err) => {
  console.error('\ncoexistence-echo guard CRASHED:', err && err.stack || err);
  process.exit(1);
});
