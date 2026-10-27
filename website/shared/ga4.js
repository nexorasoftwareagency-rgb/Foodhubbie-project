// GA4 via Firebase Analytics — logs a page_view on every page that includes this.
// No-ops silently if Google Analytics is not enabled on the Firebase project.
// ponytail: SDK init deferred to after window load so the Firebase chunk
// never blocks TBT on image-free pages — revisit if first-view events matter.
const firebaseConfig = {
  apiKey: 'AIzaSyCaVoTjl9_ZT8RECxUUxiBGSZE3G2jTdF4',
  authDomain: 'foodhubbie-10.firebaseapp.com',
  databaseURL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
  projectId: 'foodhubbie-10',
  storageBucket: 'foodhubbie-10.firebasestorage.app',
  messagingSenderId: '372428105696',
  appId: '1:372428105696:web:a3a979191a5cf94569ed85',
  measurementId: 'G-2RM3BXW1K1', // GA4 web stream "FoodHubbie Website" (foodhubbie.in)
};

window.addEventListener('load', async () => {
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
    const { getAnalytics, logEvent } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js');
    const app = initializeApp(firebaseConfig);
    const analytics = getAnalytics(app);
    logEvent(analytics, 'page_view', { page_path: location.pathname, page_title: document.title });
  } catch (e) {
    // GA not enabled on project yet — drop nothing, break nothing.
  }
});
