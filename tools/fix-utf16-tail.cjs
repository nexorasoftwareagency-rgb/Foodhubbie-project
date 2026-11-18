/* Locate and repair UTF-16LE tails appended into UTF-8 files.
 *
 * Symptom: `tests/encoding-check.mjs` reports "U+FFFD replacement char", and
 * `ledger.py brief` dies with UnicodeDecodeError. Cause: a Windows PowerShell
 * `Add-Content` / `Out-File` (default encoding UTF-16LE) appended to a file
 * that was otherwise UTF-8. The tail is then double-encoded: every ASCII
 * character is followed by a NUL byte, and non-ASCII bytes become invalid
 * UTF-8 (rendered as U+FFFD).
 *
 *   node tools/fix-utf16-tail.cjs <file>            # report only
 *   node tools/fix-utf16-tail.cjs <file> --fix      # repair in place
 *
 * The repair is byte-precise: the clean UTF-8 prefix is kept verbatim, only
 * the damaged tail is re-decoded as UTF-16LE and re-encoded as UTF-8. It
 * refuses to write unless the result has no NUL, no U+FFFD, and still contains
 * the section headings that were in the damaged region.
 */
const fs = require('fs');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const FIX = args.includes('--fix');
if (!file) {
    console.error('usage: node tools/fix-utf16-tail.cjs <file> [--fix]');
    process.exit(2);
}

const buf = fs.readFileSync(file);

// 1. Find the first NUL byte — inside valid UTF-8 text a NUL never appears.
let firstNul = -1;
for (let i = 0; i < buf.length; i++) { if (buf[i] === 0) { firstNul = i; break; } }
if (firstNul < 0) {
    console.log(`${file}: no NUL bytes — clean`);
    process.exit(0);
}

// 2. Find the true UTF-16LE boundary: the earliest offset whose tail decodes
//    to text with no NUL, no U+FFFD, and whose prefix is valid UTF-8.
function decodeAt(offset) {
    const tail = buf.slice(offset).toString('utf16le');
    const prefix = buf.slice(0, offset).toString('utf8');
    return {
        offset,
        tail,
        prefix,
        clean: !tail.includes('\u0000') && !tail.includes('\uFFFD')
            && !prefix.includes('\uFFFD') && /\n/.test(tail),
    };
}

let best = null;
for (let off = Math.max(0, firstNul - 16); off <= firstNul + 16; off++) {
    const c = decodeAt(off);
    if (c.clean && (best === null || c.offset < best.offset)) best = c;
}
if (!best) {
    console.error(`${file}: no clean UTF-16LE boundary found near byte ${firstNul}`);
    process.exit(1);
}

const fixed = best.prefix + best.tail;
console.log(`${file}`);
console.log(`  damaged region : byte ${best.offset} .. EOF (${buf.length - best.offset} bytes)`);
console.log(`  tail starts    : ${JSON.stringify(best.tail.slice(0, 70))}`);
console.log(`  fixed size     : ${Buffer.byteLength(fixed, 'utf8')} bytes`);

if (fixed.includes('\u0000') || fixed.includes('\uFFFD')) {
    console.error('  REFUSING to write — result still damaged');
    process.exit(1);
}
if (FIX) {
    fs.writeFileSync(file, Buffer.from(fixed, 'utf8'));
    console.log('  WROTE repaired file');
} else {
    console.log('  dry run — pass --fix to write');
}
