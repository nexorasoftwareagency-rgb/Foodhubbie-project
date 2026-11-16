#!/usr/bin/env node
/**
 * Onboarding-create guard (batch 23k follow-up).
 *
 *   node tests/onboarding-create.check.cjs
 *
 * The Supreme "Add Restaurant" wizard writes the tenant in ONE atomic
 * multi-path update (businesses + walletBilling + outletIndex + menuBank). A
 * single denied path aborts all of it, so two rules/target bugs made every
 * template-based creation fail with `PERMISSION_DENIED` while the wizard
 * looked fine up to the last click:
 *
 *   1. `menuBank/categories/$slug/.write` allowed a super, but `.validate`
 *      demanded `sourceOid == admins/{uid}/outlet` — a super mirroring a
 *      template for a NEW outlet was denied (live 401; the real super has
 *      `outlet:'pizza'`, and other supers have no outlet at all).
 *   2. `menuBank/dishes/$slug/.validate` tested `sizes.val().length > 0`, but
 *      sizes is a MAP (`{Small,Medium,Large}`); `.length` on a non-string is a
 *      rules evaluation error, so every sized dish was denied.
 *   3. The wizard spread the template's `bot` block onto `outlet.bot`, while
 *      the status images are read from `settings/Bot` (bot/index.js
 *      `getData('settings/Bot')` and the Admin status-images card). New tenants
 *      got template images on a node nothing reads — the same class of bug as
 *      the deleted `bot/{key}Png` pre-pass (doc 39).
 *
 * Behaviour was proven live: rules probe 11/11 (`%TEMP%/opencode/
 * probe-menubank-super.cjs`), payload bisect (`probe-onboard-bisect.cjs`), and
 * the wizard E2E 28/28 (`e2e-23k-image-convert.cjs`). This file is the static
 * pin. No network, no credentials.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8');

// Mutation-test hooks (same pattern as tests/tables-session-window.check.cjs):
// point these at `git show HEAD:` copies to prove the guard fails on the
// pre-fix code.
const RULES_FILE = process.env.RULES_FILE || 'database.rules.json';
const WIZARD_FILE = process.env.WIZARD_FILE || 'SupremeAdmin/js/features/restaurant-onboarding.js';

let pass = 0;
const ok = (label, cond, detail) => {
  if (!cond) {
    console.error('  FAIL  ' + label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
    process.exitCode = 1;
    return;
  }
  pass++;
  console.log('  ok  ' + label);
};

// ---- rules ---------------------------------------------------------------
const rules = JSON.parse(read(RULES_FILE)).rules || {};
const catValidate = rules.menuBank?.categories?.$slug?.['.validate'] || '';
const catWrite = rules.menuBank?.categories?.$slug?.['.write'] || '';
const dishValidate = rules.menuBank?.dishes?.$cid?.['.validate'] || '';
const dishWrite = rules.menuBank?.dishes?.$cid?.['.write'] || '';

// 1. The category validate must grant the same super/supreme bypass its write
//    already grants, or a template mirror aborts the atomic create.
ok('categories.validate grants isSuper', /isSuper'\)\.val\(\) == true/.test(catValidate));
ok('categories.validate grants isSupreme', /isSupreme'\)\.val\(\) == true/.test(catValidate));
ok(
  'categories.validate still requires sourceOid',
  /newData\.hasChild\('sourceOid'\)/.test(catValidate)
);
ok(
  'categories.validate still binds a non-super admin to its own outlet',
  /newData\.child\('sourceOid'\)\.val\(\) == root\.child\('admins'\)\.child\(auth\.uid\)\.child\('outlet'\)\.val\(\)/.test(catValidate)
);
ok(
  'categories.write still binds a non-super admin to its own outlet',
  /newData\.child\('sourceOid'\)\.val\(\)/.test(catWrite) && /child\('outlet'\)\.val\(\)/.test(catWrite)
);

// 2. sizes is a map; `.length` on it is a rules evaluation error = hard deny.
ok(
  'dishes.validate no longer calls .val().length on sizes',
  !/child\('sizes'\)\.val\(\)\.length/.test(dishValidate)
);
ok(
  'dishes.validate accepts any non-empty sizes map',
  /!newData\.hasChild\('sizes'\) \|\| newData\.child\('sizes'\)\.hasChildren\(\)/.test(dishValidate)
);
ok('dishes.write still grants isSuper', /isSuper'\)\.val\(\) == true/.test(dishWrite));
ok(
  'dishes.validate still requires name/category/price',
  /newData\.hasChildren\(\['name', 'category', 'price'\]\)/.test(dishValidate)
);

// ---- wizard --------------------------------------------------------------
const wizard = read(WIZARD_FILE);

// 3. The template `bot` block must be split: images -> settings/Bot,
//    transport -> bot/transport.
ok(
  'wizard destructures transport out of the template bot block',
  /const \{ transport: tplTransport, \.\.\.tplBotImages \} = tplDefaults\?\.bot \|\| \{\}/.test(wizard)
);
ok('wizard writes the template images into settings/Bot', /Bot: tplBotImages/.test(wizard));
ok(
  'wizard writes transport to bot/transport',
  /\{ bot: \{ transport: tplTransport \} \}/.test(wizard)
);
ok(
  'wizard no longer spreads the whole template onto the outlet',
  !/\.\.\.\(tplDefaults \|\| \{\}\)/.test(wizard)
);
ok(
  'wizard still mirrors the template catalog onto the outlet',
  /tplDefaults\?\.categories \? \{ categories: tplDefaults\.categories \}/.test(wizard) &&
    /tplDefaults\?\.dishes \? \{ dishes: tplDefaults\.dishes \}/.test(wizard)
);
ok(
  'wizard still mirrors categories+dishes into menuBank with sourceOid',
  /menuBank\/categories\/\$\{_slug\(c\.name\)\}/.test(wizard) &&
    /menuBank\/dishes\/\$\{_slug\(`\$\{d\.name\}-\$\{d\.category \|\| 'other'\}`\)\}/.test(wizard) &&
    /sourceBid: bid, sourceOid: oid/.test(wizard)
);
ok(
  'wizard still keeps discountApproval OFF for new tenants',
  /discountApproval: false/.test(wizard)
);

// ---- premise -------------------------------------------------------------
// Template defaults must keep shipping https images, or the split above moves
// nothing (doc 39, section 2).
const seed = read('tools/seed-templates.cjs');
ok('template defaults still ship https status images', /imgConfirmed:\s*'https:\/\//.test(seed));

// The bot's read path is the whole premise of check 3 — pin it.
const bot = read('bot/index.js');
ok('bot reads status images from settings/Bot', /getData\("settings\/Bot"/.test(bot));

if (process.exitCode) {
  console.error(`\nonboarding-create guard: FAILED (${pass} passed)`);
} else {
  console.log(`\nonboarding-create guard: ${pass}/${pass} passed`);
}
