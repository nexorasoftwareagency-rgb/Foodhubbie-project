/* Guard: the mobile POS item picker (owner request 2026-11-19 — "utilise the
 * complete space, it looks congested").
 *
 * The measured problem (390x844, real demo tenant):
 *   - five nested wrappers threw away 90px of a 384px content width, so the
 *     grid fell to two 140px columns;
 *   - the category pills WRAPPED into 3 rows = 148px (24% of the viewport)
 *     before a single dish;
 *   - 4 full-width combo tiles (~480px) came first, so no dish was reachable
 *     without scrolling;
 *   - the tile said "Rs.69" while the sheet preselected "Rs.119" — the
 *     cashier could charge a different amount than the price on the tile;
 *   - the demo banner covered the mobile cart pill (it intercepted the tap)
 *     and the sheet's price / "Add to Cart" footer;
 *   - every dish opened a full sheet, even option-free dishes.
 *
 * Static only — no Firebase, no network. `npm run test:pos-mobile`.
 * Mutation self-test: point POS_FILE / CSS_FILE / DEMO_FILE at a reverted
 * copy and the checks must fail.
 */
const fs = require('fs');
const path = require('path');

const R = (root) => path.join(__dirname, '..', root);
const read = (p) => fs.readFileSync(p, 'utf8');

const posSrc = read(process.env.POS_FILE || R('Admin/js/features/pos.js'));
const cssSrc = read(process.env.CSS_FILE || R('Admin/mobile-overrides.css'));
const demoSrc = read(process.env.DEMO_FILE || R('Admin/js/demo-mode.js'));
const swSrc = read(process.env.SW_FILE || R('Admin/sw.js'));
const htmlSrc = read(process.env.HTML_FILE || R('Admin/index.html'));

let pass = 0, fail = 0;
const ok = (cond, label) => {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label); }
};

// The mobile POS block must live INSIDE the <=1024px media query, otherwise
// the desktop picker changes too.
const firstMedia = cssSrc.indexOf('@media (max-width: 1024px)');
const posSection = cssSrc.indexOf('POS / WALK-IN: the picker owns the whole screen');
const nextTopMedia = cssSrc.indexOf('\n@media ', firstMedia + 1);
ok(firstMedia > -1 && posSection > firstMedia && (nextTopMedia === -1 || posSection < nextTopMedia),
    'the POS mobile block sits inside the <=1024px media query (desktop untouched)');

