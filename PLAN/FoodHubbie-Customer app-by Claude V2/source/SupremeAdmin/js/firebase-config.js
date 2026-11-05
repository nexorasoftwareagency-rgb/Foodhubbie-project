/**
 * Fill in with the SAME Firebase project the main Admin panel and bot
 * fleet use — Supreme Admin reads/writes the same `businesses/{bid}/...`
 * tree and relies on the same `admins/{uid}/isSuper` custom claim.
 *
 * Get these values from Firebase Console → Project settings → General →
 * "Your apps" → SDK setup and configuration.
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4",
  authDomain: "foodhubbie-10.firebaseapp.com",
  databaseURL: "https://foodhubbie-10-default-rtdb.firebaseio.com",
  projectId: "foodhubbie-10",
  storageBucket: "foodhubbie-10.firebasestorage.app",
  messagingSenderId: "372428105696",
  appId: "1:372428105696:web:a3a979191a5cf94569ed85",
};

// Base URL of the Cloudflare Tunnel in front of the EC2 Bot Control API.
// The dashboard only ever talks to this — never directly to PM2 or the bot
// workers. NOTE: this is a Quick Tunnel URL (rotates on reboot; cron renews
// it server-side). Keep in sync with /var/www/foodhubbie/.last-tunnel-url.
let TUNNEL_URL = 'https://photos-whenever-specifics-internationally.trycloudflare.com';
window.TUNNEL_URL = TUNNEL_URL;

firebase.initializeApp(FIREBASE_CONFIG);

// Auto-update TUNNEL_URL from Firebase if EC2 cron has written a newer one.
//
// config/tunnelUrl is readable only by a signed-in admin (database.rules.json), so a
// read at boot — before login — ALWAYS failed and left the hardcoded (stale, rotated)
// Quick Tunnel host in place; every tunnel-backed panel then died with
// ERR_NAME_NOT_RESOLVED. Resolve on the first signed-in state instead and keep
// `window.TUNNEL_READY` pending until then, so features that fetch on first render
// await it rather than racing the fallback.
const resolveTunnelUrl = () => firebase.database().ref('config/tunnelUrl').once('value')
  .then((snap) => {
    const url = snap.val();
    if (url && typeof url === 'string' && url.startsWith('https://')) {
      TUNNEL_URL = url;
      window.TUNNEL_URL = url;
    }
    return TUNNEL_URL;
  })
  .catch(() => {
    console.warn('TUNNEL_URL: failed to read config/tunnelUrl, using fallback');
    return TUNNEL_URL;
  });

window.TUNNEL_READY = new Promise((resolve) => {
  const unsub = firebase.auth().onAuthStateChanged((user) => {
    if (!user) return;
    unsub();
    resolve(resolveTunnelUrl());
  });
});
