// Check for the audit-prune cutoff key (Admin/js/log-prune.js).
// Run: node tests/test-log-prune.mjs
import assert from 'node:assert/strict';
import { pushKeyFor, AUDIT_RETENTION_MS } from '../Admin/js/log-prune.js';

const CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const decode = (k) => {
    let t = 0;
    for (let i = 0; i < 8; i++) t = t * 64 + CHARS.indexOf(k[i]);
    return t;
};

const now = Date.parse('2026-09-28T12:00:00Z');
const key = pushKeyFor(now);

// round-trip: first 8 chars decode back to the millisecond timestamp
assert.ok(Math.abs(decode(key) - now) <= 1, `round-trip: decoded ${decode(key)} vs ${now}`);

// monotonic: older timestamps sort lexicographically smaller
assert.ok(pushKeyFor(now - 1) < key, 'older key sorts first');
assert.ok(key < pushKeyFor(now + 1), 'newer key sorts last');

// endAt semantics: an entry minted 31d ago (any random tail) is <= the 30d
// cutoff; one minted 29d ago is > cutoff. 30d is where AUDIT_RETENTION_MS points.
const cutoff = pushKeyFor(now - AUDIT_RETENTION_MS);
const oldEntry = pushKeyFor(now - 31 * 864e5) + 'AbCdEf';
const recentEntry = pushKeyFor(now - 29 * 864e5) + 'AbCdEf';
assert.ok(oldEntry <= cutoff, '31d-old entry falls under cutoff (gets pruned)');
assert.ok(recentEntry > cutoff, '29d-old entry survives cutoff');

console.log('test-log-prune: OK');
