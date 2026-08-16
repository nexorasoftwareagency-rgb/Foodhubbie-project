// Seeds platform-level onboarding templates under appTemplates (plan C1).
// Templates are what "Start from a template" on the Add Restaurant form
// applies: settings/categories/delivery/tax/bot defaults for a new outlet.
// The dashboard only reads this node; it never creates templates itself.
const admin = require('firebase-admin');
const serviceAccount = require('../bot/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});

const db = admin.database();

const templates = {
  pizza: {
    name: 'Pizza restaurant',
    description: 'Dine-in + delivery pizza outlet with category skeleton and delivery slabs.',
    defaults: {
      settings: {
        Store: {
          orderPrefix: 'PZ',
          customerMenuBgImage: null,
        },
        Delivery: {
          enabled: true,
          slabs: [
            { upToKm: 3, fee: 30 },
            { upToKm: 6, fee: 50 },
            { upToKm: 10, fee: 80 },
          ],
        },
        Tax: { enabled: true, name: 'GST', percent: 5 },
        Hours: { open: '11:00', close: '23:00' },
      },
      categories: {
        starters: { name: 'Starters', sort: 1 },
        pizzas: { name: 'Pizzas', sort: 2 },
        beverages: { name: 'Beverages', sort: 3 },
        desserts: { name: 'Desserts', sort: 4 },
      },
      bot: { transport: 'baileys' },
    },
  },
  cake: {
    name: 'Cake shop',
    description: 'Custom cakes + delivery outlet.',
    defaults: {
      settings: {
        Store: { orderPrefix: 'CK' },
        Delivery: { enabled: true, slabs: [{ upToKm: 5, fee: 60 }] },
        Tax: { enabled: true, name: 'GST', percent: 18 },
        Hours: { open: '10:00', close: '21:00' },
      },
      categories: {
        cakes: { name: 'Cakes', sort: 1 },
        cupcakes: { name: 'Cupcakes', sort: 2 },
      },
      bot: { transport: 'baileys' },
    },
  },
  kitchen: {
    name: 'Cloud kitchen',
    description: 'Delivery-first kitchen, minimal categories.',
    defaults: {
      settings: {
        Store: { orderPrefix: 'CK' },
        Delivery: { enabled: true, slabs: [{ upToKm: 4, fee: 40 }] },
        Tax: { enabled: true, name: 'GST', percent: 5 },
        Hours: { open: '12:00', close: '23:30' },
      },
      categories: {
        mains: { name: 'Mains', sort: 1 },
        snacks: { name: 'Snacks', sort: 2 },
      },
      bot: { transport: 'baileys' },
    },
  },
};

// Starter WhatsApp message-template library (plan C3). These are ready-to-
// create Meta templates a restaurant can install on its WABA with one click
// (via the profile "Message templates" card). Category is Meta's category
// name; body uses {{1}} placeholders where needed.
const whatsappTemplates = {
  order_confirmed: {
    name: 'order_confirmed',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, your order #{{2}} at {{3}} has been confirmed. Estimated delivery: {{4}}. Thank you for ordering!',
    explanation: 'Confirms a placed order and sets delivery expectations for the customer.',
    useCase: 'Send automatically right after a customer places an order, to acknowledge receipt and tell them when to expect it.',
    variables: { '{{1}}': 'Customer name', '{{2}}': 'Order number', '{{3}}': 'Restaurant name', '{{4}}': 'Estimated delivery time' },
  },
  order_delivered: {
    name: 'order_delivered',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, your order #{{2}} from {{3}} has been delivered. Enjoy! We hope to serve you again soon.',
    explanation: 'Notifies the customer that their order has been delivered.',
    useCase: 'Send when a rider marks an order as delivered, to close the loop and invite a repeat order.',
    variables: { '{{1}}': 'Customer name', '{{2}}': 'Order number', '{{3}}': 'Restaurant name' },
  },
  order_ready: {
    name: 'order_ready',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, your order #{{2}} is ready for pickup at {{3}}. See you soon!',
    explanation: 'Tells the customer their pickup order is ready.',
    useCase: 'Send when a pickup order is prepared, so the customer knows it is safe to come collect it.',
    variables: { '{{1}}': 'Customer name', '{{2}}': 'Order number', '{{3}}': 'Restaurant name' },
  },
  promo_offer: {
    name: 'promo_offer',
    category: 'MARKETING',
    language: 'en',
    body: 'Hi {{1}}, enjoy {{2}} off your next order at {{3}}! Use code {{4}} before {{5}}. Order now!',
    explanation: 'A promotional discount offer that drives a repeat order.',
    useCase: 'Send outside the customer-service window to promote a discount code. Marketing templates require Meta approval before they can be sent.',
    variables: { '{{1}}': 'Customer name', '{{2}}': 'Discount amount', '{{3}}': 'Restaurant name', '{{4}}': 'Promo code', '{{5}}': 'Offer expiry' },
  },
  feedback_request: {
    name: 'feedback_request',
    category: 'UTILITY',
    language: 'en',
    body: 'Hi {{1}}, thank you for your recent order from {{2}}. How was your experience? Reply with a rating from 1 to 5.',
    explanation: 'Collects a quick customer satisfaction rating after an order.',
    useCase: 'Send after a delivered order to gather a 1–5 rating for quality tracking and follow-up on low scores.',
    variables: { '{{1}}': 'Customer name', '{{2}}': 'Restaurant name' },
  },
};

(async () => {
  const updates = {};
  for (const [key, tpl] of Object.entries(templates)) {
    updates[`appTemplates/${key}`] = { ...tpl, updatedAt: admin.database.ServerValue.TIMESTAMP };
  }
  updates['appTemplates/whatsappTemplates'] = {
    name: 'WhatsApp message template library',
    description: 'Starter set of pre-approved-able WhatsApp message templates.',
    templates: whatsappTemplates,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  };
  await db.ref().update(updates);
  console.log('Seeded appTemplates:', Object.keys(templates).join(', ') + ' + whatsappTemplates');
  const snap = await db.ref('appTemplates').get();
  console.log('Verification readback keys:', Object.keys(snap.val() || {}).join(', '));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });