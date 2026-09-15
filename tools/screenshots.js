const { chromium } = require('playwright');
const outDir = 'D:\\Foodhubbie Project\\assets\\generated';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const shots = [
    { url: 'http://localhost:3002/home.html', file: 'menu-landing.png', wait: 4000 },
    { url: 'http://localhost:3002/home.html', file: 'menu-landing-mobile.png', wait: 3000, mobile: true },
    { url: 'http://localhost:3003/', file: 'rider-login-mobile.png', wait: 3000, mobile: true },
  ];

  for (const s of shots) {
    const viewport = s.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const c = s.mobile ? await browser.newContext({ viewport, isMobile: true }) : ctx;
    const page = await c.newPage();
    try {
      await page.goto(s.url, { waitUntil: 'networkidle', timeout: 15000 });
    } catch {
      await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
    await page.waitForTimeout(s.wait);
    await page.screenshot({ path: `${outDir}\\${s.file}`, fullPage: true });
    console.log(`✓ ${s.file}`);
    await page.close();
    if (s.mobile) await c.close();
  }

  await browser.close();
  console.log('Done');
})();
