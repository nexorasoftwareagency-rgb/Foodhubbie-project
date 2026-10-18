// GA4 via Firebase Analytics — logs a page_view on every page that includes this.
// No-ops silently if Google Analytics is not enabled on the Firebase project.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4',
  authDomain: 'foodhubbie-10.firebaseapp.com',
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
  projectId: 'foodhubbie-10',
  storageBucket: 'foodhubbie-10.firebasestorage.app',
  messagingSenderId: '372428105696',
  appId: '1:372428105696:web:a3a979191a5cf94569ed85',
};

try {
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
  logEvent(analytics, 'page_view', { page_path: location.pathname, page_title: document.title });
} catch (e) {
  // GA not enabled on project yet — drop nothing, break nothing.
}
