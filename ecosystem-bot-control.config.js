module.exports = {
  apps: [
    {
      name: 'bot-control-api',
      script: 'server.js',
      cwd: './bot-control-api',
      watch: false,
      env: {
        NODE_ENV: 'production',
        BOT_CONTROL_PORT: '4000',
        FIREBASE_DATABASE_URL: 'https://foodhubbie-10-default-rtdb.firebaseio.com',
        GOOGLE_APPLICATION_CREDENTIALS: '/var/www/foodhubbie/bot/service-account.json',
        DASHBOARD_ORIGIN: 'https://foodhubbie-supremeadmin.web.app',
        ALERT_OFFLINE_MINUTES: '5',
        WABA_ID: '2589174454849821',
        WABA_NAME: 'Test WhatsApp Business Account',
        META_BUSINESS_ID: '1544720177433286'
        // ponytail: META_SYSTEM_USER_TOKEN / META_APP_ID / META_APP_SECRET are
        // injected on EC2 only (never in-repo) — see docs/META-PLATFORM-AUDIT.md.
      }
    }
  ]
};
