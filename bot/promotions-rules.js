/**
 * Batch 23q - PURE promotion rules. NO requires: this file is copied
 * byte-for-byte into the Cloud Functions bundle and unit-tested straight from
 * node, so it must never touch Firebase, the socket, or `bot/utils`.
 *
 * Everything here is a decision table or a number. The runner lives in
 * `bot/promotions-engine.js`; the bot and the cloud both use that one runner.
 *
 * Source of truth for parity: `bot/promotions.js` before batch 23q.
 *   PROMO_WARMUP_DAILY_LIMITS   warm a new number 20 -> 250 sends/day
 *   PROMO_MIN/MAX_DELAY_MS      8-15 s between recipients (anti-ban)
 *   PROMO_BATCH_*_PAUSE_MS      60-120 s every 30 sends
 *   PROMO_DAILY_LIMIT           hard cap 300 per campaign
 *   PROMO_FAILURE_*             circuit breaker: 10 samples, >35% failed
 */

const PROMO_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROMO_INLINE_MEDIA_PREFIX = 'data:';
const PROMO_MEDIA_KEEP_AFTER_PAUSE_MS = 24 * 60 * 60 * 1000;
const PROMO_HEARTBEAT_EVERY = 10;
const PROMO_PAUSE_EVERY = 30;
const PROMO_SCHEDULE_MISSED_GRACE_MS = 15 * 60 * 1000;
const PROMO_WARMUP_DAILY_LIMITS = [20, 40, 60, 100, 150, 200, 250];
const PROMO_DAILY_LIMIT = 300;
const PROMO_MIN_DELAY_MS = 8000;
const PROMO_MAX_DELAY_MS = 15000;
const PROMO_BATCH_MIN_PAUSE_MS = 60000;
const PROMO_BATCH_MAX_PAUSE_MS = 120000;
const PROMO_MENU_MIN_DELAY_MS = 1500;
const PROMO_MENU_MAX_DELAY_MS = 3000;
const PROMO_FAILURE_WINDOW = 20;
const PROMO_FAILURE_MIN_SAMPLE = 10;
const PROMO_MAX_FAILURE_RATE = 0.35;

/** One line, so the footer is identical on every shell that needs it. */
const STOP_FOOTER = '\n------------------------\n_Reply STOP to unsubscribe._';
const MENU_SEPARATOR = '\n------------------------\n';

/** These approved shells carry "Reply STOP to unsubscribe." as a template
 *  FOOTER, so appending it to the body text too would print it twice. */
const TEMPLATES_WITH_STOP_FOOTER = [
  'promo_cta_flash',
  'promo_cta_cart',
  'promo_cta_winback',
  'promo_cta_birthday',
  'promo_cta_weekend',
  'promo_cta_newitem',
];

/** Every reason a campaign can pause for. `no-number` is cloud-only (a tenant
 *  with no connected WhatsApp number can never send). */
const PAUSE_REASONS = {
  TRANSPORT_BLOCKED: 'transport-blocked',
  NO_NUMBER: 'no-number',
  META_COST_GUARD: 'meta-cost-guard',
  NO_TOKENS: 'no-tokens',
  BALANCE_UNREADABLE: 'balance-unreadable',
  KILL_SWITCH: 'kill-switch',
  PROMO_DISABLED: 'promo-disabled',
  DAILY_LIMIT: 'daily-limit',
  HIGH_FAILURE_RATE: 'high-failure-rate',
  SESSION_DEGRADED: 'session-degraded',
  LOCK_LOST: 'lock-lost',
};

/** Terminal statuses: never send again, never appear in the active index. */
const TERMINAL_STATUSES = ['done', 'stopped', 'aborted', 'expired'];

