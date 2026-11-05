// Byte-identity guard for the shared/ ↔ menu/shared/ twins.
//
// menu/ is served raw (no esbuild) and menu hosting cannot reach repo-root
// /shared (the SPA rewrite 40s it — see menu/shared/format-order-id.js), so
// each shared module ships a byte-identical twin under menu/shared/. This
// guard fails the moment any pair drifts — drift here misprices customer
// orders or breaks the menu module graph.
//
// menu/shared/config/ is menu-only (vapid keys), not a twin — excluded.
//
// Run: node tools/check-shared-twins.cjs   (exit 1 on drift)

const fs = require('fs');

const PAIRS = [
    'combo-math.js',
    'discount-rules.js',
    'format-order-id.js',
    'money-math.js',
    'loyalty-math.js',
];

let failed = false;
for (const name of PAIRS) {
    const canon = `shared/${name}`;
    const twin = `menu/shared/${name}`;
    if (!fs.existsSync(canon) || !fs.existsSync(twin)) {
        console.error(`FAIL: missing twin — expected both ${canon} and ${twin} to exist`);
        failed = true;
        continue;
    }
    const a = fs.readFileSync(canon, 'utf8');
    const b = fs.readFileSync(twin, 'utf8');
    if (a !== b) {
        console.error(`FAIL: ${canon} and ${twin} drifted — copy one over the other (they must be byte-identical).`);
        failed = true;
    } else {
        console.log(`OK: ${canon} == ${twin} (byte-identical)`);
    }
}
process.exit(failed ? 1 : 0);
