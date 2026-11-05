import fs from 'fs';
import path from 'path';

// Regression tripwire for the admins/{uid} clobber bug (owner name pizza→Roshani Pizza rename
// would be reverted by update-password/provisioning). Guards the write shapes in bot-control-api/server.js.

const src = fs.readFileSync(path.resolve('bot-control-api/server.js'), 'utf8');

let pass = 0, fail = 0;
const assert = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

const setCount = (src.match(/ref\(`admins\/\$\{uid\}`\)\.set\(/g) || []).length;
const updateCount = (src.match(/ref\(`admins\/\$\{uid\}`\)\.update\(/g) || []).length;

assert(setCount === 1, `exactly 1 set() on admins/\${uid} (create-only), got ${setCount}`);
assert(/if \(!ownerSnap\.exists\(\)\)/.test(src), 'update-password mirror write guarded by !ownerSnap.exists()');
assert(updateCount === 1, `exactly 1 update() on admins/\${uid} (merge on provision), got ${updateCount}`);
assert(/\.\.\.\(curAdmin \? \{\} : \{ name: outletName \}\)/.test(src), 'provision preserves existing name (seeds outletName only for new records)');
assert(!/name: outletName, role: 'owner', businessId: bid,\s*\n\s*\}\);/.test(src.replace(/if \(!ownerSnap\.exists\(\)\)[\s\S]*?\n {4}\}/, '')), 'no unguarded wholesale owner set remains');

console.log(`RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
