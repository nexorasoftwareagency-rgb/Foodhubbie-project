// Shared test harness for Supreme Admin UI checks.
// Serves the REAL SupremeAdmin + shared files, replaces Firebase with an in-memory
// stub, and seeds realistic data. Needs only Playwright's Chromium (no network).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SA = path.join(ROOT, 'SupremeAdmin');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

export function seed(now = Date.now()) {
  const H = 3600e3, D = 24 * H;
  const hist = (pattern) => pattern.map((s, i) => ({ status: s, at: now - (pattern.length - i) * H }));
  const ok = Array(24).fill('online');
  const mkOrders = (n, src = ['QR', 'POS', 'webview_delivery', 'WA']) => {
    const o = {};
    for (let i = 0; i < n; i++) o['o' + i] = { total: 200 + (i * 37) % 600, source: src[i % src.length], status: 'Delivered', createdAt: new Date(now - (i % 20) * 6 * H).toISOString() };
    return o;
  };
  const outlet = (name, p) => ({
    name, contactPhone: p.phone || '98' + Math.floor(10000000 + Math.random() * 89999999),
    disabled: !!p.disabled, disabledAt: p.disabled ? now - 9 * D : null,
    whatsapp: p.wa ? { status: 'active', phoneNumberId: '1099' + name.length } : undefined,
    bot: p.provisioned === false ? undefined : { provisionedAt: now - 30 * D, transport: p.transport || 'baileys', healthPort: 4100 + name.length },
    botStatus: p.bot ? { status: p.bot, uptime: p.bot === 'online' ? 86400 * 3 : 0, memory: 120 + name.length * 3, updatedAt: p.stale ? now - 40 * 60e3 : now - 90e3, history: hist(p.hist || ok) } : undefined,
    orders: p.orders ? mkOrders(p.orders) : undefined,
    settings: { Store: { storeName: name } },
  });
  const biz = (name, plan, outlets) => ({ name, plan, contactPhone: '9876500000', outlets });
  const businesses = {
    b1: biz('Spice Route Group', 'growth', { o1: outlet('Spice Route · Indiranagar', { wa: true, bot: 'online', orders: 60 }), o2: outlet('Spice Route · Koramangala', { wa: true, bot: 'errored', hist: [...ok.slice(0, 18), 'online', 'errored', 'errored', 'offline', 'errored', 'errored'], orders: 35 }) }),
    b2: biz('Dosa Corner', 'starter', { o3: outlet('Dosa Corner · Jayanagar', { bot: 'online', orders: 22 }) }),
    b3: biz('Biryani Bazaar', 'enterprise', { o4: outlet('Biryani Bazaar · HSR', { wa: true, bot: 'online', orders: 90 }), o5: outlet('Biryani Bazaar · Whitefield', { wa: true, bot: 'degraded', hist: [...ok.slice(0, 16), ...Array(8).fill('degraded')], orders: 48 }), o6: outlet('Biryani Bazaar · Marathahalli', { wa: true, bot: 'online', orders: 41 }) }),
    b4: biz('Cafe Mocha', 'starter', { o7: outlet('Cafe Mocha · MG Road', { bot: 'offline', hist: [...ok.slice(0, 10), ...Array(14).fill('offline')], stale: true, orders: 8 }) }),
    b5: biz('Pizza Palace', 'growth', { o8: outlet('Pizza Palace · BTM', { wa: true, bot: 'online', orders: 55 }), o9: outlet('Pizza Palace · JP Nagar', { provisioned: false }) }),
    b6: biz('Tiffin Express', 'starter', { o10: outlet('Tiffin Express · Malleshwaram', { bot: 'online', orders: 12, transport: 'cloud_api' }) }),
    b7: biz('Grill House', 'growth', { o11: outlet('Grill House · Yelahanka', { disabled: true, bot: 'offline' }), o12: outlet('Grill House · Hebbal', { wa: true, bot: 'online', orders: 30 }) }),
    b8: biz('Chai & Chaat', 'starter', { o13: outlet('Chai & Chaat · Basavanagudi', { bot: 'unknown', provisioned: true }), o14: outlet('Chai & Chaat · Rajajinagar', { bot: 'online', orders: 5 }) }),
  };
  const pay = (amt, d) => ({ amount: amt, createdAt: now - d * D, method: 'UPI' });
  const walletBilling = {
    b1: { o1: { payments: { p1: pay(2500, 12) }, wallet: { balance: 900 } }, o2: { payments: { p1: pay(1500, 20) }, wallet: { balance: 120 } } },
    b3: { o4: { payments: { p1: pay(5000, 8) }, wallet: { balance: 2400 } }, o5: { payments: {}, wallet: { balance: 0 } }, o6: { payments: { p1: pay(1000, 3) } } },
    b5: { o8: { payments: { p1: pay(1500, 14) } } },
    b2: { o3: { payments: { p1: pay(1000, 25) } } },
  };
  const req = (n, status, d) => ({ businessName: n, outletName: n + ' · Main', contactPhone: '9900112233', contactEmail: 'hello@' + n.toLowerCase().replace(/\W/g, '') + '.in', adminEmail: 'admin@' + n.toLowerCase().replace(/\W/g, '') + '.in', plan: ['starter', 'growth'][d % 2], status, createdAt: now - d * D });
  const onboardingRequests = { r1: req('Masala Magic', 'pending', 0.2), r2: req('Wrap Station', 'pending', 1), r3: req('Idli House', 'approved', 4), r4: req('Noodle Bar', 'rejected', 6), r5: req('Sweet Tooth', 'expired', 18), r6: req('Thali Time', 'pending', 2) };
  return { businesses, walletBilling, onboardingRequests, admins: { u1: { isSuper: true } }, config: { tunnelUrl: 'https://tunnel.invalid' } };
}

