// Full QR table flow: add combo -> cart -> YAY99 coupon -> checkout -> receipt review.
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', '@playwright', 'test'));

const OWNER = JSON.parse(fs.readFileSync('C:/Users/2nile/AppData/Local/Temp/opencode/mint-owner.json', 'utf8'));
const MENU = 'https://foodhubbie-qrmenu.web.app';
const DB = 'https://foodhubbie-10-default-rtdb.firebaseio.com/businesses/roshani-pizza/outlets/pizza';
const SHOTS = '.playwright-mcp';
const now = Date.now();
const PHONE = '9000011122'; // test guest, deleted after
const COMBO_NAME = 'E2E Checkout Combo';

async function rest(method, path_, token, body) {
  const url = `${DB}/${path_}.json?auth=${token}`;
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const money = (t) => parseFloat(String(t).replace(/[^\d.]/g, '')) || 0;

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  const combo = {
    name: COMBO_NAME,
    items: [
      { dishId: '-OrsBLj9_DY1vee3_G9z', qty: 1, price: 109 },
      { dishId: '-Ors9dhe8IYFxYkBXzOn', qty: 1, price: 119 },
    ],
    discountType: 'percentage', discountValue: 20,
    startAt: now - 3600e3, endAt: now + 86400e3,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const seed = await rest('POST', 'combos', OWNER.idToken, combo);
  const comboId = seed.json && seed.json.name;
  console.log('[1] combo seeded', comboId, seed.status);

  const browser = await chromium.launch();
  let pass = true;
  const ck = (label, cond, actual) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}:`, actual); if (!cond) pass = false; };

  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    // --- Open QR menu, dismiss welcome ---
    await page.goto(MENU + '/?o=pizza&b=roshani-pizza&t=2B5YC71M1M5L654D');
    await page.waitForFunction(() => !!document.querySelector('.screen.active'), { timeout: 15000 });
    await page.evaluate(() => {
      if (!document.getElementById('screenMenu')?.classList.contains('active'))
        document.getElementById('btnStartOrdering')?.click();
    });
    await page.waitForSelector('#screenMenu.active', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1200);

    // --- Add combo to cart ---
    const card = page.locator('#comboOffersGrid .combo-card').filter({ hasText: COMBO_NAME });
    await card.locator('button', { hasText: /Add Combo/i }).click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const badge = await page.locator('#menuCartCount').textContent();
    ck('cart badge after add', badge.trim() === '2', badge);
    await page.screenshot({ path: path.join(SHOTS, 'flow-1-menu-after-add.png') });

    // --- Open cart ---
    await page.locator('[data-bottom-tab="screenCart"]').click();
    await page.waitForSelector('#screenCart.active', { state: 'attached', timeout: 8000 });
    await page.waitForTimeout(600);
    const lines = await page.locator('#cartList, .cart-list, [class*=cart] li, [class*=cart-item]').allTextContents().catch(() => []);
    const subtotalPre = money(await page.locator('#cartSubtotal').textContent());
    ck('cart subtotal = 87+95=182', subtotalPre === 182, subtotalPre);
    const preTotal = money(await page.locator('#cartTotal').textContent());
    console.log('  pre-coupon total (incl tax/SC):', preTotal);
    await page.screenshot({ path: path.join(SHOTS, 'flow-2-cart-before-coupon.png') });

    // --- Apply YAY99 ---
    await page.fill('#discountCodeInput', 'YAY99');
    await page.locator('#btnApplyDiscount').click();
    await page.waitForFunction(() => !document.getElementById('cartDiscountRow')?.classList.contains('hidden'), { timeout: 8000 });
    await page.waitForTimeout(400);
    const dLabel = await page.locator('#cartDiscountLabel').textContent();
    const dAmt = money(await page.locator('#cartDiscount').textContent());
    const subtotal = money(await page.locator('#cartSubtotal').textContent());
    const totalAfter = money(await page.locator('#cartTotal').textContent());
    const taxRows = (await page.locator('#cartTaxRows .cart-summary-row').allTextContents()).join(' ; ');
    const scVisible = await page.locator('#cartServiceChargeRow').isVisible().catch(() => false);
    const scAmt = scVisible ? money(await page.locator('#cartServiceCharge').textContent()) : 0;
    console.log('  discount row:', dLabel, await page.locator('#cartDiscount').textContent());
    console.log('  tax rows:', taxRows, '| service charge:', scVisible ? scAmt : '(off)');
    const expDisc = Math.round(182 * 0.23); // 41.86 -> 42
    ck('discount = round(182*23%) = 42', dAmt === expDisc, dAmt);
    ck('label has Weekend Special + 23%', /Weekend Special/.test(dLabel) && /23%/.test(dLabel), dLabel);
    const taxAmt = taxRows ? taxRows.split(' ; ').reduce((s, r) => s + money(r.split('₹').pop()), 0) : 0;
    const expTotal = Math.round((subtotal + taxAmt + scAmt - dAmt) * 100) / 100;
    ck('total = sub+tax+SC-discount', Math.abs(totalAfter - expTotal) < 0.5, `${totalAfter} vs ${expTotal}`);
    await page.screenshot({ path: path.join(SHOTS, 'flow-3-cart-after-yay99.png') });

    // --- Checkout ---
    await page.fill('#checkoutName', 'E2E Tester');
    await page.fill('#checkoutPhone', PHONE);
    await page.locator('#btnPlaceOrder').click();

    // Group choice may intercept; otherwise wait for tracking (placement takes several RTTs)
    let active = null;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(1500);
      active = await page.evaluate(() => document.querySelector('.screen.active')?.id);
      if (active === 'screenChooseGroup') {
        console.log('  group choice appeared — picking first group');
        const gc = page.locator('.group-card').first();
        if (await gc.count()) { await gc.click(); await page.waitForTimeout(2000); }
        if (await page.evaluate(() => document.querySelector('.screen.active')?.id) === 'screenCart') {
          await page.locator('#btnPlaceOrder').click();
        }
      }
      if (active === 'screenTracking') break;
    }
    ck('checkout -> tracking screen', active === 'screenTracking', active);
    await page.waitForSelector('#trackingOrderItemsList .oi-row', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);

    // --- Receipt / tracking review ---
    const tracking = await page.evaluate(() => ({
      orderId: document.getElementById('trackingOrderId')?.textContent || '',
      table: document.getElementById('trackingTableLabel')?.textContent || '',
      count: document.getElementById('trackingOrderItemsCount')?.textContent || '',
      total: document.getElementById('trackingOrderItemsTotal')?.textContent || '',
      items: [...document.querySelectorAll('#trackingOrderItemsList .oi-row')].map(r => r.innerText.replace(/\n/g, ' ')),
      status: document.getElementById('trackingStatusLabel')?.textContent || '',
    }));
    console.log('[5] tracking receipt:', JSON.stringify(tracking, null, 1));
    await page.screenshot({ path: path.join(SHOTS, 'flow-4-tracking-receipt.png') });

    // --- RTDB order record check (fetch exact key from tracking id) ---
    const orderKey = tracking.orderId.replace(/^#/, '');
    const orderRes = await fetch(`${DB}/orders/${orderKey}.json?auth=${OWNER.idToken}`);
    const o = await orderRes.json();
    if (o) {
      console.log('[6] RTDB order', orderKey, JSON.stringify({ status: o.status, subtotal: o.subtotal, discount: o.discount, discountLabel: o.discountLabel, discountSource: o.discountSource, tax: o.tax, serviceCharge: o.serviceCharge, total: o.total, items: Object.values(o.items).map(i => `${i.name} x${i.qty} @${i.price}`) }));
      ck('order status Placed', o.status === 'Placed', o.status);
      ck('order discount = 42', o.discount === 42, o.discount);
      ck('order discountSource coupon:YAY99', o.discountSource === 'coupon:YAY99', o.discountSource);
      ck('order discountLabel = Weekend Special', o.discountLabel === 'Weekend Special', o.discountLabel);
      ck('order subtotal = 182', o.subtotal === 182, o.subtotal);
      const expO = Math.round((o.subtotal + o.tax + o.serviceCharge - o.discount) * 100) / 100;
      ck('order total math', Math.abs(o.total - expO) < 0.01, `${o.total} vs ${expO}`);
      ck('combo price baked (87/95)', Object.values(o.items).some(i => i.price === 87) && Object.values(o.items).some(i => i.price === 95), Object.values(o.items).map(i => i.price).join(','));
    } else {
      ck('test order found in RTDB', false, orderKey + ' not found');
    }

    console.log(pass ? 'PASS: full QR combo+coupon+checkout flow' : 'FAIL');
    if (!pass) process.exitCode = 1;
  } finally {
    await browser.close();
    if (comboId) { const d = await rest('DELETE', 'combos/' + comboId, OWNER.idToken); console.log('combo cleaned', d.status); }
    const g = await rest('DELETE', 'guests/' + PHONE, OWNER.idToken); console.log('guest cleaned', g.status);
  }
})().catch((e) => { console.error(e); process.exit(1); });
