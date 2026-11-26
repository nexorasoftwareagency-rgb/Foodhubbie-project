'use strict';
/**
 * Batch 23q - the ONE promotional campaign runner.
 *
 * Socket-free and dependency-injected so the WhatsApp bot (`bot/promotions.js`)
 * and the Cloud Functions runner (`functions/src/triggers/promotionRelay.ts` +
 * `scheduled/promotionSweep.ts`) execute literally the same bytes. This is the
 * `createOrderFinalizer` / `createLoyaltyEngine` / `createRiderPush` pattern.
 *
 * WHY SLICES: a v2 event-driven Function times out at 540 s, and a campaign
 * paces 8-15 s per recipient with a 60-120 s pause every 30. One invocation can
 * therefore never finish a 300-recipient campaign. `runSlice()` does at most
 * `batchSize` recipients (default 30) inside `budgetMs` (default 480 s), records
 * `currentIndex` BEFORE each send (at-most-once), and returns `continue: true`
 * with the `nextSliceAt` the 60-120 s batch pause becomes. The caller re-enters.
 *
 * The bot wrapper loops slices in-process so its behaviour is unchanged; the
 * cloud sweep re-enters on its next minute tick.
 *
 * NEVER import `bot/firebase`, `bot/utils`, `bot/index.js` or Baileys here: the
 * file is copied into the Functions bundle where those do not exist.
 */

const R = require('./promotions-rules');

const LEASE_TTL_MS = 90 * 1000;
const DEFAULT_BUDGET_MS = 480 * 1000;
const DEFAULT_BATCH_SIZE = 30;
const FLAG_CACHE_MS = 2000;
const DAILY_LIMIT_CACHE_MS = 5 * 60 * 1000;

function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/**
 * The one promotional send path. Template first on the official API (plain text
 * is dropped with 131047 outside the 24 h window), text/image fallback when the
 * template fails. A cost-guard block is a DROP, never a delivery: returning it
 * as success burned a prepaid token and billed Rs 1 for a message nobody got.
 *
 * @param {{isMeta: boolean, sendTemplate?: Function, sendMessage: Function}} transport
 * @param {{jid: string, text: string, mediaUrl?: string|null, sendStopMsg?: boolean,
 *          waTemplateName?: string|null, templateName?: string, language?: string}} msg
 * @param {{log?: Console}} [opts]
 */
async function sendPromoWithFallback(transport, msg, opts) {
  const log = (opts && opts.log) || console;
  if (!transport) throw new Error('promo-blocked-no-number');
  if (!transport.isMeta) throw new Error('promo-blocked-transport');
  const m = msg || {};
  const finalText = R.appendStopFooter(m.text, {
    sendStopMsg: m.sendStopMsg !== false,
    waTemplateName: m.waTemplateName,
  });

  if (typeof transport.sendTemplate === 'function') {
    try {
      const r = await transport.sendTemplate(m.jid, {
        name: m.waTemplateName || m.templateName || 'proactive_promo',
        language: m.language || 'en',
        body: finalText,
        _logChat: false,
      });
      if (r && r.blocked) throw new Error('promo-blocked-cost-guard');
      return { ok: true, via: 'template' };
    } catch (e) {
      if (e && e.message === 'promo-blocked-cost-guard') throw e;
      log.warn(`[Promo] Template send failed for ${R.maskJid(m.jid)}, text fallback: ${(e && e.message) || e}`);
    }
  }

  let content;
  if (m.mediaUrl) {
    const payload = R.isDataUri(m.mediaUrl)
      ? { image: Buffer.from(String(m.mediaUrl).split(',')[1] || '', 'base64'), caption: finalText }
      : { image: { url: m.mediaUrl }, caption: finalText };
    content = payload;
  } else {
    content = { text: finalText };
  }
  const sent = await transport.sendMessage(m.jid, content, { _logChat: false });
  if (sent && sent.blocked) throw new Error('promo-blocked-cost-guard');
  return { ok: true, via: m.mediaUrl ? 'media' : 'text' };
}

/**
 * @param {object} deps
 * @param {object} deps.db              admin/bot RTDB handle (`ref`)
 * @param {(path: string, outlet?: string) => string} deps.resolvePath
 * @param {(path: string, outlet?: string) => string} [deps.billingPath]
 * @param {string} deps.outlet
 * @param {object|null} deps.transport  `{isMeta, sendTemplate?, sendMessage}` or null
 * @param {() => Promise<object|null>} [deps.getStore]
 * @param {(phone: string) => Promise<object|null>} [deps.getCustomer]
 * @param {() => Promise<number>} [deps.getFirstLinkedAt]
 * @param {(jid: string) => Promise<boolean>} [deps.isFrozen]
 * @param {() => Promise<boolean>} [deps.isDegraded]
 * @param {() => void} [deps.beforeSend]
 * @param {() => void} [deps.onTrack]
 * @param {() => number} [deps.now]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {Function} [deps.random]
 * @param {Console} [deps.log]
 */
