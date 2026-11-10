/**
 * Orchestrator scope + egress guard.
 *
 * Two things are protected here:
 *
 * 1. SCOPE — the stop branch is destructive: `!shouldRun && running &&
 *    bot.source === 'orchestrator'` stops a live worker. `desiredState()` must
 *    therefore return null (not false) for any outlet it does not own,
 *    including one whose `whatsapp` node exists only because a template-status
 *    webhook wrote `whatsapp/templates/*`.
 *
 * 2. EGRESS — RTDB sends the whole subtree to a listener the moment it
 *    attaches. A listener on `businesses` cost 5,274,244 bytes per attach and
 *    re-attached on every socket reconnect (~1.5 GB/day at 41 outlets, and it
 *    scales with the tree). `startOrchestrator` may only listen on leaf nodes
 *    and on the tiny `outletIndex`.
 *
 * Run: node tests/orchestrator-scope.check.cjs
 */
const assert = require('assert');
const Module = require('module');

// pm2 only exists on EC2; neither the decision function nor discovery needs it.
const origLoad = Module._load;
const pm2Stub = {
  list: (cb) => cb(null, []),
  start: (opts, cb) => cb(null, {}),
  stop: (name, cb) => cb(null, {}),
  dump: (cb) => cb(null),
};
Module._load = function (request, ...rest) {
  if (request === './pm2-client') return { pm2: pm2Stub, connectOnce: async () => {} };
  return origLoad.call(this, request, ...rest);
};
const { desiredState, startOrchestrator } = require('../bot-control-api/orchestrator');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name} -> ${err.message}`);
  }
}

// ---------------------------------------------------------------- 1. scope
const cases = [
  ['no outlet object', null, null],
  ['outlet with no whatsapp node', { bot: { source: 'orchestrator' } }, null],
  ['template-only whatsapp node (the regression)', { whatsapp: { templates: { t: {} } } }, null],
  ['whatsapp node with no status', { whatsapp: { requestedConnect: true } }, null],
  ['pending link', { whatsapp: { status: 'pending' } }, false],
  ['active link', { whatsapp: { status: 'active' } }, true],
  ['active but suspended', { whatsapp: { status: 'active' }, suspended: true }, false],
  ['disabled link', { whatsapp: { status: 'disabled' } }, false],
];

for (const [name, outlet, expected] of cases) {
  check(`${name} -> ${JSON.stringify(desiredState(outlet))}`, () => {
    assert.strictEqual(desiredState(outlet), expected);
  });
}

// --------------------------------------------------------------- 2. egress
// Minimal in-memory RTDB stand-in that records which paths were LISTENED on.
function makeAdmin(seed) {
  const listened = [];
  const read = [];
  const snapshot = (path) => {
    const v = path.split('/').reduce((acc, k) => (acc == null ? undefined : acc[k]), seed);
    return { exists: () => v !== undefined, val: () => (v === undefined ? null : v) };
  };
  const makeRef = (path) => ({
    get: async () => { read.push(path); return snapshot(path); },
    once: async () => { read.push(path); return snapshot(path); },
    on: (event, cb) => { listened.push({ path, event }); if (cb) cb(snapshot(path)); },
    child: (k) => makeRef(path ? `${path}/${k}` : k),
    key: path.split('/').pop(),
    val: () => (snapshot(path).exists() ? snapshot(path).val() : null),
    exists: () => snapshot(path).exists(),
    update: async () => {},
    set: async () => {},
    remove: async () => {},
    push: () => ({ key: 'k', set: async () => {} }),
  });
  return { admin: { database: Object.assign(() => ({ ref: makeRef }), { ref: makeRef, ServerValue: { TIMESTAMP: 1 } }) }, listened, read };
}

const seed = {
  outletIndex: { pizza: { bid: 'roshani-pizza' }, cake: { bid: 'roshani-cake' } },
  businesses: {
    'roshani-pizza': {
      outlets: {
        // meta-managed, link still pending -> reconcile but never start
        pizza: { whatsapp: { status: 'pending', phoneNumberId: '123' }, bot: { source: 'orchestrator' } },
      },
    },
    'roshani-cake': {
      outlets: {
        // baileys-only: no whatsapp node -> out of scope entirely
        cake: { bot: { source: 'manager' } },
      },
    },
  },
};

(async () => {
  const { admin, listened } = makeAdmin(seed);
  await startOrchestrator({ admin, processName: (bid, oid) => `bot-${bid}-${oid}`, nextHealthPort: async () => 3001 });

  const bad = listened.filter(({ path }) => {
    // allowed: the tiny registry, and per-outlet scalar leaves only
    if (path === 'outletIndex') return false;
    return !(path.endsWith('/whatsapp/status') || path.endsWith('/suspended'));
  });
  check(`listened only on leaves (${listened.length} listeners, ${new Set(listened.map((l) => l.path)).size} paths)`, () => {
    assert.deepStrictEqual(bad, [], `forbidden listener path(s): ${bad.map((b) => b.path).join(', ')}`);
  });

  check('no listener on businesses or an outlet subtree', () => {
    for (const { path } of listened) {
      assert.ok(path !== 'businesses', 'listener on businesses would download the whole 5 MB tree');
      assert.ok(!/^businesses\/[^/]+\/outlets\/[^/]+$/.test(path), `listener on outlet subtree: ${path}`);
      assert.ok(!/^businesses\/[^/]+\/outlets$/.test(path), `listener on outlets: ${path}`);
    }
  });

  check('every watched outlet is reachable from outletIndex or the boot scan', () => {
    const paths = new Set(listened.map((l) => l.path));
    assert.ok(paths.has('businesses/roshani-pizza/outlets/pizza/whatsapp/status'));
    assert.ok(paths.has('businesses/roshani-cake/outlets/cake/whatsapp/status'));
  });

  console.log(failed ? `\n${failed} failed` : `\n${8 + 3} checks passed`);
  process.exit(failed ? 1 : 0);
})();
