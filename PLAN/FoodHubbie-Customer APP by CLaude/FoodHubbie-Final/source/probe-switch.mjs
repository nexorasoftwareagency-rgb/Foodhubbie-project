import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
const logs = [];
p.on('console', m => logs.push(m.type() + ': ' + m.text().slice(0, 150)));
p.on('pageerror', e => logs.push('PAGEERR: ' + e.message.slice(0, 200)));
await p.goto('http://127.0.0.1:8124/Admin/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
const pre = await p.evaluate(() => ({
  li: !!document.getElementById('menu-settings'),
  liDisplay: document.getElementById('menu-settings') ? getComputedStyle(document.getElementById('menu-settings')).display : 'N/A',
  btn: !!document.querySelector('#menu-settings button[data-action="switchTab"]'),
  loader: document.getElementById('initial-loader')?.className,
}));
await p.evaluate(() => document.querySelector('#menu-settings button[data-action="switchTab"]')?.click());
await p.waitForTimeout(2500);
const post = await p.evaluate(() => ({
  settingsClass: document.getElementById('tab-settings')?.className,
  activeLi: document.querySelector('.sidebar li.active')?.id,
}));
console.log(JSON.stringify({ pre, post, logs: logs.slice(0, 25) }, null, 2));
await b.close();