function createPromotionsEngine(deps) {
  const d = deps || {};
  if (!d.db || typeof d.db.ref !== 'function') throw new Error('createPromotionsEngine: db is required');
  if (typeof d.resolvePath !== 'function') throw new Error('createPromotionsEngine: resolvePath is required');

  const db = d.db;
  const resolvePath = d.resolvePath;
  const billingPath = d.billingPath || ((p, o) => resolvePath(p, o));
  const outlet = d.outlet || 'pizza';
  const transport = d.transport || null;
  const getStore = d.getStore || (async () => null);
  const getCustomer = d.getCustomer || (async () => null);
  const getFirstLinkedAt = d.getFirstLinkedAt || (async () => 0);
  const isFrozen = d.isFrozen || (async () => false);
  const isDegraded = d.isDegraded || (async () => false);
  const beforeSend = d.beforeSend || (() => {});
  const onTrack = d.onTrack || (() => {});
  const now = d.now || (() => Date.now());
  const sleep = d.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random = d.random || null;
  const log = d.log || console;

  const path = (p) => resolvePath(p, outlet);
  const campRef = (id) => db.ref(path(`bot/promotions/campaigns/${id}`));

  let _flags = { at: 0, enabled: false, kill: false };
  let _dailyLimit = { at: 0, value: R.PROMO_WARMUP_DAILY_LIMITS[0] };
  let _store = null;
  // Monotonic per-engine slice counter + a per-process random tag; together they
  // are part of the lease holder identity. The timestamp alone is not enough:
  // two runners can start the same campaign in the same millisecond, and a
  // matching holder would be read as a renew and let both slice at once.
  let sliceSeq = 0;
  const engineTag = Math.random().toString(36).slice(2, 10);

  async function readRaw(p) {
    try {
      const snap = await db.ref(p).once('value');
      return snap && typeof snap.val === 'function' ? snap.val() : null;
    } catch (_) {
      return undefined; // unreadable, callers decide
    }
  }

  async function readOnce(p) {
    return readRaw(path(p));
  }

  async function readFlags() {
    const t = now();
    if (t - _flags.at < FLAG_CACHE_MS) return _flags;
    const [enabled, kill] = await Promise.all([
      readOnce('bot/promotions/enabled'),
      readOnce('bot/promotions/killSwitch'),
    ]);
    _flags = {
      at: t,
      enabled: enabled !== undefined ? enabled !== false : false,
      kill: kill === undefined ? _flags.kill : kill === true,
    };
    return _flags;
  }

  async function dailyLimit() {
    const t = now();
    if (t - _dailyLimit.at < DAILY_LIMIT_CACHE_MS) return _dailyLimit.value;
    let firstLinkedAt = 0;
    try {
      firstLinkedAt = Number(await getFirstLinkedAt()) || 0;
    } catch (_) {}
    _dailyLimit = { at: t, value: R.warmupDailyLimit(firstLinkedAt, t) };
    return _dailyLimit.value;
  }

  async function store() {
    if (_store !== null) return _store;
    try {
      _store = (await getStore()) || {};
    } catch (_) {
      _store = {};
    }
    return _store;
  }

  async function personalize(tpl, phone) {
    if (!tpl) return '';
    let storeName = null;
    try {
      const s = await store();
      storeName = (s && s.storeName) || null;
    } catch (_) {}
    let cust = null;
    try {
      cust = await getCustomer(R.cleanPhone(phone));
    } catch (_) {}
    return R.applyPersonalization(tpl, {
      storeName,
      phone,
      name: (cust && cust.name) || null,
      lastOrderDate: (cust && cust.lastOrderDate) || null,
    });
  }

  async function logResult(campaignId, phone, jid, result) {
    try {
      await db.ref(path(`bot/promotions/logs/${campaignId}/${phone}`)).set({
        jid: jid || null,
        status: result.ok ? 'sent' : 'failed',
        sentAt: now(),
        error: result.error || null,
        couponCode: null,
      });
    } catch (e) {
      log.warn(`[Promo] Failed to write log for ${R.maskPhone(phone)}: ${(e && e.message) || e}`);
    }
  }

  async function logSkip(campaignId, phone, reason) {
    try {
      await db.ref(path(`bot/promotions/logs/${campaignId}/${phone}`)).set({
        status: 'skipped',
        sentAt: now(),
        reason,
      });
    } catch (_) {}
  }

  async function stripCampaignMedia(campaignId, reason) {
    try {
      await campRef(campaignId).update({
        mediaUrl: null,
        mediaStrippedAt: now(),
        mediaStripReason: reason,
      });
      log.log(`[Promo] Stripped inline media from ${campaignId} (${reason})`);
    } catch (e) {
      log.warn(`[Promo] Media strip failed for ${campaignId}: ${(e && e.message) || e}`);
    }
  }

  async function pause(campaignId, reason, extra) {
    const patch = Object.assign({ status: 'paused', pauseReason: reason, pausedAt: now() }, extra || {});
    try {
      await campRef(campaignId).update(patch);
    } catch (e) {
      log.error(`[Promo] Could not pause ${campaignId}: ${(e && e.message) || e}`);
    }
    return { ok: true, status: 'paused', pauseReason: reason, campaignId, continue: false };
  }

  /**
   * The per-campaign lease. Replaces `bot/promotions/lock`, which was outlet-wide
   * and therefore serialised every campaign: two campaigns could not even be
   * paused/resumed independently. A lease has a TTL so a crashed slice cannot
   * wedge the outlet for ever.
   *
   * The lease is held by a SLICE (a unique holder), not by a campaign. It used
   * to be re-entrant per `campaignId`, which made the lease useless for the one
   * race that actually happens: a normal launch writes `status: 'running'` (the
   * relay indexes it, the sweep runs it) AND a `SEND_PROMOTION` command (the
   * command handler runs it), so two runners could slice the same campaign
   * concurrently and send the same recipient twice. Only renewal presents the
   * same holder; anything else is refused until the TTL expires.
   */
  async function acquireLease(campaignId, t = now(), holder = null) {
    const me = holder || campaignId;
    try {
      const tx = await db.ref(path('bot/promotions/lease')).transaction((cur) => {
        const live = cur && Number(cur.expiresAt) > t;
        if (live && cur.holder !== me) return; // someone else is live -> abort
        return { campaignId, holder: me, acquiredAt: t, expiresAt: t + LEASE_TTL_MS };
      });
      return !!(tx && tx.committed);
    } catch (e) {
      log.warn(`[Promo] Lease acquire failed: ${(e && e.message) || e}`);
      return false;
    }
  }

  /**
   * Release the lease. With a `holder` the transaction only clears a lease that
   * slice still owns: if the TTL lapsed and another slice took it, this must not
   * hand the campaign back to two runners. Callers outside a slice omit it.
   *
   * The cold pass must return a value, not `undefined`: the Admin SDK invokes a
   * transaction with `null` even for an existing node (proven live in this repo),
   * and `undefined` aborts before the server value can arrive - which would mean
   * a lease is never released and only the TTL frees it. Returning `null` is the
   * safe seed: a CAS mismatch re-runs the callback with the real value, and only
   * then is the ownership check applied.
   */
  async function releaseLease(campaignId, holder = null) {
    try {
      await db.ref(path('bot/promotions/lease')).transaction((cur) => {
        if (cur === null || cur === undefined) return null;
        if (cur.campaignId !== campaignId) return undefined;
        if (holder && cur.holder && cur.holder !== holder) return undefined; // someone newer owns it
        return null;
      });
    } catch (_) {}
  }

  async function renewLease(campaignId, t, holder = null) {
    return acquireLease(campaignId, t, holder);
  }

  /**
   * One bounded slice.
   *
   * `cmd` is either a campaign id (sweep / status trigger) or the full
   * `bot/commands` SEND_PROMOTION payload. A self-test has NO campaign document
   * at all - the Admin writes only the command - so the command's own fields are
   * the source in that case, exactly like the bot's `runPromotionCampaign(cmd)`.
   *
   * @param {{campaignId: string, template?: string, recipients?: string[],
   *          mediaUrl?: string|null, waTemplateName?: string|null, greeting?: boolean,
   *          menuText?: string|null, menuImageUrl?: string|null, sendStopMsg?: boolean,
   *          quietHours?: object|null, isTest?: boolean}} cmd
   * @param {{budgetMs?: number, batchSize?: number, force?: boolean}} [opts]
   */
  async function runSlice(cmd, opts) {
    const o = opts || {};
    const budgetMs = clampInt(o.budgetMs, 30 * 1000, DEFAULT_BUDGET_MS, DEFAULT_BUDGET_MS);
    const batchSize = clampInt(o.batchSize, 1, DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE);
    const campaignId = cmd && cmd.campaignId;
    if (!campaignId) return { ok: false, status: 'skipped', reason: 'no-campaign' };

    const t0 = now();
    // Unique per slice: two runners of the SAME campaign must not both hold it.
    const holder = `${campaignId}#${engineTag}#${++sliceSeq}#${t0}`;
    _store = null;
    const camp = campRef(campaignId);

    // Cheap gate first: a campaign between slices must not be re-read every
    // minute - older rows can carry a base64 image and RTDB bills every byte.
    if (!o.force) {
      const gate = await camp.child('nextSliceAt').once('value').catch(() => null);
      const nextAt = Number(gate && typeof gate.val === 'function' ? gate.val() : 0) || 0;
      if (nextAt > t0) {
        return { ok: true, status: 'waiting', campaignId, nextSliceAt: nextAt, continue: false };
      }
    }

    const snap = await camp.once('value');
    const loaded = snap && typeof snap.val === 'function' ? snap.val() : null;

    // A campaign document is authoritative where it exists; a command-only
    // self-test has none. Never let an absent doc field overwrite the command.
    const pick = (key, dflt) => {
      if (loaded && loaded[key] !== undefined && loaded[key] !== null) return loaded[key];
      if (cmd && cmd[key] !== undefined && cmd[key] !== null) return cmd[key];
      return dflt;
    };
    const doc = loaded || {};
    const status = String(pick('status', cmd && cmd.isTest ? 'running' : ''));
    if (R.TERMINAL_STATUSES.includes(status)) {
      return { ok: true, status, campaignId, continue: false };
    }
    // A paused campaign is NOT resumed by the runner. The bot never did either
    // (its resume sweep only scans `running`), and auto-resuming a campaign the
    // owner paused - or one a top-up just re-armed - would send without a human
    // asking. The Admin launch path writes a fresh campaign with `running`.
    if (status === 'paused') {
      return { ok: true, status: 'paused', reason: doc.pauseReason || 'paused', campaignId, continue: false };
    }
    if (!loaded && !(cmd && Array.isArray(cmd.recipients) && cmd.recipients.length)) {
      return { ok: false, status: 'skipped', reason: 'missing-campaign', campaignId };
    }

    // ---- scheduled -> due / waiting / missed -------------------------------
    if (status === 'scheduled') {
      const sched = { runAt: pick('runAt', null) };
      const state = R.scheduledState(sched, t0);
      if (state === 'waiting') {
        return { ok: true, status: 'waiting', campaignId, nextSliceAt: Number(sched.runAt) || 0, continue: false };
      }
      if (state === 'missed') {
        await camp.update({ status: 'expired', reason: 'missed-window', lateBy: t0 - (Number(sched.runAt) || 0) });
        if (R.hasInlineMedia(doc)) await stripCampaignMedia(campaignId, 'expired');
        log.log(`[Promo] Campaign ${campaignId} expired (missed its 15 min window)`);
        return { ok: true, status: 'expired', campaignId, continue: false };
      }
    }

    // ---- outlet gates ------------------------------------------------------
    const flags = await readFlags();
    if (!flags.enabled) return pause(campaignId, R.PAUSE_REASONS.PROMO_DISABLED);
    if (flags.kill) return pause(campaignId, R.PAUSE_REASONS.KILL_SWITCH);

    if (!transport) return pause(campaignId, R.PAUSE_REASONS.NO_NUMBER);
    if (!transport.isMeta) {
      log.warn(`[Promo] Campaign ${campaignId} blocked - promotional sends are official-API (meta) only`);
      return pause(campaignId, R.PAUSE_REASONS.TRANSPORT_BLOCKED);
    }
    if (await isDegraded()) return pause(campaignId, R.PAUSE_REASONS.SESSION_DEGRADED);

    // ---- quiet hours: DEFER, never sleep -----------------------------------
    const ist = R.istNow(t0);
    const quiet = R.quietHoursState(pick('quietHours', null), ist, t0);
    if (quiet.active) {
      try {
        await camp.update({ waitingUntil: quiet.untilMs, waitingReason: 'quiet-hours' });
      } catch (_) {}
      log.log(`[Promo] Campaign ${campaignId} waiting for quiet hours (${quiet.minutesToWait.toFixed(0)} min)`);
      return { ok: true, status: 'waiting', campaignId, nextSliceAt: quiet.untilMs, continue: false };
    }
    if (doc.waitingUntil) {
      try {
        await camp.update({ waitingUntil: null, waitingReason: null });
      } catch (_) {}
    }

    // ---- lease ------------------------------------------------------------
    if (!(await acquireLease(campaignId, t0, holder))) {
      return { ok: true, status: 'waiting', campaignId, reason: 'lease-held', continue: false };
    }

    const isTest = (cmd && cmd.isTest === true) || doc.isTest === true;
    // Parity: a campaign never exceeds the daily ceiling, whatever the array.
    const list = R.normalizeRecipients(pick('recipients', [])).slice(0, R.PROMO_DAILY_LIMIT);
    const total = list.length;
    if (!total) {
      await releaseLease(campaignId, holder);
      await camp.update({ status: 'stopped', reason: 'no-recipients-on-resume', stoppedAt: t0 });
      return { ok: false, status: 'stopped', reason: 'no-recipients', campaignId, continue: false };
    }
    if (isTest) {
      // A self-test is never billed (Admin/Supreme skip `isTest`, and the
      // `test_` id prefix covers campaigns written before this flag existed).
      try {
        await camp.update({ isTest: true });
      } catch (_) {}
    }

    let sent = Number(doc.totalSent) || 0;
    let failed = Number(doc.totalFailed) || 0;
    const startIndex = Math.min(Number(doc.currentIndex) || 0, total);

    if (startIndex >= total) {
      await releaseLease(campaignId, holder);
      await camp.update({
        status: 'done',
        completedAt: t0,
        currentIndex: total,
        totalSent: sent,
        totalFailed: failed,
      });
      if (R.hasInlineMedia(doc)) await stripCampaignMedia(campaignId, 'done');
      return { ok: true, status: 'done', campaignId, sent, failed, continue: false };
    }

    // Mark running BEFORE the first send so a crash still leaves a resumable
    // record. `totalSent`/`totalFailed` are carried, never zeroed (a resume used
    // to reset the campaign's own counters to 0).
    if (doc.status !== 'running') {
      await camp.update({ status: 'running', startedAt: Number(doc.startedAt) || t0, totalSent: sent, totalFailed: failed });
    }
    if (startIndex === 0) {
      try {
        await db.ref('logs/audit').push({
          action: 'PROMO_START',
          campaignId,
          by: pick('requestedBy', 'admin'),
          timestamp: t0,
        });
      } catch (_) {}
    }

    const todayStr = ist.dateStr;
    const safeDailyLimit = await dailyLimit();
    let dailySentToday = Number(await readOnce(`bot/promotions/dailyCount/${todayStr}`)) || 0;
    log.log(`[Promo] Campaign ${campaignId} slice: index ${startIndex}/${total}, daily ${dailySentToday}/${safeDailyLimit}`);

    // Resolved once per slice: command-only test sends have these on the
    // command, resumes have them on the campaign document.
    const cfg = {
      template: pick('template', ''),
      greeting: pick('greeting', false) === true,
      menuText: pick('menuText', null),
      mediaUrl: pick('mediaUrl', null),
      menuImageUrl: pick('menuImageUrl', null),
      sendStopMsg: pick('sendStopMsg', true) !== false,
      waTemplateName: pick('waTemplateName', null),
    };

    const recent = [];
    let index = startIndex;
    let sliceSent = 0;
    // The first index this slice did NOT process. A break at the top of the
    // loop leaves one recipient unstarted; advancing past it would silently
    // drop a customer from the campaign.
    let nextIndex = startIndex;

    try {
      for (; index < total; index++) {
        // Budget guard: never start a send we cannot finish inside the runtime.
        if (now() - t0 + R.PROMO_MAX_DELAY_MS > budgetMs) break;
        if (sliceSent >= batchSize) break;
        // From here this index is PROCESSED - sent, failed, or deliberately
        // skipped (opt-out / no consent / frozen / bad number). This is also
        // what makes an all-skipped slice terminate instead of looping.
        nextIndex = index + 1;

        // F2: honour an admin Stop within 10 sends, not at the end of the slice.
        if ((index - startIndex) > 0 && (index - startIndex) % R.PROMO_HEARTBEAT_EVERY === 0) {
          const live = await camp.child('status').once('value').catch(() => null);
          const liveStatus = live && typeof live.val === 'function' ? live.val() : null;
          if (liveStatus && R.TERMINAL_STATUSES.includes(String(liveStatus))) {
            await releaseLease(campaignId, holder);
            log.log(`[Promo] Campaign ${campaignId} stopped by admin (${liveStatus})`);
            return { ok: true, status: String(liveStatus), campaignId, sent, failed, continue: false };
          }
        }

        const f = await readFlags();
        if (!f.enabled) {
          await releaseLease(campaignId, holder);
          return await pause(campaignId, R.PAUSE_REASONS.PROMO_DISABLED, { currentIndex: index, totalSent: sent, totalFailed: failed });
        }
        if (f.kill) {
          await releaseLease(campaignId, holder);
          return await pause(campaignId, R.PAUSE_REASONS.KILL_SWITCH, { currentIndex: index, totalSent: sent, totalFailed: failed });
        }
        if (await isDegraded()) {
          await releaseLease(campaignId, holder);
          return await pause(campaignId, R.PAUSE_REASONS.SESSION_DEGRADED, { currentIndex: index, totalSent: sent, totalFailed: failed });
        }
        if (!isTest && dailySentToday >= safeDailyLimit) {
          await releaseLease(campaignId, holder);
          return await pause(campaignId, R.PAUSE_REASONS.DAILY_LIMIT, {
            currentIndex: index,
            totalSent: sent,
            totalFailed: failed,
            dailyLimitApplied: safeDailyLimit,
          });
        }

        if (!isTest) {
          // Prepaid promo tokens. Fail CLOSED on an unreadable or corrupt
          // balance: `NaN <= 0` is false and would let every send through.
          // `billingPath()` already returns an absolute `walletBilling/...` path
          // (the server-only ledger), so it must not be outlet-resolved again.
          const bal = await readRaw(billingPath('tokens/balance', outlet));
          if (bal === undefined) {
            await releaseLease(campaignId, holder);
            return await pause(campaignId, R.PAUSE_REASONS.BALANCE_UNREADABLE, { currentIndex: index, totalSent: sent, totalFailed: failed });
          }
          if (!(Number(bal) > 0)) {
            await releaseLease(campaignId, holder);
            return await pause(campaignId, R.PAUSE_REASONS.NO_TOKENS, { currentIndex: index, totalSent: sent, totalFailed: failed });
          }
        }

        const phone = list[index];
        const jid = R.toJid(phone);
        if (!jid) {
          await logSkip(campaignId, phone, 'invalid-jid');
          failed++;
          continue;
        }
        if (!isTest) {
          const optedOut = await readOnce(`bot/promotions/optout/${R.cleanPhone(phone)}`);
          if (optedOut !== undefined && optedOut !== null) {
            await logSkip(campaignId, phone, 'opted-out');
            continue;
          }
          const consent = await promoConsent(phone);
          if (!consent) {
            await logSkip(campaignId, phone, 'no-consent');
            continue;
          }
          if (await isFrozen(jid, phone)) {
            await logSkip(campaignId, phone, 'frozen');
            continue;
          }
        }

        // Renew the lease BEFORE claiming this recipient. A lost lease means the
        // index stays at `index` — the next sweep will pick this recipient up.
        if (!(await renewLease(campaignId, now(), holder))) {
          return await pause(campaignId, R.PAUSE_REASONS.LOCK_LOST, { currentIndex: index, totalSent: sent, totalFailed: failed });
        }

        // Claim BEFORE the send: Eventarc is at-least-once and the sweep can be
        // re-entered, so the index must never move backwards past a send.
        await camp.update({
          currentIndex: index + 1,
          totalSent: sent,
          totalFailed: failed,
          lastHeartbeat: now(),
        });

        let text = await personalize(cfg.template, phone);
        if (cfg.greeting) {
          let name = 'there';
          try {
            const cust = await getCustomer(R.cleanPhone(phone));
            if (cust && cust.name) name = cust.name;
          } catch (_) {}
          text = R.prependGreeting(text, name);
        }
        if (cfg.menuText && String(cfg.menuText).trim().length > 0) {
          text = R.appendMenuText(text, cfg.menuText);
        }
        const media = R.pickMedia(cfg.mediaUrl || null, cfg.menuImageUrl || null);

        try {
          beforeSend();
        } catch (_) {}

        const result = await sendWithRetry(jid, text, media.mainImage, {
          sendStopMsg: cfg.sendStopMsg,
          waTemplateName: cfg.waTemplateName,
        });
        await logResult(campaignId, phone, jid, result);

        recent.push(result.ok);
        if (recent.length > R.PROMO_FAILURE_WINDOW) recent.shift();
        // Count the outcome BEFORE any early return below: a pause that trips on
        // this very send used to report one failure fewer than recipients it had
        // actually advanced past (currentIndex 10 with totalFailed 9).
        sliceSent++;
        if (result.ok) sent++;
        else failed++;
        if (R.failureRateExceeded(recent)) {
          const rate = recent.filter((ok) => !ok).length / recent.length;
          log.warn(`[Promo] Circuit breaker: ${(rate * 100).toFixed(0)}% failures over ${recent.length} sends`);
          await releaseLease(campaignId, holder);
          return await pause(campaignId, R.PAUSE_REASONS.HIGH_FAILURE_RATE, {
            currentIndex: index + 1,
            totalSent: sent,
            totalFailed: failed,
          });
        }

        if (result.ok) {
          if (!isTest) {
            dailySentToday++;
            try {
              await db.ref(path(`bot/promotions/dailyCount/${todayStr}`)).set(dailySentToday);
            } catch (_) {}
            try {
              await db.ref(billingPath('tokens/balance', outlet)).transaction((v) => Math.max(Number(v || 0) - 1, 0));
            } catch (e) {
              log.warn(`[Promo] Token decrement failed (message already sent): ${(e && e.message) || e}`);
            }
          }
          if (media.extraImage) {
            try {
              await sleep(R.menuImageDelayMs(random));
              const extra = R.isDataUri(media.extraImage)
                ? { image: Buffer.from(String(media.extraImage).split(',')[1] || '', 'base64') }
                : { image: { url: media.extraImage } };
              await transport.sendMessage(jid, extra, { _logChat: false });
              onTrack();
            } catch (e) {
              log.warn(`[Promo] Menu image failed for ${R.maskJid(jid)}: ${(e && e.message) || e}`);
            }
          }
        } else {
          if (result.error === 'promo-blocked-cost-guard') {
            await releaseLease(campaignId, holder);
            return await pause(campaignId, R.PAUSE_REASONS.META_COST_GUARD, {
              currentIndex: index + 1,
              totalSent: sent,
              totalFailed: failed,
            });
          }
        }

        if (index + 1 >= total) break;
        if (!isTest) {
          if (sliceSent >= batchSize) break;
          await sleep(R.interDelayMs(random));
        }
      }

      // ---- slice finished -------------------------------------------------
      const done = nextIndex >= total;

      if (done) {
        await camp.update({
          status: 'done',
          completedAt: now(),
          currentIndex: total,
          totalSent: sent,
          totalFailed: failed,
          nextSliceAt: null,
        });
        if (R.hasInlineMedia(doc)) await stripCampaignMedia(campaignId, 'done');
        try {
          await db.ref('logs/audit').push({ action: 'PROMO_DONE', campaignId, sent, failed, timestamp: now() });
        } catch (_) {}
        log.log(`[Promo] Campaign ${campaignId} done. sent=${sent} failed=${failed}`);
        return { ok: true, status: 'done', campaignId, sent, failed, continue: false };
      }

      // The 60-120 s batch pause becomes the inter-slice gap.
      const batchFull = sliceSent >= batchSize;
      const nextSliceAt = batchFull ? now() + R.batchPauseMs(random) : 0;
      await camp.update({
        currentIndex: nextIndex,
        totalSent: sent,
        totalFailed: failed,
        lastHeartbeat: now(),
        nextSliceAt: nextSliceAt || null,
      });
      log.log(`[Promo] Campaign ${campaignId} slice end at ${nextIndex}/${total} (sent ${sent}, failed ${failed})`);
      return { ok: true, status: 'running', campaignId, sent, failed, continue: true, nextSliceAt };
    } catch (err) {
      log.error(`[Promo] Campaign ${campaignId} crashed: ${(err && err.message) || err}`);
      try {
        await camp.update({ status: 'stopped', error: (err && err.message) || String(err), stoppedAt: now() });
      } catch (_) {}
      return { ok: false, status: 'stopped', campaignId, error: (err && err.message) || String(err), continue: false };
    } finally {
      await releaseLease(campaignId, holder);
    }
  }

  /**
   * Opt-out wins, then the customer's own app switch, then the stored consent
   * flag. Mirrors `bot/promotions.js hasPromoConsent` exactly.
   */
  async function promoConsent(phone) {
    const clean = R.cleanPhone(phone);
    const [stored, appOffers] = await Promise.all([
      readOnce(`customers/${clean}/promotionalConsent`),
      readOnce(`customers/${clean}/app/consent/offers`),
    ]);
    if (appOffers === false) return false;
    return stored === true || appOffers === true;
  }

  async function sendWithRetry(jid, text, mediaUrl, extra) {
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await sendPromoWithFallback(
          transport,
          Object.assign({ jid, text, mediaUrl }, extra || {}),
          { log }
        );
        onTrack();
        return { ok: true, attempts: attempt, via: r.via };
      } catch (err) {
        lastErr = err;
        // Outlet-wide conditions that cannot clear inside a 5 s retry.
        if (err && (err.message === 'promo-blocked-transport' || err.message === 'promo-blocked-cost-guard' || err.message === 'promo-blocked-no-number')) {
          return { ok: false, error: err.message, attempts: attempt };
        }
        log.warn(`[Promo] Attempt ${attempt}/2 failed for ${R.maskJid(jid)}: ${(err && err.message) || err}`);
        if (attempt < 2) await sleep(5000);
      }
    }
    return { ok: false, error: (lastErr && lastErr.message) || 'unknown', attempts: 2 };
  }

  /** The bot heartbeat's 30-day sweep. Never reads the whole campaigns node. */
  async function expireOldPromoLogs() {
    const t = now();
    const cutoff = t - R.PROMO_LOG_TTL_MS;
    try {
      const logsSnap = await db.ref(path('bot/promotions/logs')).once('value');
      const logs = logsSnap && typeof logsSnap.val === 'function' ? logsSnap.val() : null;
      if (logs) {
        for (const cid of Object.keys(logs)) {
          const rows = logs[cid] || {};
          const keys = Object.keys(rows);
          if (!keys.length) continue;
          if (keys.every((k) => (Number(rows[k] && rows[k].sentAt) || 0) < cutoff)) {
            await db.ref(path(`bot/promotions/logs/${cid}`)).remove();
          }
        }
      }
    } catch (e) {
      log.warn(`[Promo] Log expiry failed: ${(e && e.message) || e}`);
    }

    try {
      // Only statuses that can never send again are DELETED. `paused` is
      // deliberately excluded: it is the campaign the owner can still act on,
      // and the bot never deleted one either - it only strips dead media.
      for (const status of ['done', 'stopped', 'expired', 'aborted']) {
        const snap = await db.ref(path('bot/promotions/campaigns'))
          .orderByChild('status').equalTo(status).once('value');
        const rows = snap && typeof snap.val === 'function' ? snap.val() : null;
        if (!rows) continue;
        for (const [cid, c] of Object.entries(rows)) {
          if (R.hasInlineMedia(c) && R.campaignAgeMs(c, t) > R.PROMO_MEDIA_KEEP_AFTER_PAUSE_MS) {
            await stripCampaignMedia(cid, (c && c.pauseReason) || status);
          }
          const endedAt = Number(c && (c.completedAt || c.stoppedAt || c.startedAt)) || 0;
          if (endedAt && endedAt < cutoff) {
            await db.ref(path(`bot/promotions/campaigns/${cid}`)).remove();
          }
        }
      }
      // A paused campaign keeps its record but not a megabyte of base64.
      const pausedSnap = await db.ref(path('bot/promotions/campaigns'))
        .orderByChild('status').equalTo('paused').once('value');
      const paused = pausedSnap && typeof pausedSnap.val === 'function' ? pausedSnap.val() : null;
      if (paused) {
        for (const [cid, c] of Object.entries(paused)) {
          if (R.hasInlineMedia(c) && R.campaignAgeMs(c, t) > R.PROMO_MEDIA_KEEP_AFTER_PAUSE_MS) {
            await stripCampaignMedia(cid, (c && c.pauseReason) || 'paused');
          }
        }
      }
    } catch (e) {
      log.warn(`[Promo] Campaign expiry failed: ${(e && e.message) || e}`);
    }
  }

  return { runSlice, sendPromoWithFallback, expireOldPromoLogs, promoConsent, releaseLease };
}

module.exports = { createPromotionsEngine, sendPromoWithFallback, LEASE_TTL_MS };

// ---------------------------------------------------------------------------
// Self-check: `node bot/promotions-engine.js`
// ---------------------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  assert.throws(() => createPromotionsEngine({}), /db is required/);
  assert.throws(() => createPromotionsEngine({ db: { ref() {} } }), /resolvePath is required/);
  const e = createPromotionsEngine({ db: { ref: () => ({}) }, resolvePath: (p) => p, outlet: 'o' });
  assert.strictEqual(typeof e.runSlice, 'function');
  assert.strictEqual(typeof e.expireOldPromoLogs, 'function');
  console.log('promotions-engine self-check OK');
}
