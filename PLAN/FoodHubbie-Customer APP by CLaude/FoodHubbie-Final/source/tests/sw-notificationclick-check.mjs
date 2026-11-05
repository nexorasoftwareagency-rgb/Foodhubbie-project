// Unit-verify the ACTUAL shipped Admin/dist/sw.js notification routing
// (task 20260930-153108-5be7). Real OS toast clicks can't be automated
// (Web Notification API has no .click()), so this loads the built sw.js
// with mocked SW globals and drives its two handlers directly:
//   1. onBackgroundMessage (FCM): tag = order-<orderId>, data.url deep-link
//   2. notificationclick: focuses an EXISTING tab (old bug: relative-vs-
//      absolute URL compare never matched -> duplicate tab every click),
//      navigates it when the notification carries ?order=, opens a window
//      only when no tab is open, never double-opens.
let pass = 0, fail = 0;
const log = (...a) => console.log('[SWUnit]', ...a);
const assert = (c, m) => { if (c) { pass++; log('PASS', m); } else { fail++; log('FAIL', m); } };

const SCOPE = 'https://foodhubbie-admins.web.app/';
const handlers = {};
let bgHandler = null;
let shown = [];
let focusCalls = 0;
let navigated = [];
let opened = [];

global.self = {
  location: { protocol: 'https:', hostname: 'foodhubbie-admins.web.app' },
  registration: { scope: SCOPE, showNotification: async (title, opts) => { shown.push({ title, opts }); } },
  addEventListener: (type, fn) => { handlers[type] = fn; },
  skipWaiting: () => {}, clients: null
};
global.importScripts = () => {};
global.firebase = {
  initializeApp: () => {},
  messaging: () => ({ onBackgroundMessage: (fn) => { bgHandler = fn; } })
};
global.clients = {
  matchAll: async () => global.__clientList,
  openWindow: async (url) => { opened.push(url); return {}; }
};
global.caches = { keys: async () => [], open: async () => ({ add: async () => {} }) };

import fs from 'fs';
import vm from 'vm';
// sw.js is a classic (non-module) script — run it against the mocked globals.
vm.runInThisContext(fs.readFileSync('./Admin/dist/sw.js', 'utf8'), { filename: 'sw.js' });

assert(typeof handlers.notificationclick === 'function', 'sw.js registered notificationclick');
assert(typeof bgHandler === 'function', 'sw.js registered onBackgroundMessage');

// --- 1. FCM background message styling ---
bgHandler({ data: { orderId: 'abc123', title: 'New Order #4567', body: 'Rs 250' } });
await new Promise(r => setTimeout(r, 10));
assert(shown.length === 1, 'FCM background -> showNotification fired once');
assert(shown[0].opts.tag === 'order-abc123', `FCM tag = ${shown[0].opts.tag} (shared namespace with in-page popups)`);
assert(shown[0].opts.data.url === './index.html?order=abc123', `FCM data.url = ${shown[0].opts.data.url}`);
assert(shown[0].opts.requireInteraction === true, 'FCM popup persistent');
assert(shown[0].opts.icon === './icon-erp-logo.jpeg', 'FCM popup branded icon');

// --- 2. notificationclick: existing tab + deep-link -> focus + navigate ---
const mkClient = (url) => ({ url, focus: () => { focusCalls++; }, navigate: async (u) => { navigated.push(u); return {}; } });
let done;
const fire = () => { const e = { notification: { close: () => {}, data: { url: './index.html?order=abc123' } }, waitUntil: (p) => { done = p; } }; handlers.notificationclick(e); return done; };

global.__clientList = [mkClient(SCOPE)];
await fire();
assert(focusCalls === 1, 'existing tab FOCUSED (old code never matched -> opened duplicate)');
assert(navigated.length === 1 && navigated[0] === SCOPE + 'index.html?order=abc123',
  `navigated existing tab to ${navigated[0]}`);
assert(opened.length === 0, 'NO duplicate tab opened');

// --- 3. existing tab + generic notification (no ?order) -> focus only, no reload ---
focusCalls = 0; navigated = []; opened = [];
handlers.notificationclick({ notification: { close: () => {}, data: { url: './index.html' } }, waitUntil: (p) => { done = p; } });
await done;
assert(focusCalls === 1 && navigated.length === 0 && opened.length === 0,
  'generic popup click = focus only (no needless navigate, no new tab)');

// --- 4. no tab open -> openWindow with ABSOLUTE resolved url ---
global.__clientList = []; focusCalls = 0; navigated = []; opened = [];
handlers.notificationclick({ notification: { close: () => {}, data: { url: './index.html?order=abc123' } }, waitUntil: (p) => { done = p; } });
await done;
assert(opened.length === 1 && opened[0] === SCOPE + 'index.html?order=abc123',
  `cold start opens ${opened[0]} (absolute, deep-linked)`);

// --- 5. legacy notification with NO data at all -> falls back to scope index ---
opened = [];
handlers.notificationclick({ notification: { close: () => {}, data: null }, waitUntil: (p) => { done = p; } });
await done;
assert(opened.length === 1 && opened[0] === SCOPE + 'index.html', 'no-data notification falls back to dashboard');

log(`RESULT ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
