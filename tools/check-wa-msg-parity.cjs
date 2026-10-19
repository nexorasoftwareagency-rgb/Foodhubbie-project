// Guards the one real source of drift in the order-notification path: the Baileys
// plain-text messages live in bot/index.js while the Meta-approved bodies live on
// the WABA. Two copies of the same customer-facing text - this asserts they are
// byte-identical instead of "similar". (They had drifted: missing trailing hearts,
// 26-vs-20 separators, a missing COD fallback, a stray pizza emoji.)
//
// Usage (repo root): node tools/check-wa-msg-parity.cjs [path/to/index.js]
// Needs Credentials/WA_PERMANENT_TOKEN_NEW.txt; reads it, never prints it.
const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WABA = '2589174454849821';
const SRC_PATH = process.argv[2] || path.join(ROOT, 'bot', 'index.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8').split('\n');
const TOKEN = fs.readFileSync(path.join(ROOT, 'Credentials', 'WA_PERMANENT_TOKEN_NEW.txt'), 'utf8').trim();

// Sentinels normalize ${...} (code) and {{n}} (template body) to the same marker,
// so only real text differences show up and param order is asserted too.
const SEN = (n) => `\u0001${n}\u0002`;
const VIS = (s) => s.replace(/\u0001(\d+)\u0002/g, '«$1»');

// Template name -> a substring that uniquely identifies its `msg = \`...\`` line.
const MAP = [
  ['order_placed', 'ORDER PLACED!'],
  ['order_confirmed_dinein', 'WELCOME TO'],
  ['order_confirmed_delivery_v2', 'ORDER CONFIRMED!'],
  ['order_ready_v3', 'PACKED & READY!'],
  ['order_delivered_v3', 'SUCCESSFULLY!'],
  ['order_cancelled', 'ORDER CANCELLED'],
];

function extract(needle) {
  const i = SRC.findIndex((l) => l.includes('msg = `') && l.includes(needle));
  if (i < 0) throw new Error(`no msg literal in bot/index.js for ${needle}`);
  const line = SRC[i];
  const raw = line.slice(line.indexOf('msg = `') + 7, line.lastIndexOf('`')).replace(/\\n/g, '\n');
  return { raw, line: i + 1 };
}

function normalize(src) {
  let out = '';
  const params = [];
  let n = 0;
  for (let i = 0; i < src.length; ) {
    if (src[i] === '$' && src[i + 1] === '{') {
      let d = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === '{') d++;
        else if (src[j] === '}' && --d === 0) break;
      }
      params.push(src.slice(i + 2, j));
      out += SEN(++n);
      i = j + 1;
    } else out += src[i++];
  }
  return { text: out, params };
}

function tmpl(text) {
  const params = [];
  const out = text.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    params.push(n);
    return SEN(n);
  });
  return { text: out, params };
}

function get(url) {
  return new Promise((ok, no) =>
    https
      .get(url, (r) => {
        let b = '';
        r.on('data', (c) => (b += c));
        r.on('end', () => ok(JSON.parse(b)));
      })
      .on('error', no)
  );
}

(async () => {
  const url = `https://graph.facebook.com/v20.0/${WABA}/message_templates?fields=name,status,components&limit=100&access_token=${TOKEN}`;
  const { data, error } = await get(url);
  if (error) throw new Error(`Graph: ${error.message}`);
  const body = (name) => {
    const t = data.find((x) => x.name === name);
    if (!t) throw new Error(`template ${name} not on the WABA`);
    return ((t.components || []).find((c) => c.type === 'BODY') || {}).text || '';
  };

  let bad = 0;
  for (const [name, needle] of MAP) {
    const t = tmpl(body(name).trim());
    const { raw, line } = extract(needle);
    const c = normalize(raw);
    const same = t.text === c.text;
    console.log(`${same ? 'OK  ' : 'DRIFT'} ${name.padEnd(28)} ${path.relative(ROOT, SRC_PATH)}:${line}`);
    if (same) continue;
    bad++;
    const a = t.text.split('\n');
    const b = c.text.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? '') === (b[i] ?? '')) continue;
      console.log(`  line ${i + 1}`);
      console.log(`    template | ${VIS(a[i] ?? '<none>')}`);
      console.log(`    baileys  | ${VIS(b[i] ?? '<none>')}`);
    }
    console.log(`  params template: ${JSON.stringify(t.params)}`);
    console.log(`  params baileys : ${c.params.length ? JSON.stringify(c.params) : '(none)'}`);
  }

  console.log(`
Not compared (no parity to assert):
  greeting_welcome            unwired - never sent on either transport
  rider_assigned              meta only; Baileys sends no equivalent message
  proactive_promo             promos are hard-blocked on Baileys by design
  out_for_delivery_v3         rejected as INCORRECT_CATEGORY (OTP) - plain text by design
  rider_reached               rejected as INCORRECT_CATEGORY (OTP) - plain text by design
  otp_changed                 rejected as INCORRECT_CATEGORY (OTP) - plain text by design
  hello_world                 Meta sample, unused`);

  console.log(`\n${bad === 0 ? 'parity OK' : `${bad} of ${MAP.length} messages drifted`}`);
  process.exit(bad ? 1 : 0);
})();
