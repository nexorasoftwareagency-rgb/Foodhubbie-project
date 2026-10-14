// Live combo E2E screenshots — admin Combos tab + QR menu combo section + add-to-cart
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { login, TEST_URLS } = require('./utils.js');

const SHOT_DIR = path.join(__dirname, '..', '.playwright-mcp');
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // ---------- 1. Admin: Combos tab ----------
  await login(page);
  await page.screenshot({ path: path.join(SHOT_DIR, 'combo-admin-dashboard.png') });

  // click Combos in sidebar
  await page.click('#menu-combos');
  await page.waitForTimeout(2500); // loadCombos onValue
  await page.screenshot({ path: path.join(SHOT_DIR, 'combo-admin-tab.png'), fullPage: false });
  console.log('[Shot] admin combos tab done');

  // click Add Combo -> modal
  await page.click('#btnAddCombo');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOT_DIR, 'combo-admin-add-modal.png') });
  console.log('[Shot] admin add-combo modal done');
  await page.keyboard.press('Escape'); // close modal if possible

  // ---------- 2. QR menu: combo section ----------
  const menuPage = await ctx.newPage();
  // live token pulled from RTDB (t= from tests/utils.js can go stale)
  await menuPage.goto('https://foodhubbie-qrmenu.web.app/?o=pizza&b=roshani-pizza&t=2B5YC71M1M5L654D');
  await menuPage.waitForTimeout(4000); // token validation + loadMenu
  // click Start Ordering if welcome screen
  try {
    await menuPage.click('#btnStartOrdering', { timeout: 5000 });
  } catch { /* already on menu or no welcome */ }
  await menuPage.waitForTimeout(2500);
  // if group choice appears, start own group
  try {
    await menuPage.click('#btnStartOwnGroup', { timeout: 3000 });
    await menuPage.waitForTimeout(1500);
  } catch { /* no group choice */ }
  await menuPage.screenshot({ path: path.join(SHOT_DIR, 'combo-menu-section.png') });
  console.log('[Shot] menu combo section done');

  // scroll to combo section if needed + verify visible
  const comboVisible = await menuPage.evaluate(() => {
    const el = document.getElementById('comboOffersSection');
    if (!el) return 'missing';
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    return el.classList.contains('hidden') ? 'hidden' : (el.querySelector('.combo-card') ? 'has-cards' : 'empty');
  });
  console.log('[Menu] comboOffersSection:', comboVisible);
  await menuPage.screenshot({ path: path.join(SHOT_DIR, 'combo-menu-scrolled.png') });

  // click Add Combo button on first card
  const added = await menuPage.evaluate(() => {
    const btn = document.querySelector('#comboOffersGrid button.combo-card-btn');
    if (!btn) return 'no-btn';
    btn.click();
    return 'clicked';
  });
  await menuPage.waitForTimeout(1200);
  console.log('[Menu] add combo click:', added);
  await menuPage.screenshot({ path: path.join(SHOT_DIR, 'combo-menu-after-add.png') });

  // open cart to verify discounted lines
  try {
    await menuPage.click('#btnOpenCartFromMenu', { timeout: 3000 });
    await menuPage.waitForTimeout(1000);
    await menuPage.screenshot({ path: path.join(SHOT_DIR, 'combo-menu-cart.png') });
    console.log('[Shot] cart after combo add done');
  } catch (e) { console.log('[Menu] cart open failed:', e.message); }

  await browser.close();
  console.log('ALL SHOTS DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
