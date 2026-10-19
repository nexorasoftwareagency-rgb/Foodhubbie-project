// Generates docs/whatsapp-templates.md from the live WABA (Meta = source of truth).
// Usage (from repo root): node tools/gen-wa-templates.cjs
const https = require('https');
const fs = require('fs');
const path = require('path');

const WABA = '2589174454849821';
const TOKEN = fs.readFileSync(path.join(__dirname, '..', 'Credentials', 'WA_PERMANENT_TOKEN_NEW.txt'), 'utf8').trim();
const OUT = path.join(__dirname, '..', 'docs', 'whatsapp-templates.md');

const USED = {
  order_placed: 'bot/index.js:1049 - order-placed notice to customer',
  order_confirmed_dinein: 'bot/index.js:1059 - dine-in confirmation',
  order_confirmed_delivery_v2: 'bot/index.js:1071 - delivery confirmation',
  order_ready_v3: 'bot/index.js:1083 - order ready',
  order_delivered_v3: 'bot/index.js:1156 - order delivered',
  order_cancelled: 'bot/index.js:1170 - order cancelled',
  rider_assigned: 'bot/index.js:1068 (isRiderChanged block) - meta transport only, non-dine-in, skipped without rider phone',
  proactive_promo: 'bot/index.js:425 + bot/promotions.js:60 - default promo shell',
  greeting_welcome: '**unwired by design** - the in-window greeting already sends an image; a static template would be a UX regression',
  hello_world: 'Meta default sample - unused',
};
for (const k of ['offer', 'discount', 'festive', 'winback']) {
  USED[`promo_hinglish_${k}`] = 'Admin `promoWaTemplate` select -> `campaign.waTemplateName` -> bot/promotions.js';
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(JSON.parse(b)));
    }).on('error', reject);
  });
}

const bodyOf = (t) => (t.components || []).find((c) => c.type === 'BODY')?.text || '';
const paramsOf = (t) => new Set(bodyOf(t).match(/\{\{\d+\}\}/g) || []).size;
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

(async () => {
  const url = `https://graph.facebook.com/v20.0/${WABA}/message_templates?fields=name,status,category,language,components&limit=100&access_token=${TOKEN}`;
  const { data, error } = await get(url);
  if (error) throw new Error(error.message);

  const all = data.slice().sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const ok = all.filter((t) => t.status === 'APPROVED');
  const no = all.filter((t) => t.status !== 'APPROVED');
  const count = (list, c) => list.filter((t) => t.category === c).length;

  const L = [];
  L.push('# WhatsApp templates - approved');
  L.push('');
  L.push(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the live WABA \`${WABA}\``);
  L.push('(`GET /v20.0/{WABA}/message_templates`) - Meta is the source of truth; nothing in this repo mirrors review status.');
  L.push('Regenerate with `node tools/gen-wa-templates.cjs`.');
  L.push('');
  L.push(`**${ok.length} approved** - MARKETING ${count(ok, 'MARKETING')}, UTILITY ${count(ok, 'UTILITY')} - plus ${no.length} not approved (by design, see foot).`);
  L.push('');
  L.push('## Overview');
  L.push('');
  L.push('| Template | Category | Lang | Vars | Used at |');
  L.push('|---|---|---|---|---|');
  for (const t of ok) L.push(`| \`${t.name}\` | ${t.category} | ${t.language} | ${paramsOf(t)} | ${cell(USED[t.name] || '-')} |`);
  L.push('');
  L.push('## Bodies (verbatim)');
  L.push('');
  for (const t of ok) {
    L.push(`### \`${t.name}\` - ${t.category}, \`${t.language}\`, ${paramsOf(t)} var(s)`);
    L.push('');
    L.push('```');
    L.push(bodyOf(t).trim());
    L.push('```');
    L.push('');
    if (USED[t.name]) L.push(`Used at: ${USED[t.name]}`);
    L.push('');
  }
  L.push('## Not approved');
  L.push('');
  for (const t of no) L.push(`- \`${t.name}\` - ${t.status}, ${t.category}, \`${t.language}\``);
  L.push('');
  L.push('The three OTP-bearing UTILITY templates (`out_for_delivery_v3`, `rider_reached`, `otp_changed`) were rejected');
  L.push('as INCORRECT_CATEGORY and stay plain text: Meta rejects OTP-bearing templates, so the OTP message is sent as');
  L.push('free-form text inside the 24h window instead.');
  L.push('');
  L.push('## Gotchas');
  L.push('');
  L.push('- Vars must not sit at the start or end of a body (Graph `100/2388299`) - guard with static lines/emoji.');
  L.push('- Same-name create is blocked (`100/2388024`); edit an existing template with `POST /{template-id}` sending `components` only (`PUT` unsupported).');
  L.push('- Hinglish shells use `language: en` (romanized Latin; `hi` means Devanagari) and carry a single `{{1}}`, so `bot/transport.js` `sendTemplate` maps `body` -> `{{1}}` unchanged.');
  L.push('- Promos are hard-blocked on Baileys transport, so these MARKETING shells only deliver once an outlet flips to `meta`.');

  fs.writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), OUT)} - ${ok.length} approved / ${no.length} not approved`);
})();
