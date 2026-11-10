const crypto = require('crypto');
const https = require('https');

const secret = 'test-verify-token';
const signature = 'sha256=' + crypto.createHmac('sha256', secret).update('{}').digest('hex');
console.log('Signature:', signature);

const options = {
  hostname: 'whatsappwebhook-xydqit33wq-uc.a.run.app',
  port: 443,
  path: '/?hub.mode=subscribe&hub.verify_token=' + secret + '&hub.challenge=TEST_CHALLENGE_123',
  method: 'GET',
  headers: {
    'X-Hub-Signature-256': signature
  }
};
const req = https.request(options, (res) => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('GET status:', res.statusCode);
    console.log('GET body:', body);
    if (res.statusCode === 200 && body === 'TEST_CHALLENGE_123') {
      console.log('[PASS] Webhook verification works!');
    } else {
      console.log('[FAIL] Webhook verification returned', res.statusCode, body);
    }
  });
});
req.on('error', e => console.error('GET error:', e.message));
req.end();