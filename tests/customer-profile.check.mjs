import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prunePushInbox, DEFAULT_CAP } = require('../shared/push-inbox.cjs');


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

// --- pushInbox pruning: one shared cap, both writers must use it ---
assert.equal(DEFAULT_CAP, 50, 'push inbox cap must be 50');
assert.match(server, /prunePushInbox/);
assert.match(bot, /prunePushInbox/);

// --- loyalty: canonical record path + earn rate (5 points per ₹100) ---
assert.match(bot, /earnRatePaisePerPoint \|\| 2000/, 'bot earn rate must default to 2000 paise/point (5 per ₹100)');
assert.match(bot, /customers\/\$\{phone\}\/loyalty/, 'bot must write the canonical loyalty record');
assert.doesNotMatch(bot, /`loyalty\/customers/, 'loyalty/customers is dead — nothing reads it');
assert.match(customer, /earnRatePaisePerPoint: 2000/, 'customer fallback config must match the bot');
assert.match(customer, /loyalty\/rankings\/\$\{_profile\.phone\}/, 'customer must read only its own ranking entry');
assert.doesNotMatch(customer, /outletRef\('loyalty\/rankings'\)/, 'bulk leaderboard read leaks other customers');

const fakeRef = data => ({
    once: async () => ({ val: () => data }),
    update: async updates => {
        for (const [k, v] of Object.entries(updates)) {
            if (v === null) delete data[k];
            else data[k] = v;
        }
    }
});

// over cap -> oldest removed, newest kept
const many = {};
for (let i = 0; i < 60; i++) many[`p${i}`] = { sentAt: 1000 + i };
assert.equal(await prunePushInbox(fakeRef(many)), 10);
assert.equal(Object.keys(many).length, 50);
assert.ok(!many.p9, 'oldest entries should have been pruned');
assert.ok(many.p10, 'entry 10 should be kept');
assert.ok(many.p59, 'newest entry must be kept');

// under cap -> untouched
const few = { a: { sentAt: 1 }, b: { sentAt: 2 } };
assert.equal(await prunePushInbox(fakeRef(few)), 0);
assert.deepEqual(Object.keys(few), ['a', 'b']);

// entries without sentAt count as oldest
const mixed = { x: {} };
for (let i = 0; i < 50; i++) mixed[`k${i}`] = { sentAt: 100 + i };
assert.equal(await prunePushInbox(fakeRef(mixed)), 1);
assert.ok(!mixed.x, 'entry without sentAt should be pruned first');
assert.ok(mixed.k0, 'entry with sentAt must be kept');

// a broken ref must not throw
assert.equal(await prunePushInbox({ once: async () => { throw new Error('boom'); } }), 0);

console.log('customer profile wiring ok');

