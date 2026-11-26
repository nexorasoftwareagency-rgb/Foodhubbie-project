/**
 * onBotCommand - RTDB Trigger (batch 23o: operator replies leave from Functions)
 *
 * Drains `businesses/{bid}/outlets/{oid}/bot/commands/{commandId}` - the queue
 * every dashboard writes when a human sends a WhatsApp message:
 *   Admin Chat tab            SEND_GENERIC_MESSAGE
 *   Analytics (mobile)        SEND_GENERIC_MESSAGE
 *   Riders / rider analytics  SEND_GENERIC_MESSAGE
 *   Promotions                SEND_PROMOTION  (batch 23q - see below)
 *
 * The bot's listener (`bot/index.js initCommandListener`) is socket-only, so a
 * reply an operator sends while the box is down sits in the queue for ever and
 * the Chat tab keeps showing it as "queued". This trigger ports the
 * `SEND_GENERIC_MESSAGE` branch and, since batch 23q, the `SEND_PROMOTION`
 * hand-off.
 *
 * TWO INDEPENDENT SWITCHES, on purpose:
 *
 *   `config/botCommands/enabled`   operator replies (the branch below).
 *   `config/promotionsRelay`       campaigns (`runPromotionCommand`).
 *
 * An outlet can move its chat replies into the cloud while its campaigns stay
 * on the box (or the reverse), so one flag can never imply the other.
 *
 * `SEND_PROMOTION` is a HAND-OFF, not a send loop. The campaign engine
 * (`bot/promotions-engine.js`, vendored) owns pacing, opt-out, consent, prepaid
 * tokens, template shells, the warm-up ladder and every pause reason; this
 * branch deletes the command and runs the FIRST slice so a campaign the owner
 * just launched starts in seconds instead of waiting for the next sweep tick.
 * Deleting first is safe because the campaign document - not the command - is
 * the source of truth, and `onPromotionStatus` has already indexed it: a crash
 * after the delete is recovered by the next `promotionSweep` tick. Leaving the
 * command in place would instead let the bot's own listener pick it up again if
 * the box ever came back, sending the same campaign twice.
 *
 * `SEND_DAILY_REPORT` / `SEND_WEEKLY_REPORT` / `SEND_MONTHLY_REPORT` are left
 * untouched: no client writes them (grep-verified) and the nightly
 * `dailyReports` function already owns the daily report. An unknown action is
 * never consumed: whoever owns it later still finds it.
 *
 * THREE DELIBERATE DIFFERENCES FROM THE BOT, each one fixing a defect:
 *
 *  1. TEXT FIRST, template only when Meta refuses. The bot sent the approved
 *     `proactive_promo` template first whenever the socket was `meta:`, which
 *     bills the MARKETING rate (~Rs 0.86) for a free-form reply the customer is
 *     allowed to receive inside the 24h service window (~Rs 0.115). The text is
 *     attempted first; only Graph error 131047 ("re-engagement message", i.e.
 *     outside the window) retries it as the template - the one case where a
 *     template is required. `bot/whatsapp-send.js` now carries `err.code`.
 *  2. THE FREEZE IS READ FROM RTDB. `bot/utils.js isJidFrozen` is an in-process
 *     Map; a Function has no process between invocations. The same ban-proofing
 *     state lives at `bot/chatState/{phone10}/frozenUntil`, written by
 *     `bot/inbound-flow.js`.
 *  3. THE OUTBOUND ROW IS PERSISTED. The bot logs every send from a central hook
 *     in `bot/index.js`. Without it the Chat tab's optimistic bubble vanishes on
 *     reload and the operator cannot see what they sent. The row carries the
 *     REAL Graph message id (`messages[0].id`), so it survives a reload exactly
 *     like a bot-sent message.
 *
 * AT-MOST-ONCE: RTDB triggers are at-least-once, so `_claimedAt` is claimed by
 * transaction that ABORTS when a claim already exists (returning `undefined`
 * aborts; returning the current value would still report committed). A success
 * leaves a TOMBSTONE instead of deleting the node - deleting it would let a
 * late duplicate re-create `_claimedAt` under the removed key and send twice.
 * The tombstone drops `phone`/`message` (RTDB deletes a null field) and keeps
 * `_claimedAt`/`_doneAt`/`action`, so it holds no message content.
 *
 * A FAILURE stamps `_lastError`/`_failedAt` and leaves the node: the bot never
 * removed on a throw either, and a silent delete would lose the operator's
 * text. `retry` is deliberately off - a permanent Graph rejection (undeliverable
 * number) must not retry for 24 hours.
 *
 * Config flags: `config/botCommands/enabled === true` for the operator reply,
 * `config/promotionsRelay/enabled === true` for the campaign hand-off (each
 * absent = that half is a no-op and the bot keeps it). Demo tenant
 * hard-skipped.
 */
