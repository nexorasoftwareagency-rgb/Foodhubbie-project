/**
 * whatsapp-graph.js — thin wrapper around the Meta Graph API for WhatsApp
 * Cloud API number + template management (plan G1/G2/C3).
 *
 * All calls use META_SYSTEM_USER_TOKEN (a long-lived system user token with
 * whatsapp_business_management + whatsapp_business_messaging scopes). No
 * per-number app token is needed — the system user token reaches every
 * number under the WABAs the business owns.
 */

const GRAPH = 'https://graph.facebook.com/v20.0';

function token() {
  return process.env.META_SYSTEM_USER_TOKEN;
}

async function graphOk(res, action) {
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      const e = data?.error;
      detail = e?.error_user_msg || e?.message || JSON.stringify(data);
      if (e?.error_subcode) detail += ` (${e.error_subcode})`;
      const dd = e?.error_data?.details;
      if (dd) detail += ` — ${dd}`;
    } catch { /* body not json */ }
    throw new Error(`${action} failed — Graph API ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

async function gql(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: { Authorization: `Bearer ${token()}` } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${GRAPH}/${path}`, opts);
  return res;
}

/** List WABAs the system user token can see (fallback: a configured WABA_ID). */
async function listWabas() {
  if (process.env.WABA_ID) return [{ id: process.env.WABA_ID, name: process.env.WABA_NAME || 'Default WABA' }];
  // /me/businesses → owned_whatsapp_business_accounts. Keep it permissive —
  // if we can't enumerate, the caller can supply WABA_ID.
  const res = await gql('me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name}');
  if (!res.ok) return [];
  const data = await res.json();
  const wabas = [];
  for (const biz of data.data || []) {
    for (const waba of biz.owned_whatsapp_business_accounts?.data || []) {
      wabas.push({ id: waba.id, name: waba.name || biz.name });
    }
  }
  return wabas;
}

/** List phone numbers on a WABA. */
async function listNumbers(wabaId) {
  const res = await gql(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status`);
  return graphOk(res, 'List phone numbers').then((r) => r.json());
}

/** Add an owned number to the WABA (pre-verification). */
async function addNumber(wabaId, { verified_name, display_phone_number, cc }) {
  const res = await gql(`${wabaId}/phone_numbers`, {
    method: 'POST',
    body: { verified_name, display_phone_number, cc },
  });
  return graphOk(res, 'Add phone number').then((r) => r.json());
}

/** Send an SMS/voice verification code to prove ownership. */
async function requestCode(phoneNumberId, { method = 'sms', language = 'en' } = {}) {
  const res = await gql(`${phoneNumberId}/request_code`, {
    method: 'POST',
    body: { code_method: method, language },
  });
  return graphOk(res, 'Request verification code').then((r) => r.json());
}

/** Submit the verification code received on the number. */
async function verifyCode(phoneNumberId, code) {
  const res = await gql(`${phoneNumberId}/verify_code`, {
    method: 'POST',
    body: { code },
  });
  return graphOk(res, 'Verify code').then((r) => r.json());
}

/** Register the number with the Cloud API and set 2FA pin (required within
 * 14 days of Embedded Signup). Returns { success, wabaId } when the number
 * was provisioned by a signup. */
async function registerNumber(phoneNumberId, pin) {
  const res = await gql(`${phoneNumberId}/register`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', pin },
  });
  return graphOk(res, 'Register number').then((r) => r.json());
}

/** Deregister the number from the Cloud API (stop Cloud API usage). */
async function deregisterNumber(phoneNumberId) {
  const res = await gql(`${phoneNumberId}/deregister`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp' },
  });
  return graphOk(res, 'Deregister number').then((r) => r.json());
}

/** Subscribe this app's webhooks to the WABA so inbound messages route. */
async function subscribeApps(wabaId) {
  const res = await gql(`${wabaId}/subscribed_apps`, { method: 'POST' });
  return graphOk(res, 'Subscribe WABA').then((r) => r.json());
}

/** List message templates on the WABA. */
async function listTemplates(wabaId) {
  const res = await gql(`${wabaId}/message_templates?fields=name,status,category,language`);
  return graphOk(res, 'List templates').then((r) => r.json());
}

/** Create a message template on the WABA. Sample values for each variable
 * come from the `variables` map ({'{{1}}': 'Customer name', ...}) — Meta
 * requires example text for every variable or the template is rejected. */
async function createTemplate(wabaId, { name, category, language, body, components = [], variables = {} }) {
  const sampleFor = (label) => ({
    'Customer name': 'Priya',
    'Restaurant name': 'My Restaurant',
    'Order number': 'PZ-1234',
    'Discount amount': '20%',
    'Promo code': 'PIZZA20',
    'Offer expiry': '30 Sep',
    'Estimated delivery time': '30 mins',
  }[label] || label);
  let comps = components.length ? components : [{ type: 'BODY', text: body }];
  const varLabels = Object.entries(variables).sort(([a], [b]) => a.localeCompare(b));
  if (varLabels.length && !comps[0].example) {
    comps = comps.map((c) => c.type === 'BODY'
      ? { ...c, example: { body_text: [varLabels.map(([, l]) => sampleFor(l))] } }
      : c);
  }
  const res = await gql(`${wabaId}/message_templates`, {
    method: 'POST',
    body: { name, category, language, components: comps },
  });
  return graphOk(res, 'Create template').then((r) => r.json());
}

module.exports = {
  token,
  listWabas,
  listNumbers,
  addNumber,
  requestCode,
  verifyCode,
  registerNumber,
  deregisterNumber,
  subscribeApps,
  listTemplates,
  createTemplate,
};