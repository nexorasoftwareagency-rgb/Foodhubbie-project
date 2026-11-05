// Verifies the whole WhatsApp template contract in one pass:
//   1. live approval state of every template on the WABA (Meta = source of truth)
//   2. var count of each approved body vs the parameter array the code sends
//   3. every template the code sends exists AND is APPROVED
//   4. text parity - the Baileys plain-text message equals the approved body
//
// Usage (repo root): node tools/check-wa-templates.cjs [path/to/index.js]
// Needs Credentials/WA_PERMANENT_TOKEN_NEW.txt; reads it, never prints it.
// Exit 1 if anything fails.
const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WABA = '2589174454849821';
const SRC_PATH = process.argv[2] || path.join(ROOT, 'bot', 'index.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8').split('\n');
const SRC_TEXT = SRC.join('\n');
const TOKEN = fs.readFileSync(path.join(ROOT, 'Credentials', 'WA_PERMANENT_TOKEN_NEW.txt'), 'utf8').trim();

const SEN = (n) => `\u0001${n}\u0002`;
const VIS = (s) => s.replace(/\u0001(\d+)\u0002/g, '«$1»');

// Template name -> substring identifying its `msg = \`...\`` line (Baileys path).
const MSG_FOR = {
  order_placed: 'ORDER PLACED!',
  order_confirmed_dinein: 'WELCOME TO',
  order_confirmed_delivery_v2: 'ORDER CONFIRMED!',
  order_ready_v3: 'PACKED & READY!',
  order_delivered_v3: 'SUCCESSFULLY!',
  order_cancelled: 'ORDER CANCELLED',
};

function extractMsg(needle) {
  const i = SRC.findIndex((l) => l.includes('msg = `') && l.includes(needle));
  if (i < 0) return null;
  const line = SRC[i];
  return line.slice(line.indexOf('msg = `') + 7, line.lastIndexOf('`')).replace(/\\n/g, '\n');
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

// How many { type: "text" } parameters does the code send for each template?
function codeParamCounts() {
  const counts = {};
  // A) `templateName = "x";` then its `templateComponents` block, up to the next assignment.
  const re = /templateName\s*=\s*"([a-z0-9_]+)";([\s\S]*?)(?=templateName\s*=|else if \(statusLower|\/\/ =========)/g;
  let m;
  while ((m = re.exec(SRC_TEXT))) {
    const name = m[1];
    const block = m[2];
    const pIdx = block.indexOf('parameters:');
    if (pIdx < 0) continue;
    const arr = block.slice(pIdx);
    const end = arr.indexOf(']');
    const n = (arr.slice(0, end).match(/type:\s*["']text["']/g) || []).length;
    counts[name] = n;
  }
  // B) inline sendTemplateMessage(sock, jid, 'x', [ { parameters: [ ... ] } ])
  const re2 = /sendTemplateMessage\([^,]+,\s*[^,]+,\s*'([a-z0-9_]+)'([\s\S]{0,800}?)\]\s*\}\s*\]/g;
  while ((m = re2.exec(SRC_TEXT))) {
    const name = m[1];
    const n = (m[2].match(/type:\s*["']text["']/g) || []).length;
    counts[name] = n;
  }
  return counts;
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
  const url = `https://graph.facebook.com/v20.0/${WABA}/message_templates?fields=name,status,category,language,components&limit=100&access_token=${TOKEN}`;
  const { data, error } = await get(url);
  if (error) throw new Error(`Graph: ${error.message}`);

  const byName = new Map(data.map((t) => [t.name, t]));
  const bodyOf = (t) => ((t.components || []).find((c) => c.type === 'BODY') || {}).text || '';
  const varsOf = (t) => new Set((bodyOf(t).match(/\{\{\d+\}\}/g) || [])).size;
  const codeCounts = codeParamCounts();
  const used = new Set([...Object.keys(MSG_FOR), ...Object.keys(codeCounts)]);

  let bad = 0;
  const fail = (m) => { bad++; console.log(`  FAIL ${m}`); };

  console.log('WABA template inventory (live)');
  console.log('='.repeat(96));
  console.log('template'.padEnd(30) + 'status'.padEnd(11) + 'cat'.padEnd(10) + 'lang'.padEnd(6) + 'vars'.padEnd(5) + 'code params');
  for (const t of data.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const vars = varsOf(t);
    const cp = codeCounts[t.name];
    console.log(
      t.name.padEnd(30) +
        t.status.padEnd(11) +
        t.category.padEnd(10) +
        t.language.padEnd(6) +
        String(vars).padEnd(5) +
        (cp === undefined ? '(dynamic/unused)' : String(cp))
    );
  }

  console.log('\nChecks');
  console.log('-'.repeat(96));
  for (const name of used) {
    const t = byName.get(name);
    if (!t) { fail(`${name} is used by the code but does not exist on the WABA`); continue; }
    if (t.status !== 'APPROVED') fail(`${name} is used by the code but its WABA status is ${t.status}`);
    const vars = varsOf(t);
    const cp = codeCounts[name];
    if (cp !== undefined && cp !== vars) fail(`${name}: code sends ${cp} parameter(s) but the approved body has ${vars} var(s)`);
  }

  for (const [name, needle] of Object.entries(MSG_FOR)) {
    const t = byName.get(name);
    if (!t) continue;
    const raw = extractMsg(needle);
    if (raw === null) { fail(`${name}: no Baileys msg literal found in ${path.basename(SRC_PATH)}`); continue; }
    const c = normalize(raw);
    const b = tmpl(bodyOf(t).trim());
    if (b.text !== c.text) {
      fail(`${name}: Baileys text differs from the approved body`);
      const a = b.text.split('\n');
      const d = c.text.split('\n');
      for (let i = 0; i < Math.max(a.length, d.length); i++) {
        if ((a[i] ?? '') === (d[i] ?? '')) continue;
        console.log(`      line ${i + 1}\n        template | ${VIS(a[i] ?? '<none>')}\n        baileys  | ${VIS(d[i] ?? '<none>')}`);
      }
    }
  }

  const notApproved = data.filter((t) => t.status !== 'APPROVED');
  console.log(`\nNot approved (${notApproved.length}): ${notApproved.map((t) => `${t.name}[${t.status}]`).join(', ') || 'none'}`);
  console.log('\nNot compared (no parity to assert):');
  console.log('  greeting_welcome       unwired - never sent on either transport');
  console.log('  proactive_promo        promos are hard-blocked on Baileys by design');
  console.log('  out_for_delivery_v3    rejected as INCORRECT_CATEGORY (OTP) - plain text by design');
  console.log('  rider_reached          rejected as INCORRECT_CATEGORY (OTP) - plain text by design');
  console.log('  otp_changed            rejected as INCORRECT_CATEGORY (OTP) - plain text by design');
  console.log('  hello_world            Meta sample, unused');
  console.log('  promo_hinglish_* (4)   resolved dynamically in bot/promotions.js (waTemplateName');
  console.log('                         || PROACTIVE_TEMPLATE || proactive_promo) - approval shown above');

  console.log(`\n${bad === 0 ? 'ALL CHECKS PASSED' : `${bad} CHECK(S) FAILED`}`);
  process.exit(bad ? 1 : 0);
})();
