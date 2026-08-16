async function sendWhatsAppMessage(phoneNumberId, accessToken, to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error('WhatsApp send failed:', JSON.stringify(data));
    throw new Error(data.error?.message || 'WhatsApp send failed');
  }
  return data;
}

async function sendWhatsAppImage(phoneNumberId, accessToken, to, imageUrl, caption) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: imageUrl, caption }
      })
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error('WhatsApp image send failed:', JSON.stringify(data));
    throw new Error(data.error?.message || 'WhatsApp image send failed');
  }
  return data;
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
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive
      })
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error('WhatsApp url-button send failed:', JSON.stringify(data));
    throw new Error(data.error?.message || 'WhatsApp url-button send failed');
  }
  return data;
}

async function sendWhatsAppTemplate(phoneNumberId, accessToken, to, { name, language = 'en', body }) {
  const template = { name, language: { code: language } };
  // Body component only when the template actually has a {{1}} placeholder —
  // passing `text` to a no-variable template is rejected by Graph (code 100),
  // which callers rely on to fall back to plain text.
  template.components = body ? [{ type: 'BODY', parameters: [{ type: 'text', text: body }] }] : [];
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template })
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error('WhatsApp template send failed:', JSON.stringify(data));
    throw new Error(data.error?.message || 'WhatsApp template send failed');
  }
  return data;
}

module.exports = { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppUrlButton, sendWhatsAppTemplate };
