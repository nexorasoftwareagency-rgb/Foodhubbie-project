require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
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

const app = express();
app.use(express.json());

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

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
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

    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    await redis.publish(
      `bot-inbox:${routing.businessId}:${routing.outletId}`,
      JSON.stringify(message)
    );
    await redis.quit();
    console.log(`Routed message to bot-inbox:${routing.businessId}:${routing.outletId}`);
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

const PORT = process.env.WEBHOOK_PORT || 5000;
app.listen(PORT, () => console.log(`Webhook server listening on ${PORT}`));
