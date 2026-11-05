/**
 * P0-4 retest: outlet-scoped logs/walkouts write under admin auth.
 * Uses REST PUT with a Firebase ID token minted from the logged-in Admin
 * page — verifies security rules allow the real path businesses/{bid}/
 * outlets/{oid}/logs/walkouts/{id} (the pre-fix bug wrote to root
 * /logs/walkouts, which has no write rule → PERMISSION_DENIED).
 */
const { test, expect } = require('@playwright/test');
const { login, clearSWAndCaches, TEST_URLS } = require('./utils');

const WALKOUT_KEY = 'p04-retest-' + Date.now();
const REST_BASE = 'https://foodhubbie-10-default-rtdb.firebaseio.com/businesses/roshani-pizza/outlets/pizza/logs/walkouts';

test.describe('P0-4 Walkout rules retest', () => {
  test('admin can write outlet-scoped logs/walkouts', async ({ page }) => {
    await clearSWAndCaches(page);
    await login(page);

    const token = await page.evaluate(async () => {
      const mod = await import('/js/firebase.js');
      return await mod.auth.currentUser.getIdToken();
    });
    expect(token).toBeTruthy();

    const payload = {
      walkoutId: WALKOUT_KEY,
      tableId: 'p04-test',
      sessionId: 'p04-test',
      tableNumber: 0,
      reason: 'P0-4 rules retest',
      subtotal: 1,
      orders: [],
      walkedOutAt: Date.now(),
      createdAt: Date.now(),
      recordedBy: 'p04-retest',
      outlet: 'pizza'
    };

    const put = await page.request.put(`${REST_BASE}/${WALKOUT_KEY}.json?auth=${token}`, {
      data: payload
    });
    console.log('[P0-4] write status:', put.status(), await put.text());
    expect(put.status()).toBe(200);

    const get = await page.request.get(`${REST_BASE}/${WALKOUT_KEY}.json?auth=${token}`);
    const body = await get.json();
    expect(body).toBeTruthy();
    expect(body.reason).toBe('P0-4 rules retest');

    // cleanup
    await page.request.delete(`${REST_BASE}/${WALKOUT_KEY}.json?auth=${token}`);
    console.log('[P0-4] PASS — outlet-scoped walkout write allowed');
  });
});