// ---- the padding chain is gone -------------------------------------------
ok(/#tab-walkin\s*\{\s*padding:\s*0\s*!important;/.test(cssSrc), '#tab-walkin has no horizontal padding');
ok(/\.walkin-layout\s*\{[\s\S]{0,700}?padding:\s*0\s*!important;/.test(cssSrc), '.walkin-layout has no padding');
ok(/#tab-walkin \.walkin-picker\s*\{[\s\S]{0,320}?padding:\s*0\s*!important;/.test(cssSrc), '.walkin-picker has no padding');
ok(/#tab-walkin \.walkin-picker > \.panel\s*\{[\s\S]{0,320}?padding:\s*0\s*!important;/.test(cssSrc),
    'the picker panel wrapper has no padding');
ok(!/padding:\s*5px\s*!important;/.test(cssSrc.slice(posSection, posSection + 1500)),
    'the old 5px layout padding is gone');

// ---- the grid is dense and the gutters are small --------------------------
const gridRule = (cssSrc.match(/#tab-walkin \.walkin-dish-grid\s*\{[\s\S]*?\}/) || [''])[0];
ok(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(100px,\s*1fr\)\)/.test(gridRule),
    'dish grid fits 3 columns at 360px+ (minmax(100px, 1fr))');
ok(/gap:\s*8px/.test(gridRule), 'dish grid gap is 8px');
ok(/padding:\s*8px/.test(gridRule), 'dish grid keeps a single 8px gutter');
ok(/max-height:\s*none/.test(gridRule) && /overflow:\s*visible/.test(gridRule),
    'the grid is not clipped by a nested scroll box');

// ---- the category strip is ONE scrolling row ------------------------------
const tabsRule = (cssSrc.match(/\.category-tabs-container\s*\{[\s\S]*?\}/) || [''])[0];
ok(/flex-wrap:\s*nowrap/.test(tabsRule), 'category pills do not wrap (they were 3 rows)');
ok(/overflow-x:\s*auto/.test(tabsRule), 'category pills scroll horizontally');
ok(!/flex-wrap:\s*wrap/.test(tabsRule), 'no wrap rule left on the category strip');

// ---- the tiles use the selectors the DOM actually renders -----------------
ok(/#tab-walkin \.pos-dish-btn-v4 \.dish-name\s*\{[\s\S]{0,400}?-webkit-line-clamp:\s*2/.test(cssSrc),
    'the dish NAME is clamped (real class .dish-name)');
ok(!/\.pos-dish-name/.test(cssSrc), 'the dead .pos-dish-name selector is gone');
ok(!/\.pos-dish-price/.test(cssSrc), 'the dead .pos-dish-price selector is gone');
ok(/#tab-walkin \.pos-dish-btn-v4 \.price-chip/.test(cssSrc), 'the price chip is styled (real class .price-chip)');
ok(/#tab-walkin \.pos-dish-btn-v4 \.dish-visual\s*\{[\s\S]{0,200}?aspect-ratio:\s*16\s*\/\s*9/.test(cssSrc),
    'the tile image is a 16:9 banner, not a 60px square');
ok(/#tab-walkin \.pos-combo-tile/.test(cssSrc), 'combo tiles are compacted on mobile');

// ---- iOS zoom guard ------------------------------------------------------
const searchRule = (cssSrc.match(/#walkinDishSearch\s*\{[\s\S]*?\}/) || [''])[0];
ok(/font-size:\s*16px/.test(searchRule), 'the POS search input is 16px (iOS would zoom below 16px)');

// ---- money honesty: tile price == the size the sheet opens on ------------
ok(/export function posPriceInfo/.test(posSrc), 'posPriceInfo() exists');
ok(/Math\.min\(\.\.\.prices\)/.test(posSrc), 'the advertised price is the CHEAPEST size');
ok(/₹\$\{price\}\$\{from \? '\+' : ''\}/.test(posSrc), 'a sized dish advertises "Rs.X+"');
ok(!/const isDefault = idx === 0;/.test(posSrc), 'the sheet no longer opens on "the first size in the object"');
ok(/defaultIdx = Math\.max\(0, sizeEntries\.findIndex/.test(posSrc),
    'the sheet opens on the advertised size');
ok(/const advertised = posPriceInfo\(dish\)\.price;/.test(posSrc),
    'the sheet default is derived from the advertised tile price');

// ---- one-tap add for option-free dishes ---------------------------------
ok(/export function posDishIsQuickAddable/.test(posSrc), 'posDishIsQuickAddable() exists');
ok(/if \(posDishIsQuickAddable\(dish, state\.categories\)\)\s*\{\s*addSimpleDishToCart\(dish\);/.test(posSrc),
    'an option-free dish is added with one tap (no sheet)');
ok(/const cartKey = `\$\{dish\.id\}::- Default -::`;/.test(posSrc),
    'the quick-add cart key matches the modal key (one line, not two)');
ok(/data-quick-add="1"/.test(posSrc), 'quick-add tiles are marked in the DOM');

// ---- dishes first, combos last ------------------------------------------
ok(/\.join\(''\) \+ comboTiles;/.test(posSrc), 'dishes are rendered before the combo rows');

// ---- the demo banner may not eat the cart pill or the sheet footer -------
ok(/body\.pos-selection-mode #demoModeBanner\{display:none !important\}/.test(demoSrc),
    'the demo banner hides while the item sheet is open');
ok(/#demoModeBanner \.dmb-text span\{display:none\}/.test(demoSrc),
    'the demo banner is one compact line on mobile');
ok(/html\.demo-mode \.mobile-cart-summary\s*\{[\s\S]{0,200}?bottom:\s*calc\(/.test(cssSrc),
    'the mobile cart pill is lifted above the demo banner');
ok(/body\.pos-selection-mode #alertContainer\s*\{[\s\S]{0,200}?bottom:\s*calc\(/.test(cssSrc),
    'toasts are lifted above the item sheet footer');

// ---- served-file hygiene: the CSS version must match index.html ----------
const cssHref = (htmlSrc.match(/mobile-overrides\.css\?v=([0-9.]+)/) || [])[1];
const swHref = (swSrc.match(/mobile-overrides\.css\?v=([0-9.]+)/) || [])[1];
ok(!!cssHref && cssHref === swHref,
    `index.html and sw.js agree on the mobile CSS version (${cssHref} vs ${swHref})`);
ok(/const CACHE_NAME = 'foodhubbie-erp-shell-v5\.12\.\d+'/.test(swSrc),
    'the Admin shell cache version is a v5.12.x bump');

console.log(`\nPOS mobile guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