import { onValueCreated } from 'firebase-functions/v2/database';
import * as path from 'path';
import { getDB, initializeAdmin } from '../shared/firebase/admin';
import { makePromotionEngine } from '../shared/promotions/factory';
import { makeTenantChatLog, makeTenantTransport, tenantPathResolver } from '../shared/whatsapp/factory';

/* eslint-disable @typescript-eslint/no-var-requires */
// `../vendor`, not `../../vendor`: this file compiles to `lib/triggers/`, so the
// parent is `lib/` where `copy-vendor.cjs` writes `vendor/`. A shared module
// (`lib/shared/x/`) is the one that needs `../../vendor` - copying that here
// resolves to a path that does not exist and only fails when the bundle loads.
const VENDOR = path.join(__dirname, '../vendor');
const { formatJid } = require(path.join(VENDOR, 'bot/utils.js'));
const { customerIdFromJid } = require(path.join(VENDOR, 'bot/chat-log-core.js'));
/* eslint-enable @typescript-eslint/no-var-requires */

const DEMO_BUSINESS_ID = 'foodhubbie-demo';
const RELAY_FLAG = 'config/botCommands/enabled';
/**
 * The campaign switch, an OBJECT (`{enabled, sliceBudgetMs, batchSize}`) rather
 * than a boolean, because `promotionSweep` reads its ops knobs from the same
 * node. Deliberately NOT `config/botCommands`: chat replies and campaigns move
 * to the cloud independently.
 */
const PROMO_RELAY_FLAG = 'config/promotionsRelay';
/** Graph: the message would be sent outside the 24h customer-service window. */
const RE_ENGAGEMENT = 131047;

/** The engine clamps to these anyway; kept here so the flag cannot ask for more. */
const PROMO_SLICE_BUDGET_MS = 480_000;
const PROMO_BATCH_SIZE = 30;

/** `919748509436` -> `91****9436`; never log a full customer number. */
function maskPhone(v: any): string {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length < 6) return '***';
  return `${d.slice(0, 2)}****${d.slice(-4)}`;
}

