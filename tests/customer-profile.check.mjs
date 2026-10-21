import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');
const rules = JSON.parse(read('database.rules.json'));
const outlet = rules.rules.businesses.$businessId.outlets.$outletId;

assert.ok(rules.rules.config.tunnelUrl['.read'], 'config/tunnelUrl read rule missing');
assert.ok(outlet.customers.$phone.app, 'customers/{phone}/app rule missing');
assert.match(outlet.customers.$phone.app['.validate'], /consent/);
assert.ok(outlet.pushInbox.$phone, 'pushInbox rule missing');
assert.deepEqual(outlet.pushInbox.$phone['.indexOn'], ['sentAt']);
assert.match(outlet.pushSubscriptions.$tokenKey['.write'], /appMode/);

const customer = read('menu/js/customer.js');
assert.match(customer, /customers\/\$\{profile\.phone\}\/app/);
assert.match(customer, /pushInbox\/\$\{_profile\.phone\}/);
assert.match(customer, /export function initCustomer/);
assert.match(customer, /export function maybeStartOnboarding/);
assert.match(customer, /export async function renderCustomerPromotions/);

for (const page of ['menu/index.html', 'menu/delivery.html']) {
  const html = read(page);
  for (const id of ['promoPaneOffers', 'promoPaneNotifications', 'promoPaneAccount', 'notificationInboxList', 'accountProfileCard']) {
    assert.ok(html.includes(`id="${id}"`), `${page} missing #${id}`);
  }
}

const sw = read('menu/firebase-messaging-sw.js');
assert.match(sw, /data\.url/);
assert.match(sw, /data\.type === 'order'/);

const server = read('bot-control-api/server.js');
assert.match(server, /MENU_WEB_ORIGIN/);
assert.match(server, /pushInbox/);
assert.match(server, /prefs\.offers/);
assert.match(server, /foodhubbie-admins\.web\.app/);

const bot = read('bot/index.js');
assert.match(bot, /notifyCustomerApp/);
assert.match(bot, /'out for delivery'/);
assert.match(bot, /pushInbox\/\$\{phone\}/);
assert.match(bot, /prefs\.orderUpdates !== false/);

console.log('customer profile wiring ok');
