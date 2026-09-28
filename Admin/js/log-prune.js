// Pure helpers for audit-log retention pruning (P3-8 #2: logs/ = 67% of all
// RTDB nodes, grows unbounded). No firebase imports so tests/ can run it in node.

// ponytail: fixed 30-day audit retention — bump this one constant if disputes need longer
export const AUDIT_RETENTION_MS = 30 * 864e5;

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

// Firebase push-ID time prefix: big-endian base64 of ms epoch in 8 chars
// (48 bits). Sorts lexicographically before every push-id minted after `ts`, so
// `orderByKey().endAt(pushKeyFor(ts))` selects exactly the entries older than ts.
export function pushKeyFor(ts) {
    let v = Math.floor(ts);
    let s = '';
    for (let i = 0; i < 8; i++) {
        s = PUSH_CHARS[v % 64] + s;
        v = Math.floor(v / 64);
    }
    return s;
}