function clampInt(v: any, lo: number, hi: number, dflt: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * `SEND_PROMOTION` — the hand-off to the campaign engine.
 *
 * The engine owns everything: kill switch, prepaid tokens, opt-out, consent,
 * freeze, quiet hours, the warm-up ladder, pacing and the circuit breaker. This
 * function only resolves the flag, deletes the command and runs the FIRST slice
 * so a campaign the owner just launched starts in seconds instead of waiting up
 * to a minute for `promotionSweep`.
 *
 * DELETE FIRST, and only after the flag says this relay owns campaigns:
 *  - the campaign document (indexed by `onPromotionStatus`) is the source of
 *    truth, so a crash after the delete is recovered by the next sweep tick;
 *  - leaving the command in place would let the bot's own listener send the same
 *    campaign a second time if the box ever came back.
 *
 * A duplicate Eventarc delivery re-runs against the same campaign document: the
 * lease refuses a concurrent slice and `currentIndex` has already advanced past
 * every claimed recipient, so a retry can never re-send.
 */
async function runPromotionCommand(
  bid: string,
  oid: string,
  commandId: string,
  cmd: any,
): Promise<void> {
  await initializeAdmin();
  const db = getDB();
  const tag = `[PROMO-CMD] ${bid}/${oid}`;

  // Unreadable means "stay off": the bot still owns campaigns and a failed read
  // must never look like consent.
  let flag: any = null;
  try {
    const flagSnap = await db.ref(PROMO_RELAY_FLAG).once('value');
    flag = flagSnap && typeof (flagSnap as any).val === 'function' ? (flagSnap as any).val() : null;
  } catch {
    return;
  }
  const armed = !!flag && flag.enabled === true;
  if (!armed) return;

  const budgetMs = clampInt(flag.sliceBudgetMs, 30_000, PROMO_SLICE_BUDGET_MS, PROMO_SLICE_BUDGET_MS);
  const batchSize = clampInt(flag.batchSize, 1, PROMO_BATCH_SIZE, PROMO_BATCH_SIZE);

  const resolvePath = tenantPathResolver(bid, oid);
  const commandPath = `${resolvePath('bot/commands')}/${commandId}`;
  await db.ref(commandPath).remove().catch(() => {});

  try {
    const { engine, transportError } = await makePromotionEngine(bid, oid, {
      log: (...a: any[]) => console.log(...a),
    });
    // A missing number is not an error: the engine pauses the campaign with
    // `no-number` so the owner sees why on the card.
    if (transportError) console.warn(`${tag} ${commandId}: ${transportError}`);

    // `force`: a human just pressed Send, so an inter-slice pause left over from
    // a paused-then-resumed campaign is irrelevant.
    const result = await engine.runSlice(cmd, { budgetMs, batchSize, force: true });
    console.log(
      `${tag} ${(cmd && cmd.campaignId) || commandId} -> ${(result && result.status) || 'unknown'}` +
        ` sent=${Number(result && result.sent) || 0} failed=${Number(result && result.failed) || 0}` +
        (result && result.pauseReason ? ` pause=${result.pauseReason}` : ''),
    );
  } catch (e: any) {
    // Never retried here: a permanent Graph rejection must not loop for 24 h.
    // The campaign document is still in the index, so the sweep owns the retry.
    console.error(`${tag} ${commandId} slice failed: ${(e && e.message) || e}`);
  }
}

export const onBotCommand = onValueCreated(
  {
    ref: 'businesses/{bid}/outlets/{oid}/bot/commands/{commandId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    secrets: ['FIREBASE_DATABASE_URL', 'WA_PERMANENT_TOKEN'],
  },
  async (event) => {
    const { bid, oid, commandId } = event.params;
    if (bid === DEMO_BUSINESS_ID) return;

    const cmd = event.data && event.data.val();
    if (!cmd) return;

    const action = String(cmd.action || '');

    // Batch 23q: the campaign hand-off has its OWN switch and lifecycle, so it is
    // routed before the operator-reply gate. An outlet can move one half into the
    // cloud without the other.
    if (action === 'SEND_PROMOTION') {
      await runPromotionCommand(bid, oid, commandId, cmd);
      return;
    }
    // Leaf-first: only the operator reply is ported. Everything else waits.
    if (action !== 'SEND_GENERIC_MESSAGE') return;

    await initializeAdmin();

    // Config flag gate - unreadable means "stay off" (the bot keeps the job).
    try {
      const flagSnap = await getDB().ref(RELAY_FLAG).once('value');
      if (flagSnap.val() !== true) return;
    } catch {
      return;
    }

    const db = getDB();
    const resolvePath = tenantPathResolver(bid, oid);
    const commandPath = `${resolvePath('bot/commands')}/${commandId}`;
    const tag = `[BOT-CMD] ${bid}/${oid}`;

    /** Leave the command in place with the reason. Never delete on a failure. */
    const fail = async (reason: string) => {
      console.warn(`${tag} ${commandId} failed: ${reason}`);
      await db
        .ref(commandPath)
        .update({ _lastError: String(reason).slice(0, 300), _failedAt: Date.now() })
        .catch(() => {});
    };

    const jid = formatJid(cmd.phone);
    if (!jid) {
      // Parity with the bot: an unusable number is a dead command, not a
      // failure to retry. It is removed because there is nothing to send.
      console.warn(`${tag} invalid phone "${maskPhone(cmd.phone)}" - command dropped`);
      await db.ref(commandPath).remove().catch(() => {});
      return;
    }
    const customerId = customerIdFromJid(jid);
    const text = String(cmd.message || '');

    // Ban-proofing: a frozen chat gets silence for 30 minutes (inbound-flow
    // writes `frozenUntil` into RTDB because a Function cannot hold the Map).
    if (customerId) {
      const frozenSnap = await db
        .ref(resolvePath(`bot/chatState/${customerId}/frozenUntil`))
        .once('value')
        .catch(() => null);
      const until = Number((frozenSnap && frozenSnap.val()) || 0);
      if (until && until > Date.now()) {
        console.log(`${tag} frozen chat ${maskPhone(jid)} - generic message dropped`);
        await db.ref(commandPath).remove().catch(() => {});
        return;
      }
    }

    let transport: any;
    try {
      // Throws when the outlet has no number connected or the platform token is
      // missing - a half-configured tenant must never send from another number.
      // Built BEFORE the claim (batch 23n rule): a tenant that cannot send yet
      // must not burn the claim, so a later retry is still possible.
      transport = (await makeTenantTransport(bid, oid, { log: (...a: any[]) => console.log(...a) })).transport;
    } catch (e: any) {
      await fail(`no transport: ${(e && e.message) || e}`);
      return;
    }

    // At-most-once. Seeded from a read first: an admin-SDK transaction hands the
    // first attempt `null` even for an existing node (proven live in batch 23g),
    // so `cur` alone cannot be trusted to detect an existing claim. Returning
    // `undefined` aborts; returning the current value would still report a
    // commit.
    const seedSnap = await db
      .ref(`${commandPath}/_claimedAt`)
      .once('value')
      .catch(() => undefined);
    if (seedSnap === undefined) {
      await fail('could not read the claim marker');
      return;
    }
    const seed = seedSnap.val() || 0;
    const claim = await db
      .ref(`${commandPath}/_claimedAt`)
      .transaction((cur: any) => ((cur || seed) ? undefined : Date.now()))
      .catch(() => null);
    if (!claim || !claim.committed) {
      console.log(`${tag} ${commandId} already claimed - duplicate delivery ignored`);
      return;
    }

    let result: any = null;
    let via = 'text';
    try {
      result = await transport.sendMessage(jid, { text });
    } catch (e: any) {
      if (Number(e && e.code) !== RE_ENGAGEMENT) {
        await fail(`send failed: ${(e && e.message) || e}`);
        return;
      }
      // Outside the 24h window: only an approved template is deliverable.
      via = 'template';
      try {
        result = await transport.sendTemplate(jid, {
          name: process.env.PROACTIVE_TEMPLATE || 'proactive_promo',
          language: process.env.PROACTIVE_LANGUAGE || 'en',
          body: text,
        });
      } catch (e2: any) {
        await fail(`template failed: ${(e2 && e2.message) || e2}`);
        return;
      }
    }

    // The Meta cost guard returns (never throws) when the shared credit line or
    // a cap blocks the send: nothing left the building, so retry later.
    if (result && result.blocked === true) {
      await fail('blocked by the Meta cost guard');
      return;
    }

    const msgId =
      (result && result.messages && result.messages[0] && result.messages[0].id) || `cmd-${commandId}`;
    // Best-effort by construction (the core never throws); carries the real id.
    await makeTenantChatLog(bid, oid).logChatMessage({ jid, msgId, from: 'bot', text });

    // Tombstone, not delete: a late duplicate must still see the claim. Nulls
    // drop the message content, so the node keeps no phone number or text.
    await db
      .ref(commandPath)
      .update({ _doneAt: Date.now(), _via: via, phone: null, message: null })
      .catch(() => {});
    console.log(`${tag} ${via} sent to ${maskPhone(jid)}`);
  },
);
