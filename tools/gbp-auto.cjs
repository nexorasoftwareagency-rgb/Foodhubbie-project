// GBP auto-driver: loop steps until address form or unknown page.
const { chromium } = require('playwright');
const PROFILE = 'C:\\Users\\2nile\\AppData\\Local\\Temp\\opencode\\pw-gbp-profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {});

  const body = () => page.evaluate(() => document.body.innerText);
  const next = async () => {
    const btn = page.getByRole('button', { name: 'Next', exact: true }).locator('visible=true').last();
    try { await btn.click({ timeout: 8000 }); return 'btn'; } catch { return 'fail'; }
  };
  const choose = async (text) => {
    const t = page.getByText(text, { exact: true }).locator('visible=true').last();
    try { await t.click({ timeout: 6000, force: true }); return true; } catch { return false; }
  };
  const radioNo = async () => {
    if (await choose('No')) return 'text';
    const ok = await page.evaluate(() => {
      const r = document.querySelector('input[type="radio"][value="no"]');
      if (!r) return false;
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    return ok ? 'js' : 'fail';
  };
  const dumpInv = async () => {
    const inv = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('input, select, [role="combobox"]').forEach((e) => {
        if (e.offsetParent) out.push({ tag: e.tagName, type: e.type || '', ph: e.placeholder || e.getAttribute('aria-label') || '', val: (e.value || '').slice(0, 50), en: !e.disabled });
      });
      return out;
    });
    return JSON.stringify(inv);
  };
  const preNext = async (tag) => {
    const vals = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('input').forEach((e) => {
        if (e.offsetParent) {
          out.push(((e.getAttribute('aria-label') || e.placeholder || '@' + e.type) + ' = "' + (e.value || '') + '"' + (e.disabled ? ' [locked]' : '')).trim());
        }
      });
      return out;
    });
    console.log('PRE-NEXT[' + tag + ']: ' + JSON.stringify(vals, null, 1));
    return vals;
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto('https://business.google.com/create/new?hl=en', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('goto fail: ' + e.message.split('\n')[0]));
    await sleep(6000);
    if (page.url().includes('business.google.com')) break;
  }
  if (!page.url().includes('business.google.com')) {
    console.log('cannot reach flow, URL: ' + page.url());
    await ctx.close();
    process.exit(2);
  }

  for (let step = 1; step <= 12; step++) {
    let b = null;
    for (let r = 0; r < 3 && !b; r++) {
      try { b = await body(); } catch (e) { console.log('ctx destroyed, waiting'); await sleep(4000); }
    }
    if (!b) b = await body();
    console.log('--- STEP ' + step + ' ---');
    console.log('URL: ' + page.url());
    console.log(b.slice(0, 400));

    if (b.includes('location customers can visit')) {
      console.log('radio no:', await radioNo());
      await sleep(1500);
      console.log('next:', await next());
    } else if (b.includes('Get updates about your business')) {
      console.log('choose No:', await choose('No'));
      await sleep(1000);
      console.log('next:', await next());
    } else if (b.includes('mailing address to verify')) {
      const vals = ['Vill - Anjani, P.O - Anjani, P.S - Parsa', 'Parsa', '841219'];
      const cand = page.locator('input[type="text"]:not([disabled])');
      const cn = await cand.count();
      const fields = [];
      for (let i = 0; i < cn && fields.length < 3; i++) {
        const el = cand.nth(i);
        const al = (await el.getAttribute('aria-label')) || (await el.getAttribute('placeholder')) || '';
        if (/search|country|region/i.test(al)) continue;
        try {
          if (await el.isVisible() && !(await el.inputValue())) fields.push(el);
        } catch {}
      }
      console.log('address fields found:', fields.length);
      for (let i = 0; i < fields.length && i < vals.length; i++) {
        await fields[i].fill(vals[i], { force: true, timeout: 8000 });
        await sleep(500);
      }
      await sleep(1200);
      await page.keyboard.press('Escape');
      await sleep(700);
      // State dropdown: real click on the State control, then pick Bihar (retries)
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
            return false;
          });
          if (!okState) {
            const opts = await page.evaluate(() =>
              [...document.querySelectorAll('[role="option"], li')].filter((e) => e.offsetParent).map((e) => e.textContent.trim()).slice(0, 12)
            );
            console.log('attempt ' + (a + 1) + ' options:', JSON.stringify(opts));
            await page.keyboard.press('Escape');
            await sleep(800);
          }
        } catch (e) { console.log('state click fail: ' + e.message.split('\n')[0]); await sleep(1000); }
      }
      console.log('bihar picked:', okState, /bihar/i.test(await body()));
      await sleep(1000);
      const checks = await preNext('address');
      const joined = checks.join(' | ');
      const okStreet = /Vill - Anjani/.test(joined);
      const okCity = /Parsa/.test(joined);
      const okPin = /841219/.test(joined);
      const okBihar = /bihar/i.test(await body());
      console.log('VERIFY address: street=' + okStreet + ' city=' + okCity + ' pin=' + okPin + ' state=' + okBihar);
      if (okStreet && okCity && okPin && okBihar) {
        console.log('next:', await next());
      } else {
        console.log('ADDRESS MISMATCH - stopping for review');
        await page.screenshot({ path: 'website/gbp-state.png' });
        await ctx.close();
        process.exit(3);
      }
      await sleep(6000);
    } else if (b.includes('Where do you serve your customers')) {
      console.log('skip optional service areas; next:', await next());
    } else if (b.includes('What region is your business based in')) {
      if (/united states/i.test(b)) {
        console.log('fixing region US -> India');
        await page.getByText('United States', { exact: true }).locator('visible=true').last().click({ force: true });
        await sleep(2000);
        await page.evaluate(() => {
          const o = [...document.querySelectorAll('[role="option"], li')].find(
            (e) => e.offsetParent && e.textContent.trim() === 'India'
          );
          o?.click();
        });
        await sleep(1500);
        console.log('now shows India:', /india/i.test(await body()));
      }
      console.log('region page; next:', await next());
    } else if (b.includes('What contact details do you want to show')) {
      // Main phone = tel#0; website = the only visible text input; chat contact stays empty
      const main = page.locator('input[type="tel"]').nth(0);
      if (!(await main.inputValue())) await main.fill('97246 49971', { force: true, timeout: 8000 });
      const web = page.locator('input[type="text"]:not([disabled])');
      const wn = await web.count();
      for (let i = 0; i < wn; i++) {
        if (await web.nth(i).isVisible() && !(await web.nth(i).inputValue())) {
          await web.nth(i).fill('https://foodhubbie-web.web.app/', { force: true });
          console.log('website filled at text#' + i);
          break;
        }
      }
      await sleep(1000);
      const checks = await preNext('contact');
      const joined = checks.join(' | ');
      const okPhone = />97246 49971"/.test(joined) || /97246\s?49971/.test(joined);
      const okWeb = /foodhubbie-web\.web\.app/.test(joined);
      console.log('VERIFY contact: phone=' + okPhone + ' website=' + okWeb);
      if (okPhone && okWeb) {
        let submitted = false;
        for (let t = 0; t < 3 && !submitted; t++) {
          await next();
          await sleep(4000);
          const after = await body();
          if (/some issues/i.test(after)) {
            console.log('server issue, waiting 90s (try ' + (t + 1) + '/3)');
            await sleep(90000);
          } else {
            submitted = true;
          }
        }
        if (!submitted) {
          console.log('SERVER-BLOCKED at contact step - exiting cleanly');
          await page.screenshot({ path: 'website/gbp-state.png' });
          await ctx.close();
          process.exit(4);
        }
      } else {
        console.log('CONTACT MISMATCH - stopping for review');
        await page.screenshot({ path: 'website/gbp-state.png' });
        await ctx.close();
        process.exit(3);
      }
    } else if (b.includes('Confirm your business')) {
      console.log('next:', await next());
    } else if (await page.locator('input[placeholder="Business name"]').count()) {
      const nb = page.locator('input[placeholder="Business name"]');
      const cb = page.locator('input[placeholder="Business category"]');
      if (await nb.count() && !(await nb.inputValue())) {
        await nb.fill('FoodHubbie ERP');
        await sleep(1000);
        await page.keyboard.press('Escape');
        await sleep(400);
      }
      if (await cb.count() && !(await cb.inputValue())) {
        await cb.fill('Software company', { force: true });
        await sleep(2500);
        await page.evaluate(() => {
          const o = [...document.querySelectorAll('[role="option"]')].find(
            (e) => e.offsetParent && e.textContent.trim() === 'Software company'
          );
          o?.click();
        });
        await sleep(1500);
        await page.keyboard.press('Escape');
        await sleep(400);
      }
      console.log('next:', await next());
    } else {
      if (/Select a way to get verified|Submit a Business Video/i.test(b)) {
        console.log('>>> PARKED: verification page reached — user takeover');
        for (let i = 0; i < 45; i++) {
          await sleep(20000);
          let t = '';
          try { t = await body(); } catch { continue; }
          const head = t.replace(/\s+/g, ' ').slice(0, 180);
          console.log('[' + i + '] ' + head);
          if (/video is being processed|verification is complete|review in progress|thanks for verifying|Verified/i.test(t)) { console.log('DONE SIGNAL'); break; }
        }
        await page.screenshot({ path: 'website/gbp-state.png' });
        await ctx.close();
        process.exit(0);
      }
      console.log('UNKNOWN PAGE - stopping. Inventory: ' + await dumpInv());
      await page.screenshot({ path: 'website/gbp-state.png' });
      await ctx.close();
      process.exit(0);
    }
    await sleep(6000);
  }
  console.log('FINAL: ' + (await body()).slice(0, 1000));
  console.log('INVENTORY: ' + await dumpInv());
  await page.screenshot({ path: 'website/gbp-state.png' });
  await ctx.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
