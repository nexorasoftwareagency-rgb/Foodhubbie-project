import { chromium } from 'playwright';

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto('https://menu.foodhubbie.in/?b=foodhubbie-demo&o=pizza', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Sign in
  await page.fill('#signInPhone', '9999999999');
  await page.fill('#signInName', 'E2E Test User');
  await page.click('#btnSignIn');
  await page.waitForTimeout(5000);

  // Go to Promotions > Account
  await page.click('button[data-bottom-tab="screenPromotions"]');
  await page.waitForTimeout(2000);
  await page.click('.promo-tab[data-promo-tab="account"]');
  await page.waitForTimeout(2000);

  // Check PWA cards exist
  const pwaCards = await page.evaluate(() => ({
    pwaNotifyCard: !!document.getElementById('pwaNotifyCard'),
    btnPwaNotify: !!document.getElementById('btnPwaNotify'),
    acctSave: !!document.getElementById('btnAcctSave'),
    acctClear: !!document.getElementById('btnAcctClear'),
    acctUpdates: !!document.getElementById('acctUpdates'),
  }));
  console.log('PWA/Account elements:', JSON.stringify(pwaCards, null, 1));
  check('pwaNotifyCard exists', pwaCards.pwaNotifyCard);
  check('btnPwaNotify exists', pwaCards.btnPwaNotify);
  check('btnAcctSave exists', pwaCards.acctSave);
  check('btnAcctClear exists', pwaCards.acctClear);
  check('acctUpdates toggle exists', pwaCards.acctUpdates);

  // Click "Forget me" to trigger confirm dialog
  await page.click('#btnAcctClear');
  await page.waitForTimeout(1000);

  // Check if confirm overlay appeared
  const overlayState = await page.evaluate(() => {
    const overlay = document.querySelector('.fh-confirm-overlay');
    if (!overlay) return { found: false };
    const title = overlay.querySelector('h3')?.textContent || '';
    const body = overlay.querySelector('p')?.textContent || '';
    const hasDeleteWords = body.includes('delete') || body.includes('permanently');
    const hasConfirmBtn = !!overlay.querySelector('.fh-confirm-ok');
    const hasCancelBtn = !!overlay.querySelector('.fh-confirm-cancel');
    return { found: true, title, body, hasDeleteWords, hasConfirmBtn, hasCancelBtn };
  });
  console.log('Confirm overlay:', JSON.stringify(overlayState, null, 1));
  check('confirm overlay appears', overlayState.found);
  check('confirm title mentions Forget', overlayState.title.includes('Forget'));
  check('confirm body lists what is deleted', overlayState.hasDeleteWords);
  check('confirm ok button exists', overlayState.hasConfirmBtn);
  check('confirm cancel button exists', overlayState.hasCancelBtn);

  // Cancel the dialog
  await page.click('.fh-confirm-cancel');
  await page.waitForTimeout(1000);
  const overlayGone = await page.evaluate(() => !document.querySelector('.fh-confirm-overlay'));
  check('confirm overlay dismissed on Cancel', overlayGone);

  // Click Forget me again, then confirm OK
  await page.click('#btnAcctClear');
  await page.waitForTimeout(1000);
  await page.click('.fh-confirm-ok');
  await page.waitForTimeout(2000);

  const afterClear = await page.evaluate(() => {
    const overlay = document.querySelector('.fh-confirm-overlay');
    const acctCard = document.getElementById('accountProfileCard');
    const acctEmpty = document.querySelector('.account-empty');
    return {
      overlayGone: !overlay,
      acctCardVisible: !!acctCard,
      signInShown: document.getElementById('signInForm') ? 'visible' : 'gone',
    };
  });
  console.log('After confirm OK:', JSON.stringify(afterClear, null, 1));
  check('overlay dismissed on OK', afterClear.overlayGone);
  check('account cleared (back to sign-in)', afterClear.signInShown === 'visible' || !afterClear.acctCardVisible);

  console.log('\nConsole errors:', errors.length);
  errors.slice(0, 3).forEach(e => console.log('  ERR:', e));
  check('no console errors', errors.length === 0);

} finally {
  await browser.close();
}

const failed = results.filter(r => !r.pass);
console.log('\n================ P0 VERIFICATION =================');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
