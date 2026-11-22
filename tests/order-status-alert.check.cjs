#!/usr/bin/env node
/**
 * Order status alert guard (batch 23n).
 *
 *   node tests/order-status-alert.check.cjs
 *
 * `onOrderStatusAlert` texts the outlet's own team "NEW ORDER RECEIVED!" when a
 * browser order has been finalised. Parity port of the bot's socket-only
 * `alertAdminFinalizedWebOrder` + `notifyAdmin('NEW')` (`bot/index.js`).
 *
 * Pins (the old guard described the superseded draft that listened on the
 * `status` leaf and enqueued a Cloud Task — both are gone):
 *   - Fires on the FINALIZER's `stockDeducted` leaf, never on `status`, so no
 *     payment mirror / KOT stamp / push marker can wake the sender and the body
 *     always shows the corrected money.
 *   - Only the finalizer's `true` counts (a client's `stockDeducted: false`).
 *   - Web orders only, same source list as the bot.
 *   - `_adminWaNotified` claimed by TRANSACTION before the send (at-most-once),
 *     and only after a transport was successfully built (a tenant with no
 *     number must not burn the claim).
 *   - Recipients come from `tenantAlertRecipients` (developer + the outlet's own
 *     report contact) — never a scan of the global `admins` root.
 *   - Direct send over the tenant transport, never a Cloud Task.
 *   - Demo tenant hard-skipped, config flag gated, admin initialised before any
 *     DB read, WhatsApp secrets declared.
 *   - Body keeps the bot's item lines / total / loyalty tender / CHECK PRICES.
 *
 * Static source inspection. No network, no credentials.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SRC = 'FIREBASE_SERVER_MIGRATION/functions/src/triggers/orderStatusAlert.ts';
const FACTORY = 'FIREBASE_SERVER_MIGRATION/functions/src/shared/whatsapp/factory.ts';
const INDEX = 'FIREBASE_SERVER_MIGRATION/functions/src/index.ts';

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

const src = read(SRC);
const stripped = stripComments(src);
const factory = read(FACTORY);
const indexSrc = read(INDEX);

// 1. Trigger shape
ok('Fires on the finalizer stockDeducted leaf',
  /orders\/\{orderId\}\/stockDeducted/.test(src) && !/orders\/\{orderId\}\/status/.test(src));
ok('onValueWritten (not onValueCreated)', /onValueWritten/.test(stripped));
ok('Only a true flag counts', /after\.val\(\) !== true/.test(stripped));
ok('Web order sources match the bot',
  /WEB_ORDER_SOURCES\s*=\s*\['webview_delivery',\s*'APP'\]/.test(stripped));

// 2. Gate + admin init order
ok('Demo tenant hard-skipped', /foodhubbie-demo/.test(stripped));
ok('Config flag gate: config/orderStatusAlert/enabled', /orderStatusAlert\/enabled/.test(stripped));
{
  const initAt = stripped.indexOf('await initializeAdmin()');
  const firstDbAt = stripped.indexOf('getDB()');
  ok('initializeAdmin() before the first getDB()', initAt >= 0 && firstDbAt > initAt,
    { initAt, firstDbAt });
}

// 3. At-most-once claim
ok('Dedupe: _adminWaNotified', /_adminWaNotified/.test(stripped));
ok('Claim is a transaction seeded with the current value',
  /\.transaction\(/.test(stripped) && /const seed = claimSnap \? claimSnap\.val\(\) : null/.test(stripped));
{
  const claimAt = stripped.indexOf('.transaction(');
  const sendAt = stripped.indexOf('sendMessage(');
  ok('Claim happens BEFORE the first send', claimAt >= 0 && sendAt > claimAt, { claimAt, sendAt });
}
{
  const transportAt = stripped.indexOf('makeTenantTransport(');
  const claimAt = stripped.indexOf('.transaction(');
  ok('Transport is built before the claim (no number = no burnt claim)',
    transportAt >= 0 && claimAt > transportAt, { transportAt, claimAt });
}

// 4. Recipients + send path
ok('Recipients via tenantAlertRecipients()', /tenantAlertRecipients\(bid, oid\)/.test(stripped));
ok('Outbound over the tenant transport, not a Cloud Task',
  /makeTenantTransport\(bid, oid\)/.test(stripped) &&
  /transport\.sendMessage\(/.test(stripped) &&
  !/enqueueTask/.test(stripped) &&
  !/sendOutboundMessage/.test(stripped));
ok('Never scans the global admins root',
  !/ref\(['"]admins['"]\)/.test(stripped) && !/isSuper/.test(stripped) && !/isSupreme/.test(stripped));
ok('No whole businesses tree read',
  !/db\.ref\(['"]businesses['"]\)/.test(stripped) && !/ref\('businesses'\)/.test(stripped));

// 5. Body parity with notifyAdmin(order, 'NEW')
ok('Body: item lines with size and quantity',
  /`• \$\{i\.name\}/.test(src) && /i\.size/.test(src) && /i\.quantity/.test(src));
ok('Body: total + payment method', /Total: ₹/.test(src) && /paymentMethod/.test(src));
ok('Body: loyalty tender + payable', /loyaltyTender/.test(src) && /Payable: ₹/.test(src));
ok('Body: price review warning', /priceReview/.test(src) && /CHECK PRICES/.test(src));

// 6. Runtime contract
ok('Secrets: FIREBASE_DATABASE_URL + WA_PERMANENT_TOKEN',
  /secrets:\s*\['FIREBASE_DATABASE_URL',\s*'WA_PERMANENT_TOKEN'\]/.test(stripped));
ok('Functions region us-central1', /region:\s*'us-central1'/.test(stripped));

// 7. The factory seam this relies on
ok('Factory: tenantCredentials reads the outlet whatsapp node',
  /outlets\/\$\{oid\}\/whatsapp/.test(factory) && /whatsapp number not connected/.test(factory));
ok('Factory: makeTenantTransport exported', /export async function makeTenantTransport/.test(factory));
ok('Factory: tenantAlertRecipients exported', /export async function tenantAlertRecipients/.test(factory));

// 8. Deployed surface
ok('Exported from functions/src/index.ts',
  /onOrderStatusAlert/.test(indexSrc) && /from '.\/triggers\/orderStatusAlert'/.test(indexSrc));

console.log(`\norder-status-alert guard ${pass}/25 passed${process.exitCode === 1 ? ' — FAILED' : ''}`);
process.exit(process.exitCode || 0);
