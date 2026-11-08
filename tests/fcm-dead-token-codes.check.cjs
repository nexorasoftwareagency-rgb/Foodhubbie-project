// FCM dead-token prune list — only token-scoped codes may delete a token.
// Run: node tests/fcm-dead-token-codes.check.cjs
//
// `DEAD_PUSH_CODES` drives token deletion in all four push paths (admins,
// riders, customer order pushes, tier-up pushes). Only codes that mean "this
// TOKEN is dead" belong there. `messaging/invalid-argument` is a message-level
// rejection: one malformed payload fails every token in the batch with it, so
// pruning on it would wipe an outlet's whole subscriber list from a single bad
// send. That regression is what this guard locks down.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'bot', 'index.js'), 'utf8');

const setSrc = src.match(/const DEAD_PUSH_CODES = new Set\(\[[\s\S]*?\]\);/);
assert.ok(setSrc, 'DEAD_PUSH_CODES set not found in bot/index.js');

const fnSrc = src.match(/function isDeadPushCode\(code\) \{[\s\S]*?\n\}/);
assert.ok(fnSrc, 'isDeadPushCode() not found in bot/index.js');

// Run the real source, not a copy of the expected list.
const isDeadPushCode = new Function(`${setSrc[0]}\n${fnSrc[0]}\nreturn isDeadPushCode;`)();

// ---- 1. token-scoped codes prune -------------------------------------------
for (const code of [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/mismatched-credential',
    'messaging/third-party-auth-error',
]) {
    assert.equal(isDeadPushCode(code), true, `${code} must prune the token`);
}
console.log('  ok  token-scoped codes prune');

// ---- 2. message-level / unknown codes never prune ---------------------------
for (const code of [
    'messaging/invalid-argument',
    'messaging/invalid-payload',
    'messaging/authentication-error',
    'messaging/server-unavailable',
    'messaging/unknown-error',
    '',
    undefined,
    null,
]) {
    assert.equal(isDeadPushCode(code), false, `${String(code)} must NOT prune the token`);
}
console.log('  ok  message-level and unknown codes are kept');

// ---- 3. every push path routes through the shared helper --------------------
function bodyOf(name) {
    const start = src.indexOf(`async function ${name}(`);
    assert.ok(start !== -1, `${name}() not found`);
    const rest = src.slice(start + 1);
    const next = rest.search(/\n(?:async )?function /);
    return next === -1 ? rest : rest.slice(0, next);
}

for (const fn of ['sendFCMToAdmins', 'sendFCMToRider', 'notifyCustomerApp', 'notifyTierUp']) {
    const body = bodyOf(fn);
    assert.ok(body.includes('isDeadPushCode('), `${fn}() must prune through isDeadPushCode()`);
    assert.ok(
        !/deadCodes\.has\(|code === 'messaging\//.test(body),
        `${fn}() must not keep a private dead-code list`,
    );
}
console.log('  ok  all four push paths use the shared helper');

// ---- 4. rider cleanup stamps the record so the app re-registers -------------
const rider = bodyOf('sendFCMToRider');
assert.ok(rider.includes('riders/${riderId}/fcmToken'), 'rider dead token is removed');
assert.ok(rider.includes('fcmTokenInvalidAt'), 'rider record is stamped for re-registration');
console.log('  ok  rider dead token is pruned and stamped');

console.log('\nRESULT: dead-token prune list is token-scoped only');
