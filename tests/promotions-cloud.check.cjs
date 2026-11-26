#!/usr/bin/env node
/**
 * Batch 23q guard - promotional campaigns on Cloud Functions.
 *
 * Three halves:
 *
 *   1. RULES  - `bot/promotions-rules.js` is the pure decision table both
 *      runners share; a drift here changes who gets marketed to.
 *   2. BEHAVIOUR - run the real `bot/promotions-engine.js` (the bytes Cloud
 *      Functions vendors) against an in-memory RTDB stand-in: claim-before-send
 *      (at-most-once across slices), the per-campaign lease, the stop-within-10
 *      read, consent (app switch wins), quiet hours deferring instead of
 *      sleeping, the circuit breaker, the prepaid token, the 300 cap, the
 *      warm-up ladder, per-slice counters, done-strips-media, and paused
 *      campaigns never being resumed or deleted.
 *   3. SOURCE PINS - the bot stands down behind one flag, the triggers stay
 *      no-ops unless that flag is `true`, the sweep never reads the whole
 *      campaigns node every minute, and the two modules are actually vendored.
 *
 * Run: node tests/promotions-cloud.check.cjs
 *      node tests/promotions-cloud.check.cjs --self-test   (mutation proof)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed += 1;
    console.log('  FAIL  ' + name + '\n        ' + ((err && err.message) || err));
  }
}

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (_) {
    return ''; // a source pin for a file that does not exist yet must FAIL, not crash
  }
};

/** Replace every occurrence: a pin that forbids a pattern forbids it everywhere. */
const all = (src, from, to) => src.split(from).join(to);