const FIREBASE_STUB = `
(function(){
  const tree = window.__SEED__ || {};
  const subs = [];
  const get = (p) => { let n = tree; for (const k of p.split('/').filter(Boolean)) { if (n == null) return null; n = n[k]; } return n === undefined ? null : JSON.parse(JSON.stringify(n)); };
  const set = (p, v) => { const ks = p.split('/').filter(Boolean); let n = tree; ks.slice(0,-1).forEach(k => { n[k] = n[k] || {}; n = n[k]; }); if (v === null) delete n[ks[ks.length-1]]; else n[ks[ks.length-1]] = v; };
  const notify = (changed) => subs.forEach(s => { if (s.path.startsWith(changed) || changed.startsWith(s.path)) s.fn({ val: () => get(s.path) }); });
  let uid = 0;
  const ref = (p = '') => ({
    key: p.split('/').pop(),
    child: (c) => ref(p + '/' + c),
    once: (_e, cb) => { const sn = { val: () => get(p) }; if (cb) setTimeout(() => cb(sn), 0); return Promise.resolve(sn); },
    on: (_e, fn) => { subs.push({ path: p, fn }); setTimeout(() => fn({ val: () => get(p) }), 0); return fn; },
    off: () => {},
    set: (v) => { set(p, v); notify(p); return Promise.resolve(); },
    update: (v) => { Object.entries(v).forEach(([k, x]) => set(p ? p + '/' + k : k, x)); (window.__WRITES__ = window.__WRITES__ || []).push({ p, v }); notify(''); return Promise.resolve(); },
    remove: () => { set(p, null); notify(p); return Promise.resolve(); },
    push: () => { const r = ref(p + '/k' + (++uid)); r.then = undefined; return Object.assign(r, { set: (v) => { set(p + '/k' + uid, v); notify(p); return Promise.resolve(); } }); },
    transaction: () => Promise.resolve(),
  });
  const user = { uid: 'u1', email: 'supreme@foodhubbie.test', getIdToken: () => Promise.resolve('tok'), getIdTokenResult: () => Promise.resolve({ claims: { isSuper: window.__ROLE__ !== 'support', isSupport: window.__ROLE__ === 'support' } }) };
  const auth = { currentUser: user, onAuthStateChanged: (cb) => { setTimeout(() => cb(user), 0); return () => {}; }, signOut: () => Promise.resolve() };
  const db = () => ({ ref });
  window.firebase = { initializeApp(){}, auth: Object.assign(() => auth, { GoogleAuthProvider: function(){} }), database: Object.assign(db, { ServerValue: { TIMESTAMP: Date.now() } }) };
  window.TUNNEL_URL = 'https://tunnel.invalid'; window.TUNNEL_READY = Promise.resolve('https://tunnel.invalid');
})();`;

const LUCIDE_STUB = `window.lucide={createIcons:function(o){var r=(o&&o.root)||document;r.querySelectorAll('svg[data-lucide]').forEach(function(s){if(s.dataset.done)return;s.dataset.done=1;s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2');s.innerHTML='<rect x="4" y="4" width="16" height="16" rx="4"/>';});}};`;

export async function openSupreme(browser, { width = 1366, height = 860, role = 'super', data = seed(), hash = '#restaurants' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(({ data, role }) => { window.__SEED__ = data; window.__ROLE__ = role; }, { data, role });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'app.test') {
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      if (p === '/js/firebase-config.js') return route.fulfill({ contentType: 'application/javascript', body: FIREBASE_STUB });
      const file = p.startsWith('/shared/') ? path.join(ROOT, p) : path.join(SA, p);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: MIME[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
      return route.fulfill({ status: 404, body: 'nf' });
    }
    if (/lucide/.test(url.href)) return route.fulfill({ contentType: 'application/javascript', body: LUCIDE_STUB });
    if (/gstatic.com\/firebasejs/.test(url.href)) return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (url.hostname === 'tunnel.invalid') return route.fulfill({ contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto('http://app.test/' + hash);
  await page.waitForSelector('#app-shell', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(600);
  return { page, ctx, errors };
}
