// Local check for website/signup.html. Mocks Firebase Auth + the RTDB REST call,
// so it never touches production.
// Run: node tests/signup-onboarding.check.mjs   (needs Playwright's chromium)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // CJS resolution honours NODE_PATH / global installs
import path from 'path';
import { pathToFileURL } from 'url';

const url = pathToFileURL(path.resolve('website/signup.html')).href;
let failures = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage();

// Test seam: the page imports ./signup-auth.js only when this is absent.
await page.addInitScript(() => {
  window.__fhTestMode = 'ok';
  window.__fhSignupAuth = {
    calls: [],
    createAccount: async (email, password) => {
      window.__fhSignupAuth.calls.push(['create', email, password]);
      if (window.__fhTestMode === 'taken' || window.__fhTestMode === 'taken-wrong') {
        const e = new Error('email in use'); e.code = 'auth/email-already-in-use'; throw e;
      }
      return { uid: 'uid-new' };
    },
    signInExisting: async (email, password) => {
      window.__fhSignupAuth.calls.push(['signin', email, password]);
      if (window.__fhTestMode === 'taken-wrong') {
        const e = new Error('bad password'); e.code = 'auth/invalid-credential'; throw e;
      }
      return { uid: 'uid-existing' };
    },
  };
});

const calls = [];
const bodies = [];
let failRequestOnce = true;
await page.route('**/*', r => {
  const u = r.request().url(), m = r.request().method();
  if (u.startsWith('file:')) return r.continue();
  if (u.includes('firebaseio.com/onboardingRequests.json')) {
    calls.push(m + ' requests');
    bodies.push(JSON.parse(r.request().postData() || '{}'));
    if (failRequestOnce) { failRequestOnce = false; return r.fulfill({ status: 500, body: 'x' }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"name":"-Kreq1"}' });
  }
  if (u.includes('onboardingSecrets')) {
    calls.push(m + ' secrets'); // must never happen again
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  }
  return r.abort(); // no real Firebase Auth traffic: the stub handles it
});
await page.goto(url);

ok(!(await page.locator('#successMsg').isVisible()), 'success message hidden before submit');

async function fillForm() {
  await page.fill('#fBusiness', 'Spice Garden');
  await page.fill('#fOutlet', 'Spice Garden Andheri');
  await page.fill('#fPhone', '9724649971');
  await page.fill('#fEmail', 'o@sg.com');
  await page.fill('#fAdminEmail', 'a@sg.com');
  await page.fill('#fAdminName', 'Rahul');
  await page.fill('#fPassword', 'abcd1234');
  await page.fill('#fPassword2', 'abcd1234');
  await page.click('.radio-card[data-value="starter"]', { force: true });
  await page.locator('#fTerms').check();
  await page.evaluate(() => document.querySelectorAll('#signupForm [required]').forEach(e => e.removeAttribute('required')));
}

// invalid: short password, mismatch, no terms
await page.fill('#fBusiness', 'Spice Garden'); await page.fill('#fOutlet', 'Spice Garden Andheri');
await page.fill('#fPhone', '9724649971'); await page.fill('#fEmail', 'o@sg.com');
await page.fill('#fAdminEmail', 'a@sg.com'); await page.fill('#fAdminName', 'Rahul');
await page.fill('#fPassword', 'abcd1234'); await page.fill('#fPassword2', 'different1');
await page.click('.radio-card[data-value="starter"]', { force: true });
await page.evaluate(() => document.querySelectorAll('#signupForm [required]').forEach(e => e.removeAttribute('required'))); // bypass native bubbles to test our validation
await page.evaluate(() => document.getElementById('signupForm').requestSubmit());
ok(await page.locator('#fPassword2Err').isVisible(), 'mismatched passwords show inline error');
ok(await page.locator('#fTermsErr').isVisible(), 'missing terms shows inline error');
ok(calls.length === 0, 'no network call while invalid');
ok((await page.evaluate(() => window.__fhSignupAuth.calls.length)) === 0, 'no Auth account created while invalid');

// valid; the first request write fails, the account is already created
await page.fill('#fPassword2', 'abcd1234');
await page.locator('#fTerms').check();
await page.evaluate(() => document.getElementById('signupForm').requestSubmit());
await page.waitForSelector('#formStatus:not(:empty)');
ok(calls.join('|') === 'POST requests', 'request attempted, no secrets write');
ok((await page.inputValue('#fBusiness')) === 'Spice Garden', 'entered data preserved after failure');
ok((await page.textContent('#submitBtn')) === 'Retry Submit', 'retry button shown');
const afterCreate = await page.evaluate(() => window.__fhSignupAuth.calls.slice());
ok(afterCreate.length === 1 && afterCreate[0][0] === 'create' && afterCreate[0][1] === 'a@sg.com',
  'the password went browser -> Firebase Auth exactly once');

// retry must NOT create a second request or a second account
await page.evaluate(() => document.getElementById('signupForm').requestSubmit());
await page.waitForSelector('#signupForm.is-done');
ok(calls.filter(c => c === 'POST requests').length === 2, 'retry re-sends the request write');
ok((await page.evaluate(() => window.__fhSignupAuth.calls.length)) === 1, 'retry does not create a second Auth account');
ok(!calls.some(c => c.includes('secrets')), 'the password is never written to the database');
ok(okBody(), 'request carries authUid and no password field');
function okBody() {
  const b = bodies[bodies.length - 1] || {};
  const keys = Object.keys(b);
  return b.authUid === 'uid-new'
    && !keys.some(k => /password/i.test(k));
}
ok(await page.locator('#successMsg').isVisible(), 'success shown');
ok(await page.locator('#fPassword').inputValue() === '', 'password cleared from the DOM after success');
const before = calls.length;
await page.evaluate(() => document.getElementById('signupForm').requestSubmit());
await page.waitForTimeout(200);
ok(calls.length === before, 'no duplicate submission after success');

// email already taken + wrong password -> clear inline error, no request written
await page.reload();
await page.evaluate(() => { window.__fhTestMode = 'taken-wrong'; });
await fillForm();
await page.evaluate(() => document.getElementById('signupForm').requestSubmit());
await page.waitForSelector('#formStatus:not(:empty)');
ok((await page.textContent('#formStatus')).includes('already has a login'), 'existing email with a wrong password is explained');
ok(calls.filter(c => c === 'POST requests').length === 2, 'a taken email with a wrong password writes no request');

// email already taken + correct password -> resumes on the existing account
await page.reload();
await page.evaluate(() => { window.__fhTestMode = 'taken'; });
await fillForm();
await page.evaluate(() => document.getElementById('signupForm').requestSubmit());
await page.waitForSelector('#signupForm.is-done');
const last = bodies[bodies.length - 1] || {};
ok(last.authUid === 'uid-existing', 'a resumed signup reuses the existing account uid');
ok(bodies.filter(b => b.adminEmail === 'a@sg.com').length === 3, 'still exactly one request write per submit attempt');

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
