/**
 * Admin SW fetch-handler guard (tests/admin-sw-networkfirst.check.cjs)
 * ============================================================================
 * Pins the invariant that broke app.foodhubbie.in on 2026-11-15 (and produced
 * EVERY mixed-bundle incident before it: SUPPORT_WA / initPushUI /
 * chat.js orderByChild — stale module served next to a fresh one):
 *
 *   sw.js's own header comment claimed "Network-Only … do NOT consult the
 *   cache for app code" while the same-origin fetch handler was actually
 *   cache-first stale-while-revalidate (`return cached || fetchPromise`).
 *   Feature files not in ASSETS_TO_CACHE (chat.js, wallet-alert.js, …) could
 *   go stale in any browser for a whole SW lifetime.
 *
 * The fix makes the code match the documented intent: app code
 * (.js/.html/.json + navigations) is NETWORK-FIRST — network wins, the cache
 * is only the offline fallback; stale-while-revalidate remains for versioned
 * static assets (CSS ?v=, images, sounds).
 *
 * Run: node tests/admin-sw-networkfirst.check.cjs   (npm run test:admin-sw)
 * NOTE: sw.js is CRLF — normalize first, `.` does not match `\r`.
 */
const fs = require('fs');
const path = require('path');
// SW_FILE overrides the file under test so the mutation self-test can point
// the guard at a reverted copy (it must FAIL there).
const file = process.env.SW_FILE || path.join(__dirname, '..', 'Admin', 'sw.js');
const raw = fs.readFileSync(file, 'utf8');

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  PASS ' + msg); else { console.error('  FAIL ' + msg); fails++; } };

const src = raw.replace(/\r\n/g, '\n');
const code = src.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

// --- 1. Versioned cache name (a bump is the clean-cache mechanism) ----------
ok(/const CACHE_NAME = 'foodhubbie-erp-shell-v5\.12\.\d+';/.test(code),
   'CACHE_NAME is versioned (foodhubbie-erp-shell-v5.12.x)');

// --- 2. The app-code classifier exists with all four conditions -------------
ok(/const isAppCode = p\.endsWith\('\.js'\) \|\| p\.endsWith\('\.html'\) \|\|\n\s*p\.endsWith\('\.json'\) \|\| event\.request\.mode === 'navigate';/.test(code),
   "isAppCode = .js/.html/.json endings + request.mode === 'navigate'");

// --- 3. The app-code branch is network-first --------------------------------
const iBranch = code.indexOf('if (isAppCode) {');
ok(iBranch !== -1, 'app-code branch exists (if (isAppCode) { … return; })');
if (iBranch !== -1) {
  const end = code.indexOf('return;', iBranch);
  ok(end !== -1, 'app-code branch terminates with its own return;');
  const slice = end !== -1 ? code.slice(iBranch, end) : '';
  const iFetch = slice.indexOf('fetch(event.request)');
  const iMatch = slice.indexOf('caches.match(event.request)');
  ok(iFetch !== -1, 'app-code branch calls fetch(event.request)');
  ok(iMatch !== -1, 'app-code branch has the offline cache fallback');
  ok(iFetch !== -1 && iMatch !== -1 && iFetch < iMatch,
     'NETWORK-FIRST: fetch wins, caches.match only in the .catch fallback');
  ok(/cached \|\| Response\.error\(\)/.test(slice),
     'offline fallback answers cached || Response.error() (no cached-first)');
  ok(/caches\.open\(CACHE_NAME\)\.then\(\(cache\) => cache\.put\(event\.request, clone\)\)/.test(slice),
     'app-code branch revalidates the cache (200 → cache.put)');
  ok(!/return cached \|\|/.test(slice),
     'app-code branch never returns cache-first');
}

// --- 4. S-W-R remains ONLY for static assets (exactly one cache-first exit) --
const swrCount = (code.match(/return cached \|\| fetchPromise;/g) || []).length;
ok(swrCount === 1,
   'exactly ONE `return cached || fetchPromise` remains (stale-while-revalidate = static assets only)');
const iBranchOk = iBranch !== -1;
const iSwr = code.indexOf('return cached || fetchPromise;');
ok(iBranchOk && iSwr !== -1 && iBranch < iSwr,
   'app-code branch precedes the S-W-R block (static fallback cannot shadow app code)');

// --- 5. Bypasses that must survive any rewrite ------------------------------
ok(/pathname\.endsWith\('\/version\.json'\)\) return;/.test(code),
   '/version.json bypass retained (a stale version hides the Update-app prompt)');
ok(/includes\('firebaseio\.com'\)\) return;/.test(code), 'RTDB bypass retained');
ok(/includes\('identitytoolkit\.googleapis\.com'\)\) return;/.test(code), 'Firebase Auth bypass retained');
ok(/includes\('securetoken\.googleapis\.com'\)\) return;/.test(code), 'securetoken bypass retained');
ok(/origin !== self\.location\.origin\) return;/.test(code),
   'same-origin gate retained (cross-origin respondWith(undefined) would throw)');

if (fails) { console.error(`\n${fails} check(s) failed`); process.exit(1); }
console.log('\nAll admin-sw-networkfirst checks passed');
