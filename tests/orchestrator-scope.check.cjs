/**
 * Orchestrator scope guard.
 *
 * The stop branch is destructive: `!shouldRun && running && bot.source ===
 * 'orchestrator'` stops a live worker. `desiredState()` must therefore return
 * null (not false) for any outlet it does not own — including one whose
 * `whatsapp` node exists only because a template-status webhook wrote
 * `whatsapp/templates/*`.
 *
 * Run: node tests/orchestrator-scope.check.cjs
 */
const assert = require('assert');
const Module = require('module');

// pm2 only exists on EC2; the pure decision function does not need it.
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === './pm2-client') return { pm2: {}, connectOnce: async () => {} };
  return origLoad.call(this, request, ...rest);
};
const { desiredState } = require('../bot-control-api/orchestrator');

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

let failed = 0;
for (const [name, outlet, expected] of cases) {
  const actual = desiredState(outlet);
  try {
    assert.strictEqual(actual, expected);
    console.log(`PASS  ${name} -> ${JSON.stringify(actual)}`);
  } catch {
    failed++;
    console.log(`FAIL  ${name} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  }
}

console.log(failed ? `\n${failed} failed` : `\n${cases.length}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
