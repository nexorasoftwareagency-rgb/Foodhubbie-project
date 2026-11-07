// Byte-identity guard for the shared/ copies served by the raw hosts.
//
// Admin and Supreme are built (esbuild copies repo-root shared/ into dist), but
// menu/, website/ and rider-app/public/ are served as-is and cannot reach the
// repo-root /shared directory, so each shared module ships a byte-identical
// twin there. This guard fails the moment any pair drifts — drift here
// misprices customer orders, breaks the menu module graph, or leaves a site
// with an update watcher that no longer matches the others.
//
// menu/shared/config/ is menu-only (vapid keys), not a twin — excluded.
//
// Run: node tools/check-shared-twins.cjs   (exit 1 on drift)

const fs = require('fs');

const PAIRS = [
    ['shared/combo-math.js', 'menu/shared/combo-math.js'],
    ['shared/discount-rules.js', 'menu/shared/discount-rules.js'],
    ['shared/format-order-id.js', 'menu/shared/format-order-id.js'],
    ['shared/money-math.js', 'menu/shared/money-math.js'],
    ['shared/loyalty-math.js', 'menu/shared/loyalty-math.js'],
    // Every site shows the same update prompt, each served from its own origin.
    ['shared/app-update.js', 'menu/shared/app-update.js'],
    ['shared/app-update.js', 'website/shared/app-update.js'],
    ['shared/app-update.js', 'rider-app/public/app-update.js'],
];

let failed = false;
for (const [canon, twin] of PAIRS) {
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
