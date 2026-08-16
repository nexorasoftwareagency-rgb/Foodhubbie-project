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
const TUNNEL_URL = 'https://photos-whenever-specifics-internationally.trycloudflare.com';

firebase.initializeApp(FIREBASE_CONFIG);
