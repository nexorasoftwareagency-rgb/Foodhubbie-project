const crypto = require('crypto');
const https = require('https');

const token = 'test-verify-token';
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: '2589174454849821',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '+15551234567', phone_number_id: '1211796118690392' },
        messages: [{
          from: '15559990000',
          id: 'wamid.test123',
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          text: { body: 'Hello' }
        }]
      }
    }]
  })
};

const signature = 'sha256=' + crypto.createHmac('sha256', token).update(body).digest('hex');

const options = {
  hostname: 'whatsappwebhook-xydqit33wq-uc.a.run.app',
  port: 443,
  path: '/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Hub-Signature-256': signature
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('GET status:', res.statusCode);
    console.log('GET body:', body);
    if (res.statusCode === 200 && body === 'OK') {
      console.log('[PASS] Webhook processed message successfully!');
    } else {
      console.log('[FAIL] Webhook returned', res.statusCode, body);
    }
  });
});
req.on('error', e => console.error('GET error:', e.message));
req.end();