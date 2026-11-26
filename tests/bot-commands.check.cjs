#!/usr/bin/env node
/**
 * Bot command queue guard (batch 23o).
 *
 *   node tests/bot-commands.check.cjs
 *
 * `onBotCommand` drains `bot/commands` — the queue the Admin Chat tab (and the
 * Analytics/Riders service messages) write `SEND_GENERIC_MESSAGE` into. The
 * bot's listener was socket-only, so with the box down an operator reply sat in
 * the queue for ever while the Chat tab showed it as "queued".
 *
 * Pins:
 *   - `SEND_GENERIC_MESSAGE` is the 23o branch: text first, template only on
 *     Graph 131047, RTDB freeze, claim + tombstone. Batch 23q ADDED the
 *     `SEND_PROMOTION` hand-off beside it — behind its OWN switch
 *     (`config/promotionsRelay`, an object) and delete-then-run, because the
 *     campaign document is the source of truth and the sweep recovers a crash.
 *     The report actions stay UNTOUCHED — not deleted, not claimed.
 *   - Text first; the approved template only on Graph 131047 (outside the 24h
 *     window). The bot's template-first order billed MARKETING for a free-form
 *     reply the customer was allowed to receive.
 *   - The freeze comes from RTDB (`bot/chatState/{phone10}/frozenUntil`), never
 *     `bot/utils.js isJidFrozen` (an in-process Map a Function cannot keep).
 *   - Transport is built BEFORE the claim (a tenant with no number must not
 *     burn it), the claim is a cold-seeded transaction that ABORTS on an
 *     existing claim, and only then does a send happen.
 *   - Success leaves a TOMBSTONE (never a delete: a late duplicate would
 *     re-create the claim under the removed key and send twice) and writes the
 *     real Graph message id into `chats`/`chatMeta`.
 *   - A failure stamps `_lastError`/`_failedAt` and never deletes the command.
 *   - Demo tenant hard-skipped, config flag gated, admin initialised first.
 *
 * Static source inspection. No network, no credentials.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** `SRC_FILE` / `SEND_FILE` let the mutation self-test point at a reverted copy. */
const SRC = process.env.SRC_FILE || 'FIREBASE_SERVER_MIGRATION/functions/src/triggers/botCommands.ts';
const FACTORY = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/whatsapp/factory.ts';
const INDEX = 'FIREBASE_SERVER_MIGRATION/functions/src/index.ts';
const SEND = process.env.SEND_FILE || 'bot/whatsapp-send.js';
const VENDOR = 'FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs';
const BOT = process.env.BOT_FILE || 'bot/index.js';

let pass = 0;
/** Counted, never hard-coded: a stale "40/41" total reads as a failure. */
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

const src = read(SRC);
const stripped = stripComments(src);
const factory = read(FACTORY);
const factoryStripped = stripComments(factory);
const indexSrc = read(INDEX);
const sendSrc = read(SEND);
const vendorSrc = read(VENDOR);
const botSrc = read(BOT);

// 1. Trigger shape
ok('Listens on the per-outlet bot/commands queue',
  /ref:\s*'businesses\/\{bid\}\/outlets\/\{oid\}\/bot\/commands\/\{commandId\}'/.test(stripped));
