const crypto = require('crypto');
const https = require('https');

const token = 'test-verify-token';
const signature = 'sha256=' + crypto.createHmac('sha256', token).update('{}').digest('hex');
console.log('Signature:', signature);

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
  }]
});

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', body);
    if (res.statusCode === 200) {
      console.log('[PASS] Webhook processed message successfully!');
    } else {
      console.log('[FAIL] Webhook returned', res.statusCode, body);
    }
  });
});
req.on('error', e => console.error('Request error:', e.message));
req.end();