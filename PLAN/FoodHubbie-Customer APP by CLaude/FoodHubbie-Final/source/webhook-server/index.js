require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { createClient } = require('redis');
const path = require('path');

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, '..', 'bot', 'service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com'
  });
}

// Single shared Redis client — creating one per webhook was churning connections
const redis = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;
if (redis) {
  redis.on('error', (err) => console.error('[REDIS]', err.message));
  redis.connect().catch((err) => console.error('[REDIS] connect failed:', err.message));
}

const app = express();
app.use('/public', express.static(path.join(__dirname, 'public')));

// Proxy /api/* → Bot Control API (port 4000). The Cloudflare Quick Tunnel
// only routes to a single local port (this webhook server on 5000), so the
// Supreme Admin dashboard's /api calls reach PM2 control by forwarding here.
const http = require('http');
const BOT_CONTROL_PORT = process.env.BOT_CONTROL_PORT || 4000;
app.use('/api', (req, res) => {
  const proxyReq = http.request({
    host: '127.0.0.1',
    port: BOT_CONTROL_PORT,
    path: req.originalUrl,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${BOT_CONTROL_PORT}` },
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    console.error('[PROXY] Bot Control API unreachable:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Bot Control API unreachable' });
  });
  req.pipe(proxyReq);
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('Webhook verified successfully by Meta.');
    return res.status(200).send(challenge);
  }
  console.warn('Webhook verification FAILED - token mismatch or wrong mode.');
  res.sendStatus(403);
});

app.post('/webhook', express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}), async (req, res) => {
  res.sendStatus(200);
  try {
    const appSecret = process.env.META_APP_SECRET;
    if (appSecret) {
      const signature = req.headers['x-hub-signature-256'];
      const expected = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(req.rawBody || '')
        .digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(signature || '');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn('[WEBHOOK] Rejected request with invalid X-Hub-Signature-256');
        return;
      }
    } else {
      console.warn('[WEBHOOK] META_APP_SECRET not set — signature verification disabled');
    }
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    if (change?.statuses) {
      console.log('[STATUS]', JSON.stringify(change.statuses));
      return;
    }
    const phoneNumberId = change?.metadata?.phone_number_id;
    const message = change?.messages?.[0];
    if (!phoneNumberId || !message) return;

    const routingSnap = await admin.database()
      .ref(`phoneNumberIndex/${phoneNumberId}`).get();
    const routing = routingSnap.val();
    if (!routing) {
      console.warn('No routing found for phone_number_id:', phoneNumberId);
      return;
    }

    // WhatsApp coexistence: when the same number runs on the WhatsApp
    // Business App + Cloud API, mirrored messages carry origin.type =
    // 'business_app'. ('update' means *message edited* — NOT coexistence —
    // so we only trust 'business_app'.) Record it (best-effort) so the
    // Supreme Admin can show the mode. Never auto-flip OFF — the owner may
    // disable it in-app, which we can't observe, so absence is left as-is.
    const originType = message.origin?.type;
    if (originType === 'business_app') {
      // update() not set() — the "I've enabled it" record ({enabledAt, by})
      // lives on the same node and must survive mirrored-message writes.
      admin.database()
        .ref(`businesses/${routing.businessId}/outlets/${routing.outletId}/whatsapp/coexistence`)
        .update({ mode: originType, lastSeenAt: Date.now() })
        .catch((err) => console.warn('[COEXISTENCE] record failed:', err.message));
    }

    if (redis) {
      await redis.publish(
        `bot-inbox:${routing.businessId}:${routing.outletId}`,
        JSON.stringify(message)
      );
      console.log(`Routed message to bot-inbox:${routing.businessId}:${routing.outletId}`);
    } else {
      console.warn('Redis not configured — message dropped:', JSON.stringify(message));
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

const PORT = process.env.WEBHOOK_PORT || 5000;
app.listen(PORT, () => console.log(`Webhook server listening on ${PORT}`));
