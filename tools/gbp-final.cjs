// Final drive: keeper's verification. Fill address if asked (verified), park at method choice.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = await chromium.launchPersistentContext('C:/Users/2nile/AppData/Local/Temp/opencode/pw-gbp-profile', {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});

  const body = () => page.evaluate(() => document.body.innerText);
  const preNext = async (tag) => {
    const vals = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('input').forEach((e) => {
        if (e.offsetParent) out.push(((e.getAttribute('aria-label') || e.placeholder || '@' + e.type) + ' = "' + (e.value || '') + '"' + (e.disabled ? ' [locked]' : '')).trim());
      });
      return out;
    });
    console.log('PRE-NEXT[' + tag + ']: ' + JSON.stringify(vals, null, 1));
    return vals.join(' | ');
  };

  await page.goto('https://business.google.com/verify/l/14737259577222471979?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('goto fail'));
  await sleep(7000);
  let b = await body();
  console.log('ENTRY: ' + b.slice(0, 600).replace(/\s+/g, ' '));

  if (b.includes('mailing address to verify')) {
    const vals = ['Vill - Anjani, P.O - Anjani, P.S - Parsa', 'Parsa', '841219'];
    const fields = [];
    const cand = page.locator('input[type="text"]:not([disabled]), input[type="tel"]:not([disabled])');
    const cn = await cand.count();
    for (let i = 0; i < cn && fields.length < 3; i++) {
      const el = cand.nth(i);
      const al = (await el.getAttribute('aria-label')) || (await el.getAttribute('placeholder')) || '';
      if (/search|country|region|contact/i.test(al)) continue;
      try {
        if (await el.isVisible() && !(await el.inputValue())) fields.push(el);
      } catch {}
    }
    console.log('address fields found:', fields.length);
    for (let i = 0; i < fields.length && i < vals.length; i++) {
      await fields[i].fill(vals[i], { force: true, timeout: 8000 });
      await sleep(500);
    }
    await page.keyboard.press('Escape');
    await sleep(700);
    let okState = false;
    for (let a = 0; a < 3 && !okState; a++) {
      try {
        await page.getByText('State', { exact: true }).locator('visible=true').last().click({ force: true, timeout: 6000 });
        await sleep(2500);
        okState = await page.evaluate(() => {
          const o = [...document.querySelectorAll('[role="option"], li')].find(
            (e) => e.offsetParent && e.textContent.trim() === 'Bihar'
          );
          if (o) { o.click(); return true; }
          const opts = [...document.querySelectorAll('[role="option"], li')].filter((e) => e.offsetParent).map((e) => e.textContent.trim()).slice(0, 12);
          console.log('opts: ' + JSON.stringify(opts));
          return false;
        });
        if (!okState) { await page.keyboard.press('Escape'); await sleep(800); }
      } catch (e) { console.log('state retry ' + (a + 1) + ': ' + e.message.split('\n')[0]); }
    }
    console.log('bihar picked:', okState);
    await sleep(1000);
    const j = await preNext('address');
    const ok = /Vill - Anjani/.test(j) && /Parsa/.test(j) && /841219/.test(j) && okState;
    if (!ok) { console.log('ADDRESS MISMATCH - stopping'); await page.screenshot({ path: 'website/gbp-state.png' }); await ctx.close(); process.exit(3); }
    await page.getByRole('button', { name: 'Next', exact: true }).locator('visible=true').last().click({ timeout: 8000 }).catch(() => {});
    await sleep(5000);
  }

  // verify: phone/website backfill if an edit form appears; else method choice / park
  let cur = await body();
  console.log('AFTER-ADDRESS: ' + cur.slice(0, 800).replace(/\s+/g, ' '));
  if (/select a way|submit a business video/i.test(cur)) {
    console.log('>>> selecting video method and parking for user');
    try {
      await page.getByText('Submit a Business Video', { exact: true }).locator('visible=true').last().click({ timeout: 6000, force: true });
      await sleep(1500);
      await page.getByRole('button', { name: 'Next', exact: true }).locator('visible=true').last().click({ timeout: 6000 }).catch(() => {});
      await sleep(5000);
    } catch (e) { console.log('video-select fail: ' + e.message.split('\n')[0]); }
    console.log('>>> PARKED - USER TAKEOVER (browser stays open ~15 min)');
    for (let i = 0; i < 45; i++) {
      await sleep(20000);
      let t = '';
      try { t = await body(); } catch { continue; }
      console.log('[' + i + '] ' + t.replace(/\s+/g, ' ').slice(0, 180));
      if (/video is being processed|going to review|video submitted|few days/i.test(t)) { console.log('SUBMITTED SIGNAL'); break; }
      if (/mailing address/i.test(t)) { console.log('bounced to address step'); break; }
    }
  }
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
