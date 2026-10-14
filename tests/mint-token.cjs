// Mint idToken via firebase-admin (bot/node_modules). Usage: node tests/mint-token.cjs <email|uid> [outPath]
// Writes { uid, email, customToken, idToken, refreshToken } to outPath (default temp mint.json)
const fs = require('fs');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'bot', 'node_modules', 'firebase-admin'));

const SA = require(path.join(__dirname, '..', 'bot', 'service-account.json'));
const target = process.argv[2] || 'roshanipizza@gmail.com';
const OUT = process.argv[3] || 'C:/Users/2nile/AppData/Local/Temp/opencode/mint.json';

admin.initializeApp({ credential: admin.credential.cert(SA) });

(async () => {
  let user;
  if (target.includes('@')) {
    try { user = await admin.auth().getUserByEmail(target); console.log('existing', user.uid); }
    catch (e) {
      if (e.code !== 'auth/user-not-found') { console.error(e.message); process.exit(1); }
      user = await admin.auth().createUser({ email: target, password: 'TempMint!2345' });
      console.log('created', user.uid);
    }
  } else {
    user = await admin.auth().getUser(target); console.log('existing', user.uid);
  }
  const customToken = await admin.auth().createCustomToken(user.uid);
  // Exchange custom token for idToken via the web API key
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const j = await res.json();
  if (!j.idToken) { console.error('exchange failed', JSON.stringify(j)); process.exit(1); }
  fs.writeFileSync(OUT, JSON.stringify({ uid: user.uid, email: user.email || target, customToken, idToken: j.idToken, refreshToken: j.refreshToken }));
  console.log('minted ok uid=' + user.uid);
})().catch(e => { console.error(e); process.exit(1); });
