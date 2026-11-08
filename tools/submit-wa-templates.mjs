#!/usr/bin/env node
/**
 * Submit the Foodhubbie promotional template set (with in-built CTA buttons)
 * to a WhatsApp Business Account.
 *
 * Why static URL buttons: Meta allows only ONE variable in a URL button and it
 * must sit at the very end of the string, so `?b={{1}}&o={{2}}` is invalid.
 * Each restaurant owns its own WABA (Key Decision 2026-11-01), so the tenant's
 * own app link is baked in statically at submission time instead.
 *
 * Usage:
 *   node tools/submit-wa-templates.mjs --bid roshani-pizza --oid pizza --waba 2589174454849821
 *   node tools/submit-wa-templates.mjs --bid roshani-pizza --oid pizza --waba 2589174454849821 --apply
 *
 * Token: WA_PERMANENT_TOKEN from the environment, or from .env at the repo root.
 * Dry-run by default — nothing is created without --apply.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH = 'https://graph.facebook.com/v21.0';

// ── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const BID = arg('bid');
const OID = arg('oid');
const WABA = arg('waba');
const APP_HOST = arg('host', 'https://menu.foodhubbie.in');

if (!BID || !OID || !WABA) {
  console.error('Missing --bid / --oid / --waba');
  process.exit(1);
}

function readToken() {
  if (process.env.WA_PERMANENT_TOKEN) return process.env.WA_PERMANENT_TOKEN.trim();
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return '';
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*WA_PERMANENT_TOKEN\s*=\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return '';
}
const TOKEN = readToken();
if (!TOKEN) {
  console.error('No WA_PERMANENT_TOKEN (env or .env)');
  process.exit(1);
}

// ── Template set ────────────────────────────────────────────────────────────
// One body variable only — the pattern already proven to pass review on this
// WABA (promo_hinglish_offer / _discount / _festive / _winback). `{{1}}` carries
// the whole offer sentence, so the existing bot `body → {{1}}` mapping works
// unchanged. Hinglish (romanised) matches the approved shells and the audience.
const ORDER_URL = `${APP_HOST}/?b=${encodeURIComponent(BID)}&o=${encodeURIComponent(OID)}`;
const ORDER_BUTTON = { type: 'URL', text: 'Order Now', url: ORDER_URL };
// "Unsubscribe" is matched by the bot's existing opt-out regex
// /^(stop|unsubscribe|opt[\s-]?out)$/i — no code change needed.
const OPT_OUT_BUTTON = { type: 'QUICK_REPLY', text: 'Unsubscribe' };
const FOOTER = 'Reply STOP to unsubscribe.';

const TEMPLATES = [
  {
    name: 'promo_cta_flash',
    job: 'Flash sale / urgency — highest same-day ROI',
    body:
      '⚡ *FLASH SALE — Sirf Aaj!* ⚡\n\n{{1}}\n\n' +
      '_Yeh offer sirf thodi der ke liye hai — abhi order karein! 🍕_',
    example: 'Aaj raat 10 baje tak 20% off on orders above ₹499. Code FLASH20.',
  },
  {
    name: 'promo_cta_cart',
    job: 'Abandoned cart recovery — highest intent',
    body:
      '🛒 *Aapka Order Ruk Gaya!* 🛒\n\n{{1}}\n\n' +
      '_Aapka khana abhi bhi wait kar raha hai — ek click mein complete karein! 🍕_',
    example: 'Aapke cart mein Margherita + Garlic Bread hai. Aaj complete karein toh 10% off.',
  },
  {
    name: 'promo_cta_winback',
    job: 'Dormant customer reactivation (30+ days)',
    body:
      '💚 *Aapko Miss Kar Rahe Hain!* 💚\n\n{{1}}\n\n' +
      '_Wapas aa jao — aapke favourites abhi bhi menu par hain! 🍕_',
    example: 'Bahut din ho gaye! Laut ke aao toh 25% off. Code WELCOME25.',
  },
  {
    name: 'promo_cta_birthday',
    job: 'Birthday — highest open rate, emotional',
    body:
      '🎂 *Happy Birthday!* 🎂\n\n{{1}}\n\n' +
      '_Aapke liye ek special treat — valid 3 din tak! 🎁_',
    example: 'Aaj aapke birthday par ₹200 off on orders above ₹599. Code BDAY200.',
  },
  {
    name: 'promo_cta_weekend',
    job: 'Weekend volume — Fri 4 PM send',
    body:
      '🎉 *Weekend Special!* 🎉\n\n{{1}}\n\n' +
      '_Sirf Saturday & Sunday — is weekend ka maza lo! 🍕_',
    example: 'Is weekend flat ₹100 off on orders above ₹499. Code WEEKEND100.',
  },
  {
    name: 'promo_cta_newitem',
    job: 'New item launch — drive trial',
    body:
      '🆕 *Naya Item Menu Par!* 🆕\n\n{{1}}\n\n' +
      '_Sabse pehle try karein — limited stock! 🍕_',
    example: 'Paneer Tikka Wrap launch ho gaya hai! Pehle order par ₹50 off. Code NEW50.',
  },
];

function buildPayload(t) {
  return {
    name: t.name,
    category: 'MARKETING',
    language: 'en',
    components: [
      { type: 'BODY', text: t.body, example: { body_text: [[t.example]] } },
      { type: 'FOOTER', text: FOOTER },
      { type: 'BUTTONS', buttons: [ORDER_BUTTON, OPT_OUT_BUTTON] },
    ],
  };
}

// ── Local validation (catch limits before Meta does) ─────────────────────────
function validate(t) {
  const problems = [];
  if (t.body.length > 1024) problems.push(`body ${t.body.length} > 1024`);
  if (!t.body.includes('{{1}}')) problems.push('body has no {{1}}');
  if (/^\s*\{\{1\}\}/.test(t.body)) problems.push('body starts with a variable');
  if (FOOTER.length > 60) problems.push(`footer ${FOOTER.length} > 60`);
  for (const b of [ORDER_BUTTON, OPT_OUT_BUTTON]) {
    if (b.text.length > 25) problems.push(`button "${b.text}" ${b.text.length} > 25`);
  }
  if (ORDER_URL.length > 2000) problems.push('url > 2000');
  return problems;
}

// ── Graph helpers ───────────────────────────────────────────────────────────
async function graph(method, pathname, body) {
  const res = await fetch(`${GRAPH}/${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function existingTemplates() {
  const map = new Map();
  let url = `${GRAPH}/${WABA}/message_templates?limit=100`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`list failed ${res.status}: ${JSON.stringify(json)}`);
    for (const t of json.data || []) map.set(t.name, t);
    url = json.paging?.next || null;
  }
  return map;
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log(`WABA ${WABA}  ·  outlet ${BID}/${OID}`);
console.log(`CTA URL  ${ORDER_URL}`);
console.log(`mode     ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to create)'}\n`);

const problems = TEMPLATES.flatMap((t) => validate(t).map((p) => `${t.name}: ${p}`));
if (problems.length) {
  console.error('Local validation failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const existing = await existingTemplates();
console.log(`WABA currently holds ${existing.size} templates.\n`);

const results = [];
for (const t of TEMPLATES) {
  const prior = existing.get(t.name);
  if (prior) {
    const line = `SKIP   ${t.name} — already exists (status=${prior.status}, id=${prior.id})`;
    console.log(line);
    results.push({ name: t.name, action: 'skip', status: prior.status, id: prior.id });
    continue;
  }
  if (!APPLY) {
    console.log(`PLAN   ${t.name} — ${t.job}`);
    results.push({ name: t.name, action: 'plan' });
    continue;
  }
  const { ok, status, json } = await graph('POST', `${WABA}/message_templates`, buildPayload(t));
  if (ok && json.id) {
    console.log(`CREATE ${t.name} — status=${json.status || 'PENDING'} id=${json.id}`);
    results.push({ name: t.name, action: 'create', status: json.status || 'PENDING', id: json.id });
  } else {
    console.log(`FAIL   ${t.name} — HTTP ${status} ${JSON.stringify(json)}`);
    results.push({ name: t.name, action: 'fail', status, error: json });
  }
}

const out = path.join(ROOT, 'docs', `wa-template-submission-${BID}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  JSON.stringify(
    { waba: WABA, bid: BID, oid: OID, orderUrl: ORDER_URL, appliedAt: new Date().toISOString(), results },
    null,
    2
  )
);
console.log(`\nReport → ${path.relative(ROOT, out)}`);
