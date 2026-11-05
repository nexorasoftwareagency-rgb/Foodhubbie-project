// Sync trycloudflare URL to RTDB config/tunnelUrl (EC2 variant of
// tools/set-tunnel-url.cjs — uses the service-account the bot already has
// on the box instead of repo Credentials/).
const admin = require('/var/www/foodhubbie/bot/node_modules/firebase-admin');
const saPath = '/var/www/foodhubbie/bot/service-account.json';
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(saPath)),
    databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
  });
}
const url = process.argv[2];
if (!url || !url.startsWith('https://')) { console.error('usage: node sync-tunnel-url-ec2.cjs https://...'); process.exit(1); }
admin.database().ref('config/tunnelUrl').set(url).then(() => {
  console.log('config/tunnelUrl =', url);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
