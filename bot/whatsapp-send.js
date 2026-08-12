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

module.exports = { sendWhatsAppMessage, sendWhatsAppImage, sendWhatsAppUrlButton };
