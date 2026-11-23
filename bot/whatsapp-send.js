/**
 * SAFEST-FIRST: one shared Graph API caller for all send types.
 * On 429 (rate-limited) or 5xx (Meta server error), retries ONCE, honoring
 * Meta's `Retry-After` header when present, else a conservative 3s wait.
 * Never retries other 4xx errors. Never retries more than once.
 */
async function _postToGraph(phoneNumberId, accessToken, body, { retried = false } = {}) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const status = res.status;
    const retryable = status === 429 || status >= 500;
    if (retryable && !retried) {
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : 3000;
      console.warn(`[WA-SEND] Graph API ${status} — retrying once in ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return _postToGraph(phoneNumberId, accessToken, body, { retried: true });
    }
    console.error('WhatsApp send failed:', JSON.stringify(data));
    // Keep the Graph error code on the Error (batch 23o). A caller has to tell
    // "outside the 24h customer-service window" (131047) from a real failure:
    // it is the one case where a free-form reply must be retried as an approved
    // template. The message string is unchanged, so every existing caller and
    // its template->text fallback behave exactly as before.
    const err = new Error(data.error?.message || `WhatsApp send failed (${status})`);
    err.status = status;
    if (data.error) {
      err.code = data.error.code;
      err.subcode = data.error.error_subcode;
      err.details = data.error.error_data?.details;
      err.fbtraceId = data.error.fbtrace_id;
    }
    throw err;
  }
  return data;
}

async function sendWhatsAppMessage(phoneNumberId, accessToken, to, text) {
  return _postToGraph(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text }
  });
}

async function sendWhatsAppImage(phoneNumberId, accessToken, to, imageUrl, caption) {
  return _postToGraph(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: { link: imageUrl, caption }
  });
}

async function sendWhatsAppUrlButton(phoneNumberId, accessToken, to, { body, url, title, headerImageUrl, footer }) {
  const interactive = {
    type: 'cta_url',
    body: { text: body },
    action: {
      name: 'cta_url',
      parameters: { display_text: title, url }
    }
  };
  if (headerImageUrl && headerImageUrl.startsWith('http')) {
    interactive.header = { type: 'image', image: { link: headerImageUrl } };
  }
  if (footer) interactive.footer = { text: footer };
  return _postToGraph(phoneNumberId, accessToken, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive
  });
}

async function sendWhatsAppTemplate(phoneNumberId, accessToken, to, { name, language = 'en', components = [] }) {
  // components: array of { type: 'BODY', parameters: [{ type: 'text', text: 'val' }, ...] }
  const template = { name, language: { code: language }, components };
  return _postToGraph(phoneNumberId, accessToken, { messaging_product: 'whatsapp', to, type: 'template', template });
}

module.exports = { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppUrlButton, sendWhatsAppTemplate };
