// Local check for website/signup.html. Mocks the Firebase REST endpoints, so it never touches production.
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
const calls = [];
let failSecretsOnce = true;
await page.route('**/*', r => {
  const u = r.request().url(), m = r.request().method();
  if (u.startsWith('file:')) return r.continue();
  if (u.includes('firebaseio.com/onboardingRequests.json')) {
    calls.push(m + ' requests');
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"name":"-Kreq1"}' });
  }
  if (u.includes('firebaseio.com/onboardingSecrets/')) {
    calls.push(m + ' secrets ' + decodeURIComponent(u.split('onboardingSecrets/')[1].split('.json')[0]));
    if (failSecretsOnce) { failSecretsOnce = false; return r.fulfill({ status: 500, body: 'x' }); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  }
  return r.abort();
});
await page.goto(url);

ok(!(await page.locator('#successMsg').isVisible()), 'success message hidden before submit');

// invalid: short password, mismatch, no terms
await page.fill('#fBusiness', 'Spice Garden'); await page.fill('#fOutlet', 'Spice Garden Andheri');
await page.fill('#fPhone', '9724649971'); await page.fill('#fEmail', 'o@sg.com');
await page.fill('#fAdminEmail', 'a@sg.com'); await page.fill('#fAdminName', 'Rahul');
await page.fill('#fPassword', 'abcd1234'); await page.fill('#fPassword2', 'different1');
await page.click('.radio-card[data-value="starter"]', { force: true });
await page.evaluate(() => document.querySelectorAll('#signupForm [required]').forEach(e => e.removeAttribute('required'))); // bypass native bubbles to test our validation
await page.locator('#submitBtn').click({ force: true });
ok(await page.locator('#fPassword2Err').isVisible(), 'mismatched passwords show inline error');
ok(await page.locator('#fTermsErr').isVisible(), 'missing terms shows inline error');
ok(calls.length === 0, 'no network call while invalid');

// valid; first password save fails
await page.fill('#fPassword2', 'abcd1234'); await page.check('#fTerms', { force: true });
await page.locator('#submitBtn').click({ force: true });
await page.waitForSelector('#formStatus:not(:empty)');
ok(calls.join('|') === 'POST requests|PUT secrets -Kreq1', 'step1 then step2 attempted');
ok((await page.inputValue('#fBusiness')) === 'Spice Garden', 'entered data preserved after failure');
ok((await page.textContent('#submitBtn')) === 'Retry Submit', 'retry button shown');

// retry must NOT create a second request
await page.locator('#submitBtn').click({ force: true });
await page.waitForSelector('#signupForm.is-done');
ok(calls.filter(c => c === 'POST requests').length === 1, 'retry reuses request (exactly one POST)');
ok(calls.filter(c => c.startsWith('PUT secrets')).length === 2, 'retry re-sends only the password step');
ok(await page.locator('#successMsg').isVisible(), 'success shown');
ok(await page.locator('#fPassword').inputValue() === '', 'password cleared after success');
const before = calls.length;
await page.evaluate(() => document.getElementById('signupForm').requestSubmit());
await page.waitForTimeout(200);
ok(calls.length === before, 'no duplicate submission after success');

await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
