// Keeps the "Live in app" / "Saved, not applied yet" labels honest.
// Live controls: the real customer-app source must contain the marker that reads them.
// Not-applied controls: the customer app (menu/) and bot must not read the saved key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CONTROLS } from '../Admin/js/features/customer-app-status.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|html)$/.test(e.name) ? [path.join(d, e.name)] : []);
const appSrc = walk(path.join(root, 'menu')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
let failed = 0;
const t = (n, fn) => { try { fn(); console.log('ok  ', n); } catch (e) { failed++; console.log('FAIL', n, '-', e.message); } };

for (const [key, c] of Object.entries(APP_CONTROLS)) {
    assert.ok(c.label && c.note, key + ' needs a label and a note');
    if (c.live && c.reads) t(`LIVE ${key}: app reads it (${c.reads[1]})`, () => {
        assert.ok(fs.readFileSync(path.join(root, c.reads[0]), 'utf8').includes(c.reads[1]), `marker "${c.reads[1]}" not found in ${c.reads[0]} - flip the label to "Saved, not applied yet" if the app stopped reading it`);
    });
}
// Keys the app must NOT read yet (if one of these starts failing, wire-up happened: flip live to true and add `reads`).
const NOT_READ = { appWelcomeMessage: /appWelcomeMessage/, themeColor: /settings\/Store[\s\S]{0,300}themeColor|\bs\.themeColor|\bstore\.themeColor/, logoUrl: /\bs\.logoUrl|\bstore\.logoUrl|\bsettings\.logoUrl/, businessHours: /\bs\.businessHours|\bstore\.businessHours/, minOrder: /\bs\.minOrder|\bstore\.minOrder|\bsettings\.minOrder/, deliveryFee: /\bs\.deliveryFee|\bstore\.deliveryFee|\bsettings\.deliveryFee/, appFeatures: /appFeatures/ };
for (const [key, re] of Object.entries(NOT_READ)) t(`SAVED-ONLY ${key}: app does not read it`, () => {
    assert.equal(APP_CONTROLS[key].live, false, key + ' must be flagged not-applied here');
    assert.ok(!re.test(appSrc), `customer app now seems to read ${key} - update APP_CONTROLS (live:true + reads)`);
});
console.log(failed ? `\n${failed} FAILED` : '\nall passed'); process.exit(failed ? 1 : 0);