function digits(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

/** The key every per-customer node uses (last 10 digits). */
function cleanPhone(v) {
  return digits(v).slice(-10);
}

/**
 * Identical to `bot/utils.js formatJid`, kept here so the cloud bundle never
 * needs `bot/utils` (which is huge and carries a hard `./firebase` require).
 * `919812345678` -> `919812345678@s.whatsapp.net`.
 */
function toJid(phone) {
  if (!phone) return null;
  let clean = digits(phone);
  if (clean.startsWith('0')) clean = clean.substring(1);
  if (clean.length === 10) clean = '91' + clean;
  return clean.length >= 10 ? clean + '@s.whatsapp.net' : null;
}

/** Never log a full customer number. */
function maskJid(jid) {
  const raw = String(jid || '');
  if (!raw.includes('@')) return raw ? maskPhone(raw) : raw;
  const [phone, domain] = raw.split('@');
  if (phone.length <= 4) return '****@' + domain;
  return phone.substring(0, 2) + '****' + phone.slice(-4) + '@' + domain;
}

function maskPhone(v) {
  const d = digits(v);
  if (d.length < 6) return '***';
  return d.slice(0, 2) + '****' + d.slice(-4);
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function interDelayMs(random) {
  const r = random || randomBetween;
  return r(PROMO_MIN_DELAY_MS, PROMO_MAX_DELAY_MS);
}

function batchPauseMs(random) {
  const r = random || randomBetween;
  return r(PROMO_BATCH_MIN_PAUSE_MS, PROMO_BATCH_MAX_PAUSE_MS);
}

function menuImageDelayMs(random) {
  const r = random || randomBetween;
  return r(PROMO_MENU_MIN_DELAY_MS, PROMO_MENU_MAX_DELAY_MS);
}

/** IST wall clock for one instant. Mirrors `bot/utils.js getISTDateInfo`. */
function istNow(ms) {
  const t = ms == null ? Date.now() : Number(ms);
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const ist = new Date(t + IST_OFFSET);
  return {
    dateStr: ist.toISOString().split('T')[0],
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

/**
 * Warm-up ladder: a number's first day may send 20, then 40, 60, 100, 150,
 * 200, 250, and 300 from day 7. No `firstLinkedAt` (unknown age) is treated as
 * day 0, the most conservative rung.
 */
function warmupDailyLimit(firstLinkedAt, nowMs) {
  const t = nowMs == null ? Date.now() : Number(nowMs);
  const linked = Number(firstLinkedAt) || 0;
  if (!linked) return PROMO_WARMUP_DAILY_LIMITS[0];
  const days = Math.floor((t - linked) / (24 * 60 * 60 * 1000));
  if (!(days > 0)) return PROMO_WARMUP_DAILY_LIMITS[0];
  return days < PROMO_WARMUP_DAILY_LIMITS.length
    ? PROMO_WARMUP_DAILY_LIMITS[days]
    : PROMO_DAILY_LIMIT;
}

/**
 * Quiet hours, as a decision instead of a sleep.
 * `quietHours` = { start, end } in IST hours (0-23, fractions allowed).
 * Returns `{ active, minutesToWait, untilMs }`.
 *
 * `start === end` means "no window" rather than "quiet for 24 hours": the old
 * sleep loop would have stalled a campaign for a whole day on that input.
 */
function quietHoursState(quietHours, ist, nowMs) {
  if (!quietHours || quietHours.start == null || quietHours.end == null) {
    return { active: false, minutesToWait: 0, untilMs: 0 };
  }
  const s = Number(quietHours.start);
  const e = Number(quietHours.end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s === e) {
    return { active: false, minutesToWait: 0, untilMs: 0 };
  }
  const clock = ist || istNow(nowMs);
  const cur = clock.hour + clock.minute / 60;
  let inQuiet = false;
  let minutesToWait = 0;
  if (s < e) {
    inQuiet = cur >= s && cur < e;
    minutesToWait = inQuiet ? (e - cur) * 60 : 0;
  } else {
    inQuiet = cur >= s || cur < e;
    minutesToWait = cur >= s ? (24 - cur + e) * 60 : (e - cur) * 60;
  }
  const t = nowMs == null ? Date.now() : Number(nowMs);
  const active = inQuiet && minutesToWait > 0;
  return { active, minutesToWait, untilMs: active ? t + minutesToWait * 60000 : 0 };
}

/** Circuit breaker: >= 10 samples and more than 35% failed. */
function failureRateExceeded(results) {
  const list = Array.isArray(results) ? results : [];
  if (list.length < PROMO_FAILURE_MIN_SAMPLE) return false;
  const failed = list.filter((ok) => !ok).length;
  return failed / list.length > PROMO_MAX_FAILURE_RATE;
}

function hasInlineMedia(c) {
  return typeof (c && c.mediaUrl) === 'string' && c.mediaUrl.startsWith(PROMO_INLINE_MEDIA_PREFIX);
}

/** Newest timestamp a campaign has for "when did this stop being actionable". */
function campaignAgeMs(c, nowMs) {
  const t = nowMs == null ? Date.now() : Number(nowMs);
  const started = Number(c && c.startedAt) || Date.parse((c && c.createdAt) || '') || 0;
  return started ? t - started : Infinity;
}

function isHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v);
}

/**
 * Two media representations exist: an inline base64 `data:` URI (written by
 * older campaigns and by the Admin composer before upload finishes) and a
 * Storage URL (everything since batch 15). Senders must branch on this, never
 * on truthiness, or a URL is shipped as base64 and the Graph call 400s.
 */
function isDataUri(v) {
  return typeof v === 'string' && v.startsWith(PROMO_INLINE_MEDIA_PREFIX);
}

/**
 * `{storeName}`, `{phone}`, `{couponCode}`, `{name}`, `{lastOrderDate}`.
 * Same defaults as the bot: an unknown customer is "Customer" / "first time".
 */
function applyPersonalization(tpl, ctx) {
  const c = ctx || {};
  let out = String(tpl || '');
  if (c.storeName) out = out.replaceAll('{storeName}', String(c.storeName));
  out = out.replaceAll('{phone}', String(c.phone == null ? '' : c.phone));
  if (c.couponCode) out = out.replaceAll('{couponCode}', String(c.couponCode));
  out = out.replaceAll('{name}', c.name || 'Customer');
  const lod = c.lastOrderDate
    ? new Date(c.lastOrderDate).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'first time';
  out = out.replaceAll('{lastOrderDate}', lod);
  return out;
}

/** "Hi <name>," prefix, skipped when the template already opens with "Hi ". */
function prependGreeting(text, name) {
  const body = String(text || '');
  if (/^hi\s+/i.test(body)) return body;
  return 'Hi ' + (name || 'there') + ',' + MENU_SEPARATOR + body;
}

function appendMenuText(text, menuText) {
  const menu = menuText == null ? '' : String(menuText).trim();
  if (!menu) return String(text || '');
  return String(text || '') + MENU_SEPARATOR + menu;
}

/**
 * The STOP line. Skipped when the owner turned it off, when the shell already
 * carries it as a template footer, or when the body already says "stop".
 */
function appendStopFooter(text, opts) {
  const o = opts || {};
  const body = String(text || '');
  if (!o.sendStopMsg) return body;
  if (TEMPLATES_WITH_STOP_FOOTER.includes(o.waTemplateName)) return body;
  if (/stop/i.test(body)) return body;
  return body + STOP_FOOTER;
}

/** main image, then the menu image as a second message when both exist. */
function pickMedia(mediaUrl, menuImageUrl) {
  let mainImage = mediaUrl || null;
  let extraImage = null;
  if (!mainImage && menuImageUrl) {
    mainImage = menuImageUrl;
  } else if (mainImage && menuImageUrl && menuImageUrl !== mainImage) {
    extraImage = menuImageUrl;
  }
  return { mainImage, extraImage };
}

/** Recipients are phone strings; anything blank is dropped, order preserved. */
function normalizeRecipients(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => String(p == null ? '' : p).trim())
    .filter((p) => p.length > 0)
    .slice(0, PROMO_DAILY_LIMIT);
}

/**
 * A scheduled campaign is `due` inside its 15-minute grace window, `missed`
 * after it (the bot expires it rather than sending a day-old offer), and
 * `waiting` before it.
 */
function scheduledState(c, nowMs) {
  const t = nowMs == null ? Date.now() : Number(nowMs);
  const runAt = Number(c && c.runAt) || 0;
  if (!runAt) return 'waiting';
  if (runAt > t) return 'waiting';
  return t - runAt > PROMO_SCHEDULE_MISSED_GRACE_MS ? 'missed' : 'due';
}

module.exports = {
  PROMO_LOG_TTL_MS,
  PROMO_INLINE_MEDIA_PREFIX,
  PROMO_MEDIA_KEEP_AFTER_PAUSE_MS,
  PROMO_HEARTBEAT_EVERY,
  PROMO_PAUSE_EVERY,
  PROMO_SCHEDULE_MISSED_GRACE_MS,
  PROMO_WARMUP_DAILY_LIMITS,
  PROMO_DAILY_LIMIT,
  PROMO_MIN_DELAY_MS,
  PROMO_MAX_DELAY_MS,
  PROMO_BATCH_MIN_PAUSE_MS,
  PROMO_BATCH_MAX_PAUSE_MS,
  PROMO_MENU_MIN_DELAY_MS,
  PROMO_MENU_MAX_DELAY_MS,
  PROMO_FAILURE_WINDOW,
  PROMO_FAILURE_MIN_SAMPLE,
  PROMO_MAX_FAILURE_RATE,
  STOP_FOOTER,
  MENU_SEPARATOR,
  TEMPLATES_WITH_STOP_FOOTER,
  PAUSE_REASONS,
  TERMINAL_STATUSES,
  digits,
  cleanPhone,
  toJid,
  maskJid,
  maskPhone,
  randomBetween,
  interDelayMs,
  batchPauseMs,
  menuImageDelayMs,
  istNow,
  warmupDailyLimit,
  quietHoursState,
  failureRateExceeded,
  hasInlineMedia,
  campaignAgeMs,
  isHttpUrl,
  isDataUri,
  applyPersonalization,
  prependGreeting,
  appendMenuText,
  appendStopFooter,
  pickMedia,
  normalizeRecipients,
  scheduledState,
};

// ---------------------------------------------------------------------------
// Self-check: `node bot/promotions-rules.js`
// ---------------------------------------------------------------------------
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(toJid('9812345678'), '919812345678@s.whatsapp.net');
  assert.strictEqual(toJid('09812345678'), '919812345678@s.whatsapp.net');
  assert.strictEqual(toJid('919812345678'), '919812345678@s.whatsapp.net');
  assert.strictEqual(toJid('123'), null);
  assert.strictEqual(cleanPhone('+91 98123 45678'), '9812345678');
  assert.strictEqual(maskJid('919812345678@s.whatsapp.net'), '91****5678@s.whatsapp.net');

  const ist = istNow(Date.UTC(2026, 10, 23, 18, 30)); // 00:00 IST next day
  assert.strictEqual(ist.dateStr, '2026-11-24');
  assert.strictEqual(ist.hour, 0);

  const day0 = Date.UTC(2026, 10, 1, 0, 0);
  assert.strictEqual(warmupDailyLimit(day0, day0), 20);
  assert.strictEqual(warmupDailyLimit(day0, day0 + 3 * 86400000), 100);
  assert.strictEqual(warmupDailyLimit(day0, day0 + 6 * 86400000), 250);
  assert.strictEqual(warmupDailyLimit(day0, day0 + 30 * 86400000), 300);
  assert.strictEqual(warmupDailyLimit(null, day0), 20);

  const at = (h) => ({ dateStr: '2026-11-23', hour: h, minute: 0 });
  assert.strictEqual(quietHoursState(null, at(23), 0).active, false);
  assert.strictEqual(quietHoursState({ start: 22, end: 8 }, at(23), 0).active, true);
  assert.strictEqual(quietHoursState({ start: 22, end: 8 }, at(12), 0).active, false);
  assert.strictEqual(quietHoursState({ start: 22, end: 8 }, at(7), 0).active, true);
  assert.strictEqual(quietHoursState({ start: 9, end: 17 }, at(10), 0).active, true);
  assert.strictEqual(quietHoursState({ start: 9, end: 9 }, at(10), 0).active, false);

  assert.strictEqual(failureRateExceeded(new Array(9).fill(false)), false);
  assert.strictEqual(failureRateExceeded(new Array(10).fill(false)), true);
  assert.strictEqual(failureRateExceeded([false, false, false, true, true, true, true, true, true, true]), false);

  assert.strictEqual(applyPersonalization('Hi {name} at {storeName}', { name: 'Asha', storeName: 'Pizza' }), 'Hi Asha at Pizza');
  assert.strictEqual(applyPersonalization('Hi {name}', {}), 'Hi Customer');
  assert.strictEqual(applyPersonalization('{lastOrderDate}', {}), 'first time');
  assert.strictEqual(prependGreeting('Offer', 'Asha'), 'Hi Asha,\n------------------------\nOffer');
  assert.strictEqual(prependGreeting('Hi Asha, offer', 'Asha'), 'Hi Asha, offer');
  assert.strictEqual(appendStopFooter('Body', { sendStopMsg: true }), 'Body' + STOP_FOOTER);
  assert.strictEqual(appendStopFooter('Body', { sendStopMsg: false }), 'Body');
  assert.strictEqual(appendStopFooter('Body', { sendStopMsg: true, waTemplateName: 'promo_cta_flash' }), 'Body');
  assert.strictEqual(appendStopFooter('Reply STOP', { sendStopMsg: true }), 'Reply STOP');
  assert.deepStrictEqual(pickMedia(null, 'u1'), { mainImage: 'u1', extraImage: null });
  assert.deepStrictEqual(pickMedia('u1', 'u2'), { mainImage: 'u1', extraImage: 'u2' });
  assert.deepStrictEqual(normalizeRecipients(['a', ' ', null, 'b']), ['a', 'b']);

  const t0 = 1_000_000;
  assert.strictEqual(scheduledState({ runAt: t0 + 1000 }, t0), 'waiting');
  assert.strictEqual(scheduledState({ runAt: t0 - 1000 }, t0), 'due');
  assert.strictEqual(scheduledState({ runAt: t0 - 16 * 60000 }, t0), 'missed');
  assert.strictEqual(hasInlineMedia({ mediaUrl: 'data:image/png;base64,AA' }), true);
  assert.strictEqual(hasInlineMedia({ mediaUrl: 'https://x/y.png' }), false);
  assert.strictEqual(isDataUri('data:image/png;base64,AA'), true);
  assert.strictEqual(isDataUri('https://x/y.png'), false);
  assert.strictEqual(isDataUri(null), false);
  console.log('promotions-rules self-check OK');
}
