// Dump row anchor hrefs + action buttons on locations page.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});
  await page.goto('https://business.google.com/locations?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await sleep(6000);
  const links = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href]').forEach((a) => {
      if (/lid=|businesses|verify/i.test(a.href)) out.push({ href: a.href, txt: (a.textContent || '').trim().slice(0, 60) });
    });
    document.querySelectorAll('button[aria-label]').forEach((b) => {
      out.push({ btn: b.getAttribute('aria-label'), txt: (b.textContent || '').trim().slice(0, 30) });
    });
    return out;
  });
  console.log(JSON.stringify(links, null, 1));
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
