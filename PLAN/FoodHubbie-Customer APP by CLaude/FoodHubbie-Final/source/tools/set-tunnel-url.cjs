// Write config/tunnelUrl to RTDB using the admin SDK.
const admin = require('firebase-admin');
const path = require('path');
const certPath = path.join(__dirname, '..', 'Credentials', 'foodhubbie-10-firebase-adminsdk-fbsvc-9eab454d6a.json');
admin.initializeApp({
  credential: admin.credential.cert(require(certPath)),
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com'
});
const url = process.argv[2];
if (!url || !url.startsWith('https://')) { console.error('usage: node set-tunnel-url.cjs https://...'); process.exit(1); }
admin.database().ref('config/tunnelUrl').set(url).then(() => {
  console.log('config/tunnelUrl =', url);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
