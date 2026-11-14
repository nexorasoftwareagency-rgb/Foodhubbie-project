/**
 * Chat tab guard (tests/chat-tab.check.cjs)
 * ============================================================================
 * Pins the invariants that broke the WhatsApp (Chat) tab in production:
 *   - the thread list reads the flat chatMeta mirror through query()
 *     (a Reference has no .orderByChild — that bug left the list empty on
 *     every open for months; see tests/admin-query-chain.check.cjs);
 *   - message bodies bind only for the ONE open thread (never the list);
 *   - replies go through the existing bot/commands channel (no new send path);
 *   - the bot-onboarding wall is dismissible — chat history must stay
 *     reachable while the bot is stopped / awaiting a QR re-pair
 *     (pair.status is frozen state, not a live heartbeat).
 * Run: node tests/chat-tab.check.cjs   (npm run test:chat-tab)
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'Admin', 'js', 'features', 'chat.js'), 'utf8');

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  PASS ' + msg); else { console.error('  FAIL ' + msg); fails++; } };

// Strip line comments (chat.js quotes the old buggy call in a NOTE comment —
// the negative check below must judge code, not prose). Guard against `://`.
// Normalize CRLF first: `.` does not match `\r`, so an anchored `.*$` never
// reaches the end of a CRLF line.
const code = src.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

ok(/_listener = onValue\(query\(Outlet\.ref\('chatMeta'\), orderByChild\('lastTs'\), limitToLast\(50\)\)/.test(src),
   'thread list = query(chatMeta, orderByChild(lastTs), limitToLast(50)) — never a whole-node listen');
ok(!/_chatRef\(''\)\s*\.\s*orderBy/.test(code), 'no Reference.orderByChild ordering (the bug class)');
ok(/onValue\(_chatRef\(`\$\{customerId\}\/messages`\)/.test(src), 'message bodies bind per open thread only');
ok(/push\(Outlet\.ref\('bot\/commands'\)\)/.test(src) && /action:\s*'SEND_GENERIC_MESSAGE'/.test(src),
   'replies go through the existing bot/commands channel');
ok(/let _onboardingDismissed = false;/.test(src), 'onboarding dismissal state exists');
ok(/_onboardingDismissed = false; \/\/ fresh visit/.test(src), 'dismissal resets on every loadChat (fresh visit sees onboarding)');
ok(/else if \(!_onboardingDismissed\) _showOnboarding\(pair\)/.test(src),
   'apply() honours dismissal — the wall cannot re-cover history mid-visit');
ok(/id="waViewHistory"/.test(src) && /_onboardingDismissed = true;/.test(src) && /_hideOnboarding\(\);/.test(src),
   'escape hatch button wired: dismiss + hide');

if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
console.log('\nAll chat-tab checks passed');
