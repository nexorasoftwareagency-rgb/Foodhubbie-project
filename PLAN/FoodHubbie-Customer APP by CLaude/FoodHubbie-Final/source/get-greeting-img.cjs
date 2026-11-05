const admin = require('firebase-admin');
const sa = require('./bot/service-account.json');
admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com' });
const db = admin.database();
(async () => {
  const out = {};
  const bot = await db.ref('businesses/roshani-pizza/outlets/pizza/settings/Bot').once('value').then(s => s.val()).catch(() => null);
  const store = await db.ref('businesses/roshani-pizza/outlets/pizza/settings/Store').once('value').then(s => s.val()).catch(() => null);
  out.greetingImage = bot?.greetingImage;
  out.bannerImage = store?.bannerImage;
  out.menuImage = bot?.menuImage;
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