ok('onValueCreated (a command is created, never re-written)',
  /onValueCreated\(/.test(stripped) && !/onValueWritten\(/.test(stripped));

// 2. The two branches
ok('Handles SEND_GENERIC_MESSAGE',
  /'SEND_GENERIC_MESSAGE'/.test(stripped));
{
  // Batch 23q: the campaign hand-off is routed BEFORE the operator-reply gate,
  // so one half of the queue can move to the cloud without the other.
  const promoAt = stripped.indexOf("action === 'SEND_PROMOTION'");
  const genericGateAt = stripped.indexOf("!== 'SEND_GENERIC_MESSAGE'");
  ok('Routes SEND_PROMOTION to its own handler first',
    promoAt > 0 && genericGateAt > promoAt, { promoAt, genericGateAt });
  const promoFnAt = stripped.indexOf('async function runPromotionCommand');
  ok('SEND_PROMOTION has its own handler (not the operator-reply path)',
    promoFnAt > 0 && /runPromotionCommand\(bid, oid, commandId, cmd\)/.test(stripped));
  {
    // Delete-then-run: the campaign document is the source of truth, so the
    // command is removed BEFORE the slice and a crash is recovered by the sweep.
    const body = stripped.slice(promoFnAt, stripped.indexOf("!== 'SEND_GENERIC_MESSAGE'"));
    const removeAt = body.indexOf("db.ref(commandPath).remove()");
    const sliceAt = body.indexOf('engine.runSlice(');
    ok('Promo command is deleted BEFORE the slice (sweep owns recovery)',
      removeAt > 0 && sliceAt > removeAt, { removeAt, sliceAt });
    ok('Promo slice runs with force:true (a human just pressed Send)',
      /runSlice\(cmd, \{[^}]*force:\s*true/.test(body));
  }
}
{
  const guardAt = stripped.indexOf("!== 'SEND_GENERIC_MESSAGE'");
  const claimAt = stripped.indexOf('.transaction(');
  ok('An unsupported action returns BEFORE the claim (left for its own batch)',
    guardAt >= 0 && claimAt > guardAt, { guardAt, claimAt });
}
ok('An unsupported action is never removed',
  !/unsupported/i.test(stripped) || !/\.remove\(\)/.test(stripped.slice(0, stripped.indexOf('SEND_GENERIC_MESSAGE'))));

// 3. Gates + admin init order
ok('Demo tenant hard-skipped', /foodhubbie-demo/.test(stripped));
ok('Config flag gate: config/botCommands/enabled', /botCommands\/enabled/.test(stripped));
ok('Promo flag is a SEPARATE object switch (config/promotionsRelay)',
  /'config\/promotionsRelay'/.test(stripped) &&
  /flag\.enabled === true/.test(stripped) &&
  /flag\.sliceBudgetMs/.test(stripped));
{
  const initAt = stripped.indexOf('await initializeAdmin()');
  const firstDbAt = stripped.indexOf('getDB()');
  ok('initializeAdmin() before the first getDB()', initAt >= 0 && firstDbAt > initAt,
    { initAt, firstDbAt });
}

// 4. Freeze + ban-proofing
ok('Freeze read from RTDB bot/chatState/{phone10}/frozenUntil',
  /bot\/chatState\/\$\{customerId\}\/frozenUntil/.test(stripped));
ok('Never uses the in-process isJidFrozen map',
  !/isJidFrozen/.test(stripped));
ok('Frozen chat is dropped without a send',
  /frozen chat/.test(stripped) && /until > Date\.now\(\)/.test(stripped));

// 5. Claim ordering + shape
ok('Cold-seeded claim (read first, then transaction)',
  /_claimedAt/.test(stripped) &&
  /const seed = seedSnap\.val\(\) \|\| 0/.test(stripped) &&
  /\(cur \|\| seed\) \? undefined : Date\.now\(\)/.test(stripped));
{
  const transportAt = stripped.indexOf('makeTenantTransport(');
  const claimAt = stripped.indexOf('.transaction(');
  ok('Transport is built BEFORE the claim (no number = no burnt claim)',
    transportAt >= 0 && claimAt > transportAt, { transportAt, claimAt });
}
{
  const claimAt = stripped.indexOf('.transaction(');
  const sendAt = stripped.indexOf('sendMessage(');
  ok('Claim happens BEFORE the first send', claimAt >= 0 && sendAt > claimAt, { claimAt, sendAt });
}
ok('A lost claim does not send',
  /if \(!claim \|\| !claim\.committed\)/.test(stripped));

// 6. Text first, template only on re-engagement
{
  const textAt = stripped.indexOf('sendMessage(');
  const tplAt = stripped.indexOf('sendTemplate(');
  ok('Text send comes before the template fallback', textAt >= 0 && tplAt > textAt, { textAt, tplAt });
}
ok('Template fallback gated on Graph 131047',
  /RE_ENGAGEMENT\s*=\s*131047/.test(stripped) && /Number\(e && e\.code\) !== RE_ENGAGEMENT/.test(stripped));
ok('Template is the approved proactive shell with the message as {{1}}',
  /proactive_promo/.test(stripped) && /body: text/.test(stripped));
ok('A cost-guard block is treated as not sent',
  /result\.blocked === true/.test(stripped) && /Meta cost guard/.test(stripped));

// 7. Chat row + tombstone
ok('Outbound row via the shared chat-log core',
  /makeTenantChatLog\(bid, oid\)\.logChatMessage/.test(stripped) &&
  /from: 'bot'/.test(stripped));
ok('Row carries the real Graph message id',
  /result\.messages\[0\]\.id/.test(stripped));
ok('Success leaves a tombstone that drops phone + message content',
  /_doneAt/.test(stripped) && /phone: null/.test(stripped) && /message: null/.test(stripped));
{
  const doneAt = stripped.indexOf('_doneAt');
  const tail = stripped.slice(doneAt);
  ok('The success path never deletes the command (claim must survive)',
    doneAt > 0 && tail.indexOf('.remove(') === -1);
}
ok('A failure stamps _lastError/_failedAt and keeps the command',
  /_lastError/.test(stripped) && /_failedAt/.test(stripped));

// 8. Runtime contract
ok('Secrets: FIREBASE_DATABASE_URL + WA_PERMANENT_TOKEN',
  /secrets:\s*\['FIREBASE_DATABASE_URL',\s*'WA_PERMANENT_TOKEN'\]/.test(stripped));
ok('Functions region us-central1', /region:\s*'us-central1'/.test(stripped));
ok('Demo flag + phone are never logged in full',
  /function maskPhone/.test(stripped) &&
  !stripped.replace(/(?:maskPhone|formatJid)\(cmd\.phone\)/g, '').includes('cmd.phone'));

// 9. The seams this relies on
ok('Factory exports tenantPathResolver',
  /export function tenantPathResolver/.test(factoryStripped));
ok('Factory exports makeTenantChatLog',
  /export function makeTenantChatLog/.test(factoryStripped));
ok('makeInboundFlow reuses tenantPathResolver (one path rule)',
  /const resolvePath = tenantPathResolver\(bid, oid\)/.test(factoryStripped));
ok('Graph errors now carry code/subcode/status',
  /err\.code = data\.error\.code/.test(sendSrc) &&
  /err\.subcode = data\.error\.error_subcode/.test(sendSrc) &&
  /err\.status = status/.test(sendSrc));
ok('Vendored: bot/utils, bot/chat-log-core, bot/whatsapp-send',
  /'bot\/utils\.js'/.test(vendorSrc) &&
  /'bot\/chat-log-core\.js'/.test(vendorSrc) &&
  /'bot\/whatsapp-send\.js'/.test(vendorSrc));
// A trigger compiles to lib/triggers/, so its vendor dir is ../vendor.
// `../../vendor` resolves to functions/vendor (nonexistent) and only fails at
// bundle load, i.e. the whole deploy dies after a green build.
ok('Trigger resolves the vendor dir from lib/triggers (../vendor)',
  /const VENDOR = path\.join\(__dirname, '\.\.\/vendor'\)/.test(stripped));

// 10. One writer per path: the bot stands down for these two branches only
const botGenericAt = botSrc.indexOf('cmd.action === "SEND_GENERIC_MESSAGE"');
const botPromoAt = botSrc.indexOf('cmd.action === "SEND_PROMOTION"');
const botRemoveAt = botSrc.indexOf('await snap.ref.remove()', botGenericAt);
{
  ok('Bot reads the same one switch (config/botCommands/enabled)',
    /async function isBotCommandRelayEnabled/.test(botSrc) &&
    /ref\('config\/botCommands\/enabled'\)/.test(botSrc));
  const gateAt = botSrc.indexOf('isBotCommandRelayEnabled()', botGenericAt);
  const jidAt = botSrc.indexOf('formatJid(cmd.phone)', botGenericAt);
  ok('Bot leaves the generic command for the cloud (gate before any send)',
    botGenericAt > 0 && gateAt > botGenericAt && jidAt > gateAt, { botGenericAt, gateAt, jidAt });
  {
    const gateTail = botSrc.slice(gateAt, jidAt);
    ok('Bot RETURNS so the shared remove() is skipped', /return;/.test(gateTail), gateTail.slice(0, 120));
  }
  // Batch 23q: campaigns are the cloud's while `config/promotionsRelay/enabled`
  // is exactly true; every other state (absent/false/unreadable) keeps the bot.
  ok('Bot reads the promo switch (config/promotionsRelay/enabled)',
    /async function isPromotionsRelayEnabled/.test(botSrc) &&
    /ref\('config\/promotionsRelay\/enabled'\)/.test(botSrc) &&
    /catch\s*\{\s*[^}]*_promotionsRelayCache = \{ at: Date\.now\(\), on: false \}/s.test(botSrc));
  {
    const promoGateAt = botSrc.indexOf('isPromotionsRelayEnabled()', botPromoAt);
    const promoRunAt = botSrc.indexOf('runPromotionCampaign', botPromoAt);
    ok('Bot leaves SEND_PROMOTION for the cloud relay (gate before the run)',
      botPromoAt > 0 && promoGateAt > botPromoAt && promoRunAt > promoGateAt,
      { botPromoAt, promoGateAt, promoRunAt });
    const promoGateTail = botSrc.slice(promoGateAt, promoRunAt);
    ok('Bot RETURNS so the shared remove() is skipped for promos too',
      /return;/.test(promoGateTail), promoGateTail.slice(0, 140));
  }
  ok('Bot remove() still runs after the branch chain',
    botRemoveAt > botGenericAt && /^\s*\/\/ Remove the command after processing/m.test(botSrc.slice(botRemoveAt - 120, botRemoveAt)));
  ok('The bot branch this ports is still the record of behaviour',
    /isJidFrozen/.test(botSrc) && /formatJid\(cmd\.phone\)/.test(botSrc));
}

// 11. Deployed surface
ok('Exported from functions/src/index.ts',
  /onBotCommand/.test(indexSrc) && /from '.\/triggers\/botCommands'/.test(indexSrc));

console.log(`\nbot-commands guard ${pass}/${total} passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