// ---------------------------------------------------------------------------
// In-memory RTDB stand-in
// ---------------------------------------------------------------------------
function makeFakeDb(initial, opts) {
  // A real nested tree, so `set` on a campaign and `child('status').once()` on
  // the same campaign agree - a flat path map silently disagrees and produces
  // failures that look like engine bugs.
  const root = {};
  const log = { sets: [], updates: [], removes: [], tx: [], queries: [] };
  const attempted = new Set();
  const throwOn = new Set((opts && opts.throwOn) || []);
  // The engine's consent rule is "explicit yes only". Most cases here are not
  // about consent, so a seed pre-answers it without writing 300 nodes. Pass
  // `{ defaultConsent: undefined }` to model a guest who never opted in.
  const defaultConsent = opts && 'defaultConsent' in opts ? opts.defaultConsent : true;
  let seq = 0;

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const parts = (p) => String(p).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  function walk(p, create) {
    const segs = parts(p);
    let node = root;
    for (const s of segs) {
      if (node === null || typeof node !== 'object') {
        if (!create) return undefined;
        node = null;
      }
      if (node[s] === undefined) {
        if (!create) return undefined;
        node[s] = {};
      }
      node = node[s];
    }
    return node;
  }

  function readAt(p) {
    const segs = parts(p);
    if (!segs.length) return Object.keys(root).length ? clone(root) : null;
    let node = walk(p, false);
    if (node !== undefined) return clone(node);
    if (defaultConsent !== undefined && /(^|\/)customers\/[^/]+\/promotionalConsent$/.test(segs.join('/'))) {
      return defaultConsent;
    }
    return null;
  }

  function writeAt(p, value) {
    const segs = parts(p);
    if (!segs.length) return;
    const parent = walk(segs.slice(0, -1).join('/'), true);
    const key = segs[segs.length - 1];
    if (value === null || value === undefined) delete parent[key];
    else parent[key] = clone(value);
  }

  function childrenOf(p) {
    const node = readAt(p);
    return node && typeof node === 'object' ? node : {};
  }

  function snapOf(p) {
    const value = readAt(p);
    const key = p.split('/').filter(Boolean).pop() || null;
    return { key, val: () => value, exists: () => value !== null && value !== undefined };
  }

  const queryAt = (refPath, field, match, label) => ({
    once: async () => {
      log.queries.push({ path: refPath, field, match, label });
      const rows = childrenOf(refPath);
      const hit = {};
      for (const [k, v] of Object.entries(rows)) {
        if (match(v)) hit[k] = v;
      }
      return {
        val: () => (Object.keys(hit).length ? hit : null),
        exists: () => Object.keys(hit).length > 0,
      };
    },
  });

  function ref(p) {
    const refPath = String(p).replace(/\/+$/, '');
    const guard = () => {
      if (throwOn.has(refPath)) throw new Error('permission-denied: ' + refPath);
    };
    const api = {
      key: refPath.split('/').filter(Boolean).pop() || null,
      child: (c) => ref(refPath + '/' + c),
      orderByChild: (field) => ({
        equalTo: (value) => queryAt(refPath, field, (v) => v && v[field] === value, { equalTo: value }),
        startAt: (lo) => ({
          endAt: (hi) => queryAt(refPath, field, (v) => {
            const n = Number(v && v[field]);
            return Number.isFinite(n) && n >= lo && n <= hi;
          }, { range: [lo, hi] }),
        }),
      }),
      once: async () => { guard(); return snapOf(refPath); },
      get: async () => { guard(); return snapOf(refPath); },
      set: async (v) => { guard(); writeAt(refPath, v); log.sets.push(refPath); },
      update: async (v) => {
        guard();
        const cur = readAt(refPath);
        const base = cur && typeof cur === 'object' ? cur : {};
        const next = Object.assign(base, clone(v));
        for (const [k, val] of Object.entries(next)) if (val === null) delete next[k];
        writeAt(refPath, next);
        log.updates.push(refPath);
      },
      remove: async () => { guard(); writeAt(refPath, null); log.removes.push(refPath); },
      push: async (v) => {
        guard();
        const key = '-gen' + String(++seq).padStart(6, '0');
        writeAt(refPath + '/' + key, v);
        log.sets.push(refPath + '/' + key);
        return { key, path: refPath + '/' + key };
      },
      transaction: async (fn) => {
        guard();
        log.tx.push(refPath);
        const has = readAt(refPath) !== null;
        const first = !attempted.has(refPath);
        attempted.add(refPath);
        let next = fn(first ? null : clone(readAt(refPath)));
        if (next === undefined) return { committed: false, snapshot: snapOf(refPath) };
        if (first && has) {
          // The Admin SDK re-runs on a CAS mismatch with the real value.
          next = fn(clone(readAt(refPath)));
          if (next === undefined) return { committed: false, snapshot: snapOf(refPath) };
        }
        writeAt(refPath, next);
        return { committed: true, snapshot: snapOf(refPath) };
      },
    };
    return api;
  }

  const db = {
    ref,
    log,
    get: (p) => readAt(p),
    put: (p, v) => writeAt(p, v),
    del: (p) => writeAt(p, null),
    children: (p) => childrenOf(p),
    dump: () => clone(root),
  };
  for (const [k, v] of Object.entries(initial || {})) writeAt(k, v);
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const BIZ = 'biz-1';
const OUT = 'outlet-1';
const resolvePath = (p, o) => `businesses/${BIZ}/outlets/${o || OUT}/${p}`;
const billingPath = (p, o) => `walletBilling/${BIZ}/${o || OUT}/${p}`;
const P = (p) => resolvePath(p);
const B = (p) => billingPath(p);

const R = require('../bot/promotions-rules.js');
const { createPromotionsEngine, sendPromoWithFallback } = require('../bot/promotions-engine.js');

// 2026-11-23 12:00 IST - safely outside every quiet window used below.
const NOON_IST = Date.UTC(2026, 10, 23, 6, 30);
// 2026-11-23 23:00 IST.
const NIGHT_IST = Date.UTC(2026, 10, 23, 17, 30);

function makeTransport(behaviour) {
  const t = {
    isMeta: true,
    sent: [],
    templates: [],
    sendTemplate: async (jid, payload) => {
      t.templates.push({ jid, payload });
      if (behaviour && behaviour.template) return behaviour.template(jid, payload, t);
      return { key: { id: 'wamid.' + t.templates.length } };
    },
    sendMessage: async (jid, content) => {
      t.sent.push({ jid, content });
      if (behaviour && behaviour.message) return behaviour.message(jid, content, t);
      return { key: { id: 'wamid.m' + t.sent.length } };
    },
  };
  if (behaviour && behaviour.noTemplate) delete t.sendTemplate;
  return t;
}

function engineFor(db, extra) {
  const e = createPromotionsEngine(Object.assign({
    db,
    resolvePath,
    billingPath,
    outlet: OUT,
    transport: makeTransport(),
    getStore: async () => ({ storeName: 'Roshani Pizza' }),
    getCustomer: async () => ({ name: 'Asha', lastOrderDate: null }),
    getFirstLinkedAt: async () => NOON_IST - 30 * 86400000,
    isFrozen: async () => false,
    isDegraded: async () => false,
    now: () => NOON_IST,
    sleep: async () => {},
    random: (lo) => lo,
    log: { log() {}, warn() {}, error() {} },
  }, extra || {}));
  return e;
}

function baseSeed(extra) {
  return Object.assign({
    [P('bot/promotions/enabled')]: true,
    [P('bot/promotions/killSwitch')]: false,
    [B('tokens/balance')]: 100,
    [P('bot/promotions/dailyCount/2026-11-23')]: 0,
  }, extra || {});
}

function campaign(extra) {
  return Object.assign({
    status: 'running',
    template: 'Big {name} offer at {storeName}',
    recipients: ['9812345678', '9812345679', '9812345680'],
    sendStopMsg: true,
    startedAt: NOON_IST - 60000,
    totalSent: 0,
    totalFailed: 0,
    currentIndex: 0,
  }, extra || {});
}

(async function main() {
  console.log('\n== rules ==');

  await check('the STOP footer exists exactly once per message', () => {
    const once = R.appendStopFooter('Offer', { sendStopMsg: true });
    assert.strictEqual(once, 'Offer' + R.STOP_FOOTER);
    assert.strictEqual(R.appendStopFooter(once, { sendStopMsg: true }), once, 'already carries it');
    assert.ok(!R.appendStopFooter('Offer', { sendStopMsg: true, waTemplateName: 'promo_cta_flash' }).includes('STOP'),
      'a shell with a STOP footer must not print it twice');
  });

  await check('the warm-up ladder is 20 -> 250 -> 300', () => {
    const d0 = NOON_IST;
    assert.deepStrictEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((d) => R.warmupDailyLimit(d0, d0 + d * 86400000)),
      [20, 40, 60, 100, 150, 200, 250, 300]
    );
  });

  await check('a 350-recipient list is capped at the 300 ceiling', () => {
    assert.strictEqual(R.normalizeRecipients(new Array(350).fill('9812345678')).length, 300);
  });

  await check('an inline data: URI and a Storage URL are distinguishable', () => {
    assert.strictEqual(R.isDataUri('data:image/png;base64,AA'), true);
    assert.strictEqual(R.isDataUri('https://storage.googleapis.com/b/x.png'), false);
  });

  console.log('\n== send path ==');

  await check('template first: no text message is sent when the template lands', async () => {
    const transport = makeTransport();
    const r = await sendPromoWithFallback(transport, { jid: 'a@s.whatsapp.net', text: 'Offer', waTemplateName: 'promo_cta_flash' });
    assert.strictEqual(r.via, 'template');
    assert.strictEqual(transport.templates.length, 1);
    assert.strictEqual(transport.sent.length, 0);
    assert.strictEqual(transport.templates[0].payload.name, 'promo_cta_flash');
    assert.strictEqual(transport.templates[0].payload.body, 'Offer', 'shell carries the STOP footer already');
  });

  await check('text fallback when the template fails', async () => {
    const transport = makeTransport({ template: () => { throw new Error('code 100'); } });
    const r = await sendPromoWithFallback(transport, { jid: 'a@s.whatsapp.net', text: 'Offer' });
    assert.strictEqual(r.via, 'text');
    assert.strictEqual(transport.sent.length, 1);
    assert.ok(transport.sent[0].content.text.endsWith(R.STOP_FOOTER));
  });

  await check('a Storage URL is sent as a link, never as base64', async () => {
    const transport = makeTransport({ noTemplate: true });
    await sendPromoWithFallback(transport, {
      jid: 'a@s.whatsapp.net', text: 'Offer', mediaUrl: 'https://storage.googleapis.com/b/x.png',
    });
    assert.deepStrictEqual(transport.sent[0].content.image, { url: 'https://storage.googleapis.com/b/x.png' });
  });

  await check('a data: URI is decoded to bytes', async () => {
    const transport = makeTransport({ noTemplate: true });
    await sendPromoWithFallback(transport, {
      jid: 'a@s.whatsapp.net', text: 'Offer', mediaUrl: 'data:image/png;base64,QUJD',
    });
    assert.ok(Buffer.isBuffer(transport.sent[0].content.image));
    assert.strictEqual(transport.sent[0].content.image.toString(), 'ABC');
  });

  await check('a cost-guard block is a DROP, never a delivery', async () => {
    const transport = makeTransport({ template: () => ({ blocked: true }) });
    await assert.rejects(
      () => sendPromoWithFallback(transport, { jid: 'a@s.whatsapp.net', text: 'Offer' }),
      /promo-blocked-cost-guard/
    );
  });

  await check('a non-meta transport can never send a promotion', async () => {
    const transport = makeTransport();
    transport.isMeta = false;
    await assert.rejects(
      () => sendPromoWithFallback(transport, { jid: 'a@s.whatsapp.net', text: 'Offer' }),
      /promo-blocked-transport/
    );
    assert.strictEqual(transport.templates.length + transport.sent.length, 0);
  });

  console.log('\n== campaign slices ==');

  await check('a 3-recipient campaign sends 3, finishes, and burns 3 prepaid tokens', async () => {
    const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign() }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'done');
    assert.strictEqual(transport.templates.length, 3);
    const doc = db.get(P('bot/promotions/campaigns/c1'));
    assert.strictEqual(doc.status, 'done');
    assert.strictEqual(doc.currentIndex, 3);
    assert.strictEqual(doc.totalSent, 3);
    assert.strictEqual(doc.totalFailed, 0);
    assert.strictEqual(db.get(B('tokens/balance')), 97);
    assert.strictEqual(db.get(P('bot/promotions/dailyCount/2026-11-23')), 3);
    const logs = db.get(P('bot/promotions/logs/c1'));
    assert.strictEqual(Object.keys(logs).length, 3);
    assert.ok(Object.values(logs).every((l) => l.status === 'sent'));
  });

  await check('a personalisation token is resolved from the store and the customer', async () => {
    const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678'] }) }));
    const transport = makeTransport();
    await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.ok(transport.templates[0].payload.body.startsWith('Big Asha offer at Roshani Pizza'),
      'name and store are resolved: ' + transport.templates[0].payload.body);
  });

  await check('at-most-once: a second slice never re-sends to an already-claimed index', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678', '9812345679', '9812345680', '9812345681', '9812345682'] }),
    }));
    const transport = makeTransport();
    const first = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' }, { batchSize: 2 });
    assert.strictEqual(first.status, 'running');
    assert.strictEqual(first.continue, true);
    assert.strictEqual(transport.templates.length, 2);
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/currentIndex')), 2);

    // A NEW engine instance (next Function invocation) resumes from the claim.
    const second = await engineFor(db, { transport, now: () => NOON_IST + 600000 })
      .runSlice({ campaignId: 'c1' }, { force: true, batchSize: 2 });
    assert.strictEqual(second.status, 'running');
    assert.strictEqual(transport.templates.length, 4, 'two more, never a re-send');
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/currentIndex')), 4);

    const third = await engineFor(db, { transport, now: () => NOON_IST + 1200000 })
      .runSlice({ campaignId: 'c1' }, { force: true, batchSize: 2 });
    assert.strictEqual(third.status, 'done');
    const jids = transport.templates.map((t) => t.jid);
    assert.strictEqual(new Set(jids).size, 5, 'every recipient exactly once');
  });

  await check('the inter-slice gap is written as nextSliceAt and honoured', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: new Array(5).fill(0).map((_, i) => '98123456' + String(70 + i)) }),
    }));
    const e = engineFor(db, { transport: makeTransport() });
    const first = await e.runSlice({ campaignId: 'c1' }, { batchSize: 2 });
    assert.ok(first.nextSliceAt > NOON_IST, 'the 60-120 s batch pause became a timestamp');
    const again = await e.runSlice({ campaignId: 'c1' });
    assert.strictEqual(again.status, 'waiting');
    assert.strictEqual(again.reason, undefined);
    assert.ok(again.nextSliceAt > NOON_IST);
  });

  await check('a per-slice budget never drops the recipient it did not start', async () => {
    // Clock advances 20 s per reading, so the budget guard trips mid-slice.
    let tick = NOON_IST;
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678', '9812345679', '9812345680', '9812345681'] }),
    }));
    const transport = makeTransport();
    const e = engineFor(db, { transport, now: () => (tick += 20000) });
    const res = await e.runSlice({ campaignId: 'c1' }, { batchSize: 30, budgetMs: 60000 });
    const claimed = db.get(P('bot/promotions/campaigns/c1/currentIndex'));
    assert.strictEqual(res.status, 'running');
    assert.ok(claimed < 4, 'the budget stopped the slice early');
    assert.strictEqual(transport.templates.length, claimed, 'sends == claimed, and no index was skipped');
  });

  await check('F2: an admin Stop is honoured within 10 sends, not at the end of the slice', async () => {
    const recipients = new Array(30).fill(0).map((_, i) => '98111111' + String(10 + i).slice(-2));
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients }),
    }));
    const transport = makeTransport({
      template: (jid) => {
        // The owner taps Stop after the 10th send.
        if (transport.templates.length === 10) db.put(P('bot/promotions/campaigns/c1/status'), 'stopped');
        return { key: { id: 'w' } };
      },
    });
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' }, { batchSize: 30 });
    assert.strictEqual(res.status, 'stopped');
    assert.strictEqual(transport.templates.length, 10);
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/status')), 'stopped');
  });

  await check('F8: per-slice counters are carried, never zeroed', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({
        totalSent: 7,
        totalFailed: 1,
        currentIndex: 3,
        recipients: new Array(8).fill(0).map((_, i) => '98123456' + String(70 + i)),
      }),
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' }, { force: true, batchSize: 2 });
    assert.strictEqual(res.status, 'running');
    assert.strictEqual(res.sent, 9);
    assert.strictEqual(res.failed, 1);
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/totalSent')), 9);
  });

  console.log('\n== consent and skips ==');

  await check('the app switch beats the stored flag (off wins)', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678'] }),
      [P('customers/9812345678/promotionalConsent')]: true,
      [P('customers/9812345678/app/consent/offers')]: false,
    }));
    const transport = makeTransport();
    await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(transport.templates.length, 0);
    assert.strictEqual(db.get(P('bot/promotions/logs/c1/9812345678')).reason, 'no-consent');
    assert.strictEqual(db.get(B('tokens/balance')), 100, 'a skipped send costs nothing');
  });

  await check('the app switch alone is enough to reach a guest (on wins)', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678'] }),
      [P('customers/9812345678/app/consent/offers')]: true,
    }));
    const transport = makeTransport();
    await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(transport.templates.length, 1);
  });

  await check('silence is not consent', async () => {
    const db = makeFakeDb(
      baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678'] }) }),
      { defaultConsent: undefined }
    );
    const transport = makeTransport();
    await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(transport.templates.length, 0);
    assert.strictEqual(db.get(P('bot/promotions/logs/c1/9812345678')).reason, 'no-consent');
  });

  await check('STOP wins over every consent flag', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678'] }),
      [P('customers/9812345678/promotionalConsent')]: true,
      [P('bot/promotions/optout/9812345678')]: true,
    }));
    const transport = makeTransport();
    await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(transport.templates.length, 0);
    assert.strictEqual(db.get(P('bot/promotions/logs/c1/9812345678')).reason, 'opted-out');
  });

  await check('a frozen chat is skipped, never billed', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678'] }),
      [P('customers/9812345678/promotionalConsent')]: true,
    }));
    const transport = makeTransport();
    await engineFor(db, { transport, isFrozen: async () => true }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(transport.templates.length, 0);
    assert.strictEqual(db.get(P('bot/promotions/logs/c1/9812345678')).reason, 'frozen');
    assert.strictEqual(db.get(B('tokens/balance')), 100);
  });

  await check('an all-skipped slice terminates instead of looping for ever', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign(),
      [P('bot/promotions/optout/9812345678')]: true,
      [P('bot/promotions/optout/9812345679')]: true,
      [P('bot/promotions/optout/9812345680')]: true,
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'done');
    assert.strictEqual(transport.templates.length, 0);
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/currentIndex')), 3);
  });

  console.log('\n== outlet gates ==');

  await check('paused is never auto-resumed', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ status: 'paused', pauseReason: 'no-tokens', currentIndex: 1 }),
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'paused');
    assert.strictEqual(res.reason, 'no-tokens');
    assert.strictEqual(transport.templates.length, 0);
  });

  await check('no WhatsApp number pauses with the honest reason', async () => {
    const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign() }));
    const res = await engineFor(db, { transport: null }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'paused');
    assert.strictEqual(res.pauseReason, 'no-number');
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/pauseReason')), 'no-number');
    assert.strictEqual(db.get(B('tokens/balance')), 100);
  });

  await check('a Baileys outlet is blocked with transport-blocked', async () => {
    const transport = makeTransport();
    transport.isMeta = false;
    const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign() }));
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.pauseReason, 'transport-blocked');
    assert.strictEqual(transport.templates.length, 0);
  });

  await check('the dashboard toggle and the kill switch both pause', async () => {
    const off = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign(),
      [P('bot/promotions/enabled')]: false,
    }));
    assert.strictEqual((await engineFor(off, {}).runSlice({ campaignId: 'c1' })).pauseReason, 'promo-disabled');

    const killed = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign(),
      [P('bot/promotions/killSwitch')]: true,
    }));
    assert.strictEqual((await engineFor(killed, {}).runSlice({ campaignId: 'c1' })).pauseReason, 'kill-switch');
  });

  await check('a degraded session pauses before sending', async () => {
    const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign() }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport, isDegraded: async () => true }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.pauseReason, 'session-degraded');
    assert.strictEqual(transport.templates.length, 0);
  });

  console.log('\n== money ==');

  await check('an empty prepaid balance pauses with no-tokens', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign(),
      [B('tokens/balance')]: 0,
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.pauseReason, 'no-tokens');
    assert.strictEqual(transport.templates.length, 0);
  });

  await check('an unreadable balance fails CLOSED', async () => {
    const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign() }), { throwOn: [B('tokens/balance')] });
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.pauseReason, 'balance-unreadable');
    assert.strictEqual(transport.templates.length, 0);
  });

  await check('a self-test sends with a zero balance and is stamped isTest', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/test_1')]: {},
      [B('tokens/balance')]: 0,
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({
      campaignId: 'test_1',
      isTest: true,
      template: 'Test message',
      recipients: ['9812345678'],
    });
    assert.strictEqual(res.status, 'done');
    assert.strictEqual(transport.templates.length, 1);
    assert.strictEqual(db.get(P('bot/promotions/campaigns/test_1/isTest')), true);
    assert.strictEqual(db.get(B('tokens/balance')), 0, 'a test never bills');
    assert.strictEqual(db.get(P('bot/promotions/dailyCount/2026-11-23')), 0, 'and never consumes the daily ceiling');
  });

  await check('the warm-up ladder pauses at the day-0 ceiling of 20', async () => {
    const recipients = new Array(25).fill(0).map((_, i) => '98110000' + String(10 + i).slice(-2));
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients }),
      [P('bot/promotions/dailyCount/2026-11-23')]: 20,
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport, getFirstLinkedAt: async () => NOON_IST }).runSlice({ campaignId: 'c1' }, { batchSize: 30 });
    assert.strictEqual(res.pauseReason, 'daily-limit');
    assert.strictEqual(transport.templates.length, 0);
  });

  await check('a Meta cost-guard block pauses the campaign, it does not walk the list', async () => {
    const recipients = new Array(20).fill(0).map((_, i) => '98122222' + String(10 + i).slice(-2));
    const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign({ recipients }) }));
    const transport = makeTransport({ template: () => ({ blocked: true }) });
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' }, { batchSize: 20 });
    assert.strictEqual(res.status, 'paused');
    assert.strictEqual(res.pauseReason, 'meta-cost-guard');
    assert.strictEqual(transport.templates.length, 1);
    assert.strictEqual(transport.sent.length, 0, 'the fallback must not send either');
  });

  await check('the circuit breaker pauses after 10 consecutive failures', async () => {
    const recipients = new Array(20).fill(0).map((_, i) => '98133333' + String(10 + i).slice(-2));
    const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign({ recipients }) }));
    const transport = makeTransport({
      template: () => { throw new Error('boom'); },
      message: () => { throw new Error('boom'); },
    });
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' }, { batchSize: 20 });
    assert.strictEqual(res.status, 'paused');
    assert.strictEqual(res.pauseReason, 'high-failure-rate');
    const logged = db.get(P('bot/promotions/logs/c1')) || {};
    const rows = Object.values(logged);
    assert.strictEqual(rows.length, 10, 'the breaker stops the campaign after 10 attempted recipients');
    assert.ok(rows.every((r) => r.status === 'failed'));
  });

  console.log('\n== scheduling ==');

  await check('quiet hours DEFER instead of sleeping', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ quietHours: { start: 22, end: 8 } }),
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport, now: () => NIGHT_IST }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'waiting');
    assert.strictEqual(transport.templates.length, 0);
    assert.ok(res.nextSliceAt > NIGHT_IST);
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/waitingReason')), 'quiet-hours');
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/status')), 'running', 'deferred, not paused');

    // 09:00 IST the next morning: the SAME campaign sends without a human.
    const morning = await engineFor(db, { transport, now: () => NIGHT_IST + 10 * 3600000 })
      .runSlice({ campaignId: 'c1' }, { force: true });
    assert.strictEqual(morning.status, 'done');
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/waitingReason')), null);
  });

  await check('a scheduled campaign waits for its runAt', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ status: 'scheduled', runAt: NOON_IST + 3600000 }),
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'waiting');
    assert.strictEqual(transport.templates.length, 0);
  });

  await check('a scheduled campaign past its 15 min grace window expires', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ status: 'scheduled', runAt: NOON_IST - 20 * 60000 }),
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'expired');
    assert.strictEqual(db.get(P('bot/promotions/campaigns/c1/reason')), 'missed-window');
    assert.strictEqual(transport.templates.length, 0);
  });

  console.log('\n== resilience ==');

  await check('a live lease held by another campaign makes this slice wait', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign(),
      [P('bot/promotions/lease')]: { campaignId: 'other', acquiredAt: NOON_IST, expiresAt: NOON_IST + 90000 },
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'waiting');
    assert.strictEqual(res.reason, 'lease-held');
    assert.strictEqual(transport.templates.length, 0);
    assert.strictEqual(db.get(P('bot/promotions/lease')).campaignId, 'other', 'a lease is not stolen');
  });

  await check('an expired lease is claimable', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678'] }),
      [P('bot/promotions/lease')]: { campaignId: 'other', acquiredAt: NOON_IST - 200000, expiresAt: NOON_IST - 100000 },
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'done');
    assert.strictEqual(transport.templates.length, 1);
    assert.strictEqual(db.get(P('bot/promotions/lease')), null, 'released at the end');
  });

  // A normal launch writes `status:'running'` (relay -> sweep) AND a
  // SEND_PROMOTION command (command handler), so two runners can start the same
  // campaign at once. The lease is held by a slice, never by a campaign, or both
  // runners send the same recipient.
  await check('a live lease held by another SLICE of the same campaign makes this slice wait', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({ recipients: ['9812345678'] }),
      [P('bot/promotions/lease')]: {
        campaignId: 'c1', holder: 'c1#1#other-runner', acquiredAt: NOON_IST, expiresAt: NOON_IST + 90000,
      },
    }));
    const transport = makeTransport();
    const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
    assert.strictEqual(res.status, 'waiting');
    assert.strictEqual(res.reason, 'lease-held');
    assert.strictEqual(transport.templates.length, 0, 'the second runner must not send');
    assert.strictEqual(db.get(P('bot/promotions/lease')).holder, 'c1#1#other-runner');
  });

  await check('a stale slice cannot release a newer holder\'s lease', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/lease')]: {
        campaignId: 'c1', holder: 'c1#2#newer', acquiredAt: NOON_IST, expiresAt: NOON_IST + 90000,
      },
    }));
    const e = engineFor(db, {});
    await e.releaseLease('c1', 'c1#1#stale');
    assert.strictEqual(db.get(P('bot/promotions/lease')).holder, 'c1#2#newer', 'a stale release is refused');
    await e.releaseLease('c1', 'c1#2#newer');
    assert.strictEqual(db.get(P('bot/promotions/lease')), null, 'the holder releases');
  });

  await check('a terminal campaign is never restarted', async () => {
    for (const status of R.TERMINAL_STATUSES) {
      const db = makeFakeDb(baseSeed({ [P('bot/promotions/campaigns/c1')]: campaign({ status }) }));
      const transport = makeTransport();
      const res = await engineFor(db, { transport }).runSlice({ campaignId: 'c1' });
      assert.strictEqual(res.status, status);
      assert.strictEqual(transport.templates.length, 0, status + ' must not send');
    }
  });

  await check('a missing campaign and a missing command are both refused', async () => {
    const db = makeFakeDb(baseSeed());
    assert.strictEqual((await engineFor(db, {}).runSlice({})).reason, 'no-campaign');
    const res = await engineFor(db, {}).runSlice({ campaignId: 'ghost' });
    assert.strictEqual(res.reason, 'missing-campaign');
  });

  await check('done strips an inline base64 image', async () => {
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/c1')]: campaign({
        recipients: ['9812345678'],
        mediaUrl: 'data:image/png;base64,QUJD',
      }),
    }));
    await engineFor(db, { transport: makeTransport() }).runSlice({ campaignId: 'c1' });
    const doc = db.get(P('bot/promotions/campaigns/c1'));
    assert.ok(doc.mediaUrl == null, 'the base64 must be gone (RTDB deletes a null key)');
    assert.strictEqual(doc.mediaStripReason, 'done');
  });

  console.log('\n== expiry ==');

  await check('expiry deletes terminal campaigns, keeps paused, and strips dead media', async () => {
    const old = NOON_IST - 40 * 86400000;
    const db = makeFakeDb(baseSeed({
      [P('bot/promotions/campaigns/done_d')]: { status: 'done', completedAt: old, startedAt: old },
      [P('bot/promotions/campaigns/paused_p')]: {
        status: 'paused', pauseReason: 'transport-blocked', startedAt: old, mediaUrl: 'data:image/png;base64,QUJD',
      },
      [P('bot/promotions/logs/done_d')]: { '9812345678': { status: 'sent', sentAt: old } },
    }));
    await engineFor(db, {}).expireOldPromoLogs();
    assert.strictEqual(db.get(P('bot/promotions/campaigns/done_d')), null, 'a 40-day-old finished campaign goes');
    assert.strictEqual(db.get(P('bot/promotions/logs/done_d')), null, 'and its log');
    const paused = db.get(P('bot/promotions/campaigns/paused_p'));
    assert.ok(paused, "a paused campaign is the owner's to act on - never deleted");
    assert.ok(paused.mediaUrl == null, 'but its inline image is dead weight');
  });

  // -------------------------------------------------------------------------
  // Source pins
  // -------------------------------------------------------------------------
  console.log('\n== source pins ==');

  const botPromotions = read('bot/promotions.js');
  const botIndex = read('bot/index.js');
  const botCommandsTs = read('FIREBASE_SERVER_MIGRATION/functions/src/triggers/botCommands.ts');
  const relayTs = read('FIREBASE_SERVER_MIGRATION/functions/src/triggers/promotionRelay.ts');
  const sweepTs = read('FIREBASE_SERVER_MIGRATION/functions/src/scheduled/promotionSweep.ts');
  const factoryTs = read('FIREBASE_SERVER_MIGRATION/functions/src/shared/promotions/factory.ts');
  const vendor = read('FIREBASE_SERVER_MIGRATION/functions/scripts/copy-vendor.cjs');
  const fnIndex = read('FIREBASE_SERVER_MIGRATION/functions/src/index.ts');
  const adminPromos = read('Admin/js/features/promotions.js');

  await check('the bot delegates to the ONE engine instead of keeping a second send path', () => {
    assert.ok(botPromotions.includes("require('./promotions-engine')"), 'bot/promotions.js must import the engine');
    assert.ok(/createPromotionsEngine\s*\(/.test(botPromotions), 'and build one');
    assert.ok(!/async function sendWithRetry\s*\(/.test(botPromotions), 'the old duplicate send path is gone');
  });

  await check('the bot gates its SEND_PROMOTION branch behind one flag and returns before the remove', () => {
    assert.ok(/function isPromotionsRelayEnabled/.test(botIndex), 'the bot needs the flag reader');
    // Slice the branch itself (up to the next action) so the assertion cannot be
    // satisfied by a later branch or a distant comment.
    const start = botIndex.indexOf('cmd.action === "SEND_PROMOTION"');
    const end = botIndex.indexOf('cmd.action === "SEND_GENERIC_MESSAGE"');
    const branch = botIndex.slice(start, end > start ? end : start + 2200);
    assert.ok(start > -1, 'the SEND_PROMOTION branch exists');
    assert.ok(/isPromotionsRelayEnabled\(\)/.test(branch), 'the branch must check the flag');
    const gateAt = branch.indexOf('isPromotionsRelayEnabled()');
    const returnAt = branch.indexOf('return;', gateAt);
    assert.ok(gateAt > -1 && returnAt > gateAt, 'the gate must return so the shared remove is never reached');
    // And the shared remove must still sit after the hand-off (i.e. the relay
    // keeps the command alive) — the bot must not delete it before the trigger reads it.
    const removeAt = botIndex.indexOf('snap.ref.remove()');
    assert.ok(removeAt > botIndex.indexOf('isPromotionsRelayEnabled()'), 'the shared remove stays after the branch');
  });

  await check('the bot gates pickup / resume / expiry on the same flag', () => {
    const sites = botIndex.split('isPromotionsRelayEnabled()').length - 1;
    assert.ok(sites >= 4, 'expected the command branch plus pickup + resume + expiry, found ' + sites);
  });

  await check('the cloud triggers are no-ops unless config/promotionsRelay/enabled === true', () => {
    for (const [name, src] of [['promotionRelay', relayTs], ['promotionSweep', sweepTs], ['botCommands', botCommandsTs]]) {
      assert.ok(src.includes('promotionsRelay'), name + ' must read config/promotionsRelay');
      assert.ok(/enabled === true/.test(src), name + ' must require an explicit true');
    }
  });

  await check('the relay listens on the status leaf, never the campaign node', () => {
    assert.ok(/campaigns\/\{campaignId\}\/status/.test(relayTs), 'status leaf only');
    assert.ok(!/onValueWritten\('bot\/promotions\/campaigns\/\{campaignId\}'/.test(relayTs));
  });

  await check('the sweep never reads the whole campaigns node every minute', () => {
    assert.ok(/meta\/promotionsActive/.test(sweepTs), 'an active index keeps an idle tick at ~0 bytes');
    assert.ok(!/bot\/promotions\/campaigns'\)\.once/.test(sweepTs), 'no full-node read per tick');
  });

  await check('the sweep runs expiry daily, not per minute', () => {
    assert.ok(/expireOldPromoLogs/.test(sweepTs), 'the sweep owns expiry');
    assert.ok(/EXPIRY_EVERY_MS|lastExpiryAt|meta\/promotionsSweep/.test(sweepTs), 'behind a daily gate');
  });

  await check('the demo tenant is hard-skipped', () => {
    for (const [name, src] of [['promotionRelay', relayTs], ['promotionSweep', sweepTs]]) {
      assert.ok(src.includes('foodhubbie-demo'), name + ' must skip the demo tenant');
    }
  });

  await check('both new modules are vendored into the Functions bundle', () => {
    assert.ok(vendor.includes('promotions-rules.js'), 'rules must be vendored');
    assert.ok(vendor.includes('promotions-engine.js'), 'engine must be vendored');
    assert.ok(fnIndex.includes('promotionRelay'), 'index.ts must export the relay');
    assert.ok(fnIndex.includes('promotionSweep'), 'index.ts must export the sweep');
  });

  await check('the engine never imports the bot runtime', () => {
    for (const rel of ['bot/promotions-engine.js', 'bot/promotions-rules.js']) {
      const src = read(rel);
      const requires = [...src.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
      for (const r of requires) {
        assert.ok(!/^(baileys|\.\/firebase|\.\/utils|\.\/index)/.test(r), rel + ' must not require ' + r);
      }
    }
  });

  await check('the factory builds the engine with the tenant paths, never a reverse-index guess', () => {
    assert.ok(/makePromotionEngine/.test(factoryTs), 'factory export');
    assert.ok(/makePromotionTransport/.test(factoryTs), 'transport export');
    assert.ok(/businesses\/\$\{bid\}\/outlets\/\$\{oid\}/.test(factoryTs), 'tenant from the event path');
    assert.ok(/walletBilling/.test(factoryTs), 'billingPath must target the server-only ledger');
  });

  await check('Admin renders the new pause reasons and the quiet-hours wait', () => {
    assert.ok(adminPromos.includes("'no-number'"), 'no-number pause copy');
    assert.ok(/waitingUntil/.test(adminPromos), 'the waiting-for-quiet-hours card line');
  });

  // `bot/commands` is a TENANT node. The trigger listens on the tenant path, so a
  // writer that queued to the platform root would be invisible to it - the exact
  // confusion the live E2E hit (it wrote root `bot/commands` and the command was
  // never drained). Every dashboard writer must queue into its own outlet.
  await check('every promotion writer queues into the TENANT bot/commands path', () => {
    assert.ok(
      /ref:\s*'businesses\/\{bid\}\/outlets\/\{oid\}\/bot\/commands\/\{commandId\}'/.test(botCommandsTs),
      'the trigger ref must be tenant-scoped',
    );
    assert.ok(
      /push\(tenantRef\(_outlet\(\), 'bot\/commands'\)\)/.test(adminPromos),
      'Admin promotions must queue into its own outlet',
    );
    const adminChat = read('Admin/js/features/chat.js');
    assert.ok(/push\(Outlet\.ref\('bot\/commands'\)\)/.test(adminChat), 'Admin chat must queue into its own outlet');
    assert.ok(!/\.ref\('bot\/commands'\)/.test(adminPromos), 'never the platform-root queue');
  });

  // -------------------------------------------------------------------------
  // Mutation self-test
  // -------------------------------------------------------------------------
  // The header promises this mode, so it must exist: each entry breaks one pin's
  // premise and proves the pin's own assertion now FAILS. If a pin is ever
  // loosened to satisfy a refactor, this is what says so.
  if (process.argv.includes('--self-test')) {
    console.log('\n== mutation self-test ==');
    const mutations = [
      {
        name: 'the bot re-grows a second send path',
        src: botPromotions,
        apply: (m) => all(m, "require('./promotions-engine')", "require('./promotions-legacy')"),
        holds: (m) => m.includes("require('./promotions-engine')"),
      },
      {
        name: 'the bot keeps sending campaigns while the cloud owns them',
        src: botIndex,
        apply: (m) => all(m, 'if (await isPromotionsRelayEnabled()) {', 'if (false) {'),
        holds: (m) => {
          const start = m.indexOf('cmd.action === "SEND_PROMOTION"');
          const end = m.indexOf('cmd.action === "SEND_GENERIC_MESSAGE"');
          return start >= 0 && end > start && /isPromotionsRelayEnabled\(\)/.test(m.slice(start, end));
        },
      },
      {
        name: 'a trigger treats "not disabled" as enabled',
        src: relayTs,
        apply: (m) => all(m, 'enabled === true', 'enabled !== false'),
        holds: (m) => /enabled === true/.test(m),
      },
      {
        name: 'the sweep downloads every campaigns node every minute',
        src: sweepTs,
        apply: (m) => m + "\nawait db.ref('bot/promotions/campaigns').once('value');\n",
        holds: (m) => !/bot\/promotions\/campaigns'\)\.once/.test(m),
      },
      {
        name: 'the sweep stops owning the 30-day expiry',
        src: sweepTs,
        apply: (m) => all(m, 'expireOldPromoLogs', 'noopExpiry'),
        holds: (m) => /expireOldPromoLogs/.test(m),
      },
      {
        name: 'the demo tenant gets marketed to',
        src: relayTs,
        apply: (m) => all(m, 'foodhubbie-demo', 'not-the-demo'),
        holds: (m) => m.includes('foodhubbie-demo'),
      },
      {
        name: 'the engine stops being vendored',
        src: vendor,
        apply: (m) => all(m, 'promotions-engine.js', 'promotions-engine-gone.js'),
        holds: (m) => m.includes('promotions-engine.js'),
      },
      {
        name: 'the Admin card cannot explain a no-number pause',
        src: adminPromos,
        apply: (m) => all(m, "'no-number'", "'no-phone'"),
        holds: (m) => m.includes("'no-number'"),
      },
      {
        name: 'a promotion writer queues to the platform root instead of the tenant',
        src: adminPromos,
        apply: (m) =>
          all(m, "push(tenantRef(_outlet(), 'bot/commands'))", "push(ref('bot/commands'))"),
        holds: (m) =>
          /push\(tenantRef\(_outlet\(\), 'bot\/commands'\)\)/.test(m) && !/\.ref\('bot\/commands'\)/.test(m),
      },
    ];
    for (const mut of mutations) {
      try {
        const mutated = mut.apply(mut.src);
        assert.ok(mutated !== mut.src, 'mutation was a no-op: ' + mut.name);
        assert.ok(!mut.holds(mutated), 'the pin did NOT catch: ' + mut.name);
        passed += 1;
        console.log('  PASS  mutation caught: ' + mut.name);
      } catch (err) {
        failed += 1;
        console.log('  FAIL  mutation self-test: ' + mut.name + '\n        ' + ((err && err.message) || err));
      }
    }
  }

  console.log('\n' + (failed === 0
    ? `${process.argv.includes('--self-test') ? 'ALL PASS (including mutations)' : 'ALL PASS'} - ${passed} checks`
    : `${passed} passed, ${failed} FAILED`));
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
