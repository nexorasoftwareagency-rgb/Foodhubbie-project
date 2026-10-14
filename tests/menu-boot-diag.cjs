const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', m => console.log('[con]', m.type(), m.text().slice(0, 300)));
  page.on('pageerror', e => console.log('[ERR]', e.message.slice(0, 500)));
  await page.goto('https://foodhubbie-qrmenu.web.app/?o=pizza&b=roshani-pizza&t=2B5YC71M1M5L654D');
  await page.waitForTimeout(9000);
  const state = await page.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return el ? (!el.classList.contains('hidden') && el.style.display !== 'none' ? 'visible' : 'hidden') : 'missing'; };
    return {
      loading: vis('loadingOverlay'), welcome: vis('screenWelcome'),
      menu: vis('screenMenu'), invalid: vis('screenInvalidToken') || vis('screenSessionExpired'),
      bodyIds: [...document.querySelectorAll('[id^=screen]')].map(e => e.id + ':' + (e.classList.contains('hidden') ? 'h' : 'V')).join(' ')
    };
  });
  console.log('STATE', JSON.stringify(state, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
