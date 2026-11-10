# Deployment Guide - Firebase Functions 2nd Gen

## Prerequisites

### Accounts & Permissions
- [ ] Firebase Project on Blaze plan
- [ ] Google Cloud Project linked
- [ ] Billing account configured
- [ ] Owner/Editor role on GCP project
- [ ] Firebase Admin SDK access

### Local Development Setup
```bash
# Required tools
node --version        # v20.x
npm --version         # v10.x
firebase --version    # v13.x (Firebase CLI)
gcloud --version      # Latest

# Authenticate
firebase login
firebase use --add    # Select project
gcloud auth application-default login
```

---

## Project Structure

```
foodhubbie-functions/
├── .firebaserc
├── firebase.json
├── functions/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .eslintrc.js
│   ├── .prettierrc
│   ├── jest.config.js
│   ├── src/
│   │   ├── index.ts                 # Main exports
│   │   ├── api/
│   │   │   ├── whatsappWebhook.ts
│   │   │   ├── paymentWebhook.ts
│   │   │   ├── botControl.ts
│   │   │   ├── onboardingApprove.ts
│   │   │   ├── transportSwitch.ts
│   │   │   ├── passwordReset.ts
│   │   │   ├── walletGatePublish.ts
│   │   │   ├── sendAppNotification.ts
│   │   │   ├── getWhatsAppQuota.ts
│   │   │   ├── qrMenuOrder.ts
│   │   │   └── qrMenuPayment.ts
│   │   ├── scheduled/
│   │   │   ├── walletGateCheck.ts
│   │   │   ├── metaCostPublisher.ts
│   │   │   ├── reports.ts
│   │   │   ├── promoScheduler.ts
│   │   │   ├── notificationCapReset.ts
│   │   │   └── metaCostReconciliation.ts
│   │   ├── taskqueue/
│   │   │   ├── processInboundMessage.ts
│   │   │   ├── sendOutboundMessage.ts
│   │   │   ├── runPromoCampaign.ts
│   │   │   ├── verifyPayment.ts
│   │   │   └── processRedeem.ts
│   │   ├── triggers/
│   │   │   ├── onOrderStatusChange.ts
│   │   │   ├── onOrderPaymentChange.ts
│   │   │   ├── onWalletUpdate.ts
│   │   │   ├── onPromoCampaignCreate.ts
│   │   │   ├── onCustomerCreate.ts
│   │   │   └── onRiderAssign.ts
│   │   ├── auth/
│   │   │   ├── onUserCreate.ts
│   │   │   └── onUserDelete.ts
│   │   └── shared/
│   │       ├── config/
│   │       ├── firebase/
│   │       ├── whatsapp/
│   │       ├── orders/
│   │       ├── loyalty/
│   │       ├── wallet/
│   │       ├── notifications/
│   │       ├── utils/
│   │       └── types/
│   ├── test/
│   │   ├── unit/
│   │   ├── integration/
│   │   └── load/
│   └── .env.local          # Local secrets (gitignored)
├── scripts/
│   ├── deploy.sh
│   ├── deploy-staging.sh
│   ├── deploy-prod.sh
│   ├── secrets-setup.sh
│   └── cost-check.sh
└── docs/
    └── ARCHITECTURE.md
```

---

## Configuration Files

### functions/package.json
```json
{
  "name": "foodhubbie-functions",
  "version": "1.0.0",
  "description": "Foodhubbie Firebase Functions 2nd Gen",
  "main": "lib/index.js",
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc -w",
    "lint": "eslint src --ext .ts",
    "lint:fix": "eslint src --ext .ts --fix",
    "test": "jest --coverage",
    "test:watch": "jest --watch",
    "test:ci": "jest --ci --coverage --maxWorkers=2",
    "deploy": "firebase deploy --only functions",
    "deploy:staging": "firebase deploy --only functions --project foodhubbie-staging",
    "deploy:prod": "firebase deploy --only functions --project foodhubbie-prod",
    "logs": "firebase functions:log --project foodhubbie-prod",
    "logs:staging": "firebase functions:log --project foodhubbie-staging",
    "emulator": "firebase emulators:start --only functions,firestore,database",
    "emulator:functions": "firebase emulators:start --only functions",
    "cost:check": "node scripts/cost-check.js"
  },
  "engines": {
    "node": "20"
  },
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^6.0.0",
    "@google-cloud/tasks": "^5.0.0",
    "@google-cloud/monitoring": "^5.0.0",
    "@google-cloud/secret-manager": "^5.0.0",
    "axios": "^1.6.0",
    "crypto": "^1.0.1",
    "uuid": "^9.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.10.0",
    "@types/jest": "^29.5.0",
    "@types/uuid": "^9.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.19.0",
    "@typescript-eslint/parser": "^6.19.0",
    "prettier": "^3.2.0",
    "firebase-functions-test": "^3.2.0"
  }
}
```

### functions/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./lib",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "lib", "test", "**/*.test.ts"]
}
```

### firebase.json
```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": [
        "node_modules",
        ".git",
        "firebase-debug.log",
        "firebase-debug.*.log",
        "*.local.ts",
        "test",
        "scripts"
      ],
      "predeploy": [
        "npm --prefix functions run build",
        "npm --prefix functions run lint"
      ],
      "postdeploy": [
        "npm --prefix functions run deploy:verify"
      ]
    }
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "database": {
    "rules": "database.rules.json"
  },
  "hosting": [
    {
      "target": "admin",
      "public": "Admin/dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [{"source": "**", "destination": "/index.html"}]
    },
    {
      "target": "supreme",
      "public": "SupremeAdmin/dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [{"source": "**", "destination": "/index.html"}]
    },
    {
      "target": "menu",
      "public": "menu/dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [{"source": "**", "destination": "/index.html"}]
    },
    {
      "target": "rider",
      "public": "rider-app/dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [{"source": "**", "destination": "/index.html"}]
    },
    {
      "target": "website",
      "public": "website/dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [{"source": "**", "destination": "/index.html"}]
    }
  ],
  "emulators": {
    "functions": { "port": 5001 },
    "firestore": { "port": 8080 },
    "database": { "port": 9000 },
    "hosting": { "port": 5000 },
    "ui": { "enabled: true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

### .firebaserc
```json
{
  "projects": {
    "default": "foodhubbie-prod",
    "staging": "foodhubbie-staging"
  },
  "targets": {
    "foodhubbie-prod": {
      "hosting": {
        "admin": ["admin"],
        "supreme": ["supreme"],
        "menu": ["menu"],
        "rider": ["rider"],
        "website": ["website"]
      }
    },
    "foodhubbie-staging": {
      "hosting": {
        "admin": ["admin-staging"],
        "supreme": ["supreme-staging"],
        "menu": ["menu-staging"],
        "rider": ["rider-staging"],
        "website": ["website-staging"]
      }
    }
  }
}
```

---

## Secrets Management

### Required Secrets (Secret Manager)

| Secret Name | Description | Rotation |
|-------------|-------------|----------|
| `META_VERIFY_TOKEN` | Meta webhook verification token | Annual |
| `META_SYSTEM_USER_TOKEN` | Meta Graph API system user token | 60 days |
| `WA_PERMANENT_TOKEN` | WhatsApp permanent token (fallback) | Per outlet |
| `FIREBASE_DATABASE_URL` | RTDB URL | Never |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay signature verification | Annual |
| `PHONEPE_WEBHOOK_SECRET` | PhonePe signature verification | Annual |
| `SLACK_ALERT_WEBHOOK` | Slack alerting webhook | As needed |
| `SENDGRID_API_KEY` | Email alerts | As needed |
| `VAPID_PUBLIC_KEY` | FCM VAPID public key | Annual |
| `VAPID_PRIVATE_KEY` | FCM VAPID private key | Annual |

### Setup Secrets
```bash
# scripts/secrets-setup.sh
#!/bin/bash
set -e

PROJECT_ID="foodhubbie-prod"

# Create secrets (first time only)
echo "Creating secrets in Secret Manager..."

# Meta
echo "META_VERIFY_TOKEN: "; read -s TOKEN; echo -n "$TOKEN" | gcloud secrets create META_VERIFY_TOKEN --data-file=- --project=$PROJECT_ID
echo "META_SYSTEM_USER_TOKEN: "; read -s TOKEN; echo -n "$TOKEN" | gcloud secrets create META_SYSTEM_USER_TOKEN --data-file=- --project=$PROJECT_ID

# Firebase
echo "FIREBASE_DATABASE_URL: "; read URL; echo -n "$URL" | gcloud secrets create FIREBASE_DATABASE_URL --data-file=- --project=$PROJECT_ID

# Payment
echo "RAZORPAY_WEBHOOK_SECRET: "; read -s TOKEN; echo -n "$TOKEN" | gcloud secrets create RAZORPAY_WEBHOOK_SECRET --data-file=- --project=$PROJECT_ID
echo "PHONEPE_WEBHOOK_SECRET: "; read -s TOKEN; echo -n "$TOKEN" | gcloud secrets create PHONEPE_WEBHOOK_SECRET --data-file=- --project=$PROJECT_ID

# Alerting
echo "SLACK_ALERT_WEBHOOK: "; read URL; echo -n "$URL" | gcloud secrets create SLACK_ALERT_WEBHOOK --data-file=- --project=$PROJECT_ID

# Grant access to Cloud Functions service account
SERVICE_ACCOUNT="foodhubbie-functions@foodhubbie-prod.iam.gserviceaccount.com"

for secret in META_VERIFY_TOKEN META_SYSTEM_USER_TOKEN FIREBASE_DATABASE_URL RAZORPAY_WEBHOOK_SECRET PHONEPE_WEBHOOK_SECRET SLACK_ALERT_WEBHOOK; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT_ID
done

echo "Secrets configured!"
```

### Access in Functions
```typescript
// functions/src/shared/config/secrets.ts
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();
const PROJECT_ID = process.env.GCP_PROJECT || 'foodhubbie-prod';

const secretCache = new Map<string, { value: string; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getSecret(name: string): Promise<string> {
  const cached = secretCache.get(name);
  if (cached && cached.expiry > Date.now()) {
    return cached.value;
  }
  
  const [version] = await client.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
  });
  
  const value = version.payload?.data?.toString() || '';
  secretCache.set(name, { value, expiry: Date.now() + CACHE_TTL });
  return value;
}

// Usage
const META_VERIFY_TOKEN = await getSecret('META_VERIFY_TOKEN');
const META_SYSTEM_USER_TOKEN = await getSecret('META_SYSTEM_USER_TOKEN');
```

---

## Deployment Scripts

### scripts/deploy-staging.sh
```bash
#!/bin/bash
# scripts/deploy-staging.sh
set -e

echo "🚀 Deploying to STAGING..."

# 1. Run tests
echo "📋 Running tests..."
cd functions
npm run test:ci
cd ..

# 2. Build
echo "🔨 Building..."
cd functions
npm run build
cd ..

# 3. Deploy Functions
echo "☁️ Deploying Functions..."
firebase deploy --only functions --project foodhubbie-staging

# 4. Verify deployment
echo "✅ Verifying deployment..."
sleep 10
firebase functions:log --project foodhubbie-staging --limit 20

echo "🎉 Staging deployment complete!"
```

### scripts/deploy-prod.sh
```bash
#!/bin/bash
# scripts/deploy-prod.sh
set -e

echo "🚀 Deploying to PRODUCTION..."
echo "⚠️  This will deploy to PRODUCTION. Continue? (y/N)"
read -r confirm
if [[ ! $confirm =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# 1. Run full test suite
echo "📋 Running full test suite..."
cd functions
npm run test:ci
cd ..

# 2. Build
echo "🔨 Building..."
cd functions
npm run build
cd ..

# 3. Deploy Functions
echo "☁️ Deploying Functions..."
firebase deploy --only functions --project foodhubbie-prod

# 4. Verify deployment
echo "✅ Verifying deployment..."
sleep 15
firebase functions:log --project foodhubbie-prod --limit 50

# 5. Health check
echo "🏥 Running health checks..."
./scripts/health-check.sh

echo "🎉 Production deployment complete!"
```

### scripts/health-check.sh
```bash
#!/bin/bash
# scripts/health-check.sh

PROJECT="foodhubbie-prod"
REGION="us-central1"

echo "Checking critical functions..."

# Webhook
WEBHOOK_URL="https://${REGION}-${PROJECT}.cloudfunctions.net/whatsappWebhook"
echo -n "Webhook: "
curl -s -o /dev/null -w "%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"object":"test"}' || echo "FAIL"

# Bot Control
echo -n "Bot Control: "
firebase functions:call botControl --data='{"action":"statusAll"}' --project $PROJECT 2>/dev/null | head -5

# Scheduled functions (check logs)
echo "Recent scheduled function runs:"
firebase functions:log --project $PROJECT --filter="scheduled" --limit 10
```

---

## CI/CD Pipeline (GitHub Actions)

### .github/workflows/firebase-functions.yml
```yaml
name: Firebase Functions CI/CD

on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        default: 'staging'
        type: choice
        options: [staging, production]

env:
  NODE_VERSION: '20'
  FIREBASE_PROJECT_STAGING: foodhubbie-staging
  FIREBASE_PROJECT_PROD: foodhubbie-prod

jobs:
  lint-and-test:
    name: Lint & Test
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
          cache-dependency-path: functions/package-lock.json
      
      - name: Install Dependencies
        run: cd functions && npm ci
      
      - name: Lint
        run: cd functions && npm run lint
      
      - name: Type Check
        run: cd functions && npx tsc --noEmit
      
      - name: Unit Tests
        run: cd functions && npm run test:ci
      
      - name: Build
        run: cd functions && npm run build
      
      - name: Upload Build Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: functions-build
          path: functions/lib/
          retention-days: 7

  deploy-staging:
    name: Deploy Staging
    needs: lint-and-test
    if: github.ref == 'refs/heads/staging' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'staging')
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Download Build Artifacts
        uses: actions/download-artifact@v4
        with:
          name: functions-build
          path: functions/lib/
      
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY_STAGING }}
      
      - name: Deploy Functions
        run: |
          npx firebase deploy --only functions --project ${{ env.FIREBASE_PROJECT_STAGING }} --token ${{ secrets.FIREBASE_TOKEN }}
      
      - name: Verify Deployment
        run: |
          sleep 15
          npx firebase functions:log --project ${{ env.FIREBASE_PROJECT_STAGING }} --limit 20 --token ${{ secrets.FIREBASE_TOKEN }}

  deploy-production:
    name: Deploy Production
    needs: lint-and-test
    if: github.ref == 'refs/heads/main' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'production')
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Download Build Artifacts
        uses: actions/download-artifact@v4
        with:
          name: functions-build
          path: functions/lib/
      
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY_PROD }}
      
      - name: Deploy Functions
        run: |
          npx firebase deploy --only functions --project ${{ env.FIREBASE_PROJECT_PROD }} --token ${{ secrets.FIREBASE_TOKEN }}
      
      - name: Verify Deployment
        run: |
          sleep 30
          npx firebase functions:log --project ${{ env.FIREBASE_PROJECT_PROD }} --limit 50 --token ${{ secrets.FIREBASE_TOKEN }}
      
      - name: Health Check
        run: |
          ./scripts/health-check.sh
      
      - name: Notify Success
        if: success()
        uses: slackapi/slack-github-action@v1.23.0
        with:
          payload: |
            {
              "text": "✅ Production deployment successful",
              "blocks": [
                {"type": "section", "text": {"type": "mrkdwn", "text": "✅ *Production deployment successful*\nFunctions deployed to foodhubbie-prod"}}
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_DEPLOY_WEBHOOK }}
      
      - name: Notify Failure
        if: failure()
        uses: slackapi/slack-github-action@v1.23.0
        with:
          payload: |
            {
              "text": "❌ Production deployment FAILED",
              "blocks": [
                {"type": "section", "text": {"type": "mrkdwn", "text": "❌ *Production deployment FAILED*\nCheck GitHub Actions for details"}}
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_DEPLOY_WEBHOOK }}
```

---

## Environment-Specific Configuration

### Staging Environment
```bash
# functions/.env.staging (for local emulator)
NODE_ENV=staging
LOG_LEVEL=debug
META_VERIFY_TOKEN=staging_verify_token
META_SYSTEM_USER_TOKEN=staging_system_token
FIREBASE_DATABASE_URL=https://foodhubbie-staging-default-rtdb.firebaseio.com
RAZORPAY_WEBHOOK_SECRET=staging_razorpay_secret
PHONEPE_WEBHOOK_SECRET=staging_phonepe_secret
SLACK_ALERT_WEBHOOK=https://hooks.slack.com/services/STAGING/WEBHOOK
```

### Production Environment
```bash
# functions/.env.production (NOT committed - use Secret Manager)
NODE_ENV=production
LOG_LEVEL=info
# All secrets from Secret Manager
```

---

## Local Development with Emulator

### Start Emulator
```bash
# Terminal 1: Start emulators
cd functions
npm run emulator

# Terminal 2: Run functions in watch mode
cd functions
npm run build:watch

# Terminal 3: Run tests
cd functions
npm run test:watch
```

### Test Webhook Locally
```bash
# Use ngrok for public URL
ngrok http 5001

# Update Meta webhook URL to ngrok URL
# Test with curl
curl -X POST http://localhost:5001/foodhubbie-staging/us-central1/whatsappWebhook \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"object":"whatsapp_business_account","entry":[...]}'
```

### Debug in VS Code
```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Functions",
      "type": "node",
      "request": "attach",
      "port": 9229,
      "localRoot": "${workspaceFolder}/functions/lib",
      "remoteRoot": "/user_code",
      "protocol": "inspector",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

---

## Post-Deployment Verification

### Automated Checks
```bash
# scripts/verify-deployment.sh
#!/bin/bash

PROJECT=$1  # foodhubbie-staging or foodhubbie-prod
REGION="us-central1"

echo "🔍 Verifying deployment for $PROJECT..."

# 1. Check all functions deployed
echo "📋 Checking function list..."
firebase functions:list --project $PROJECT

# 2. Check webhook health
WEBHOOK="https://${REGION}-${PROJECT}.cloudfunctions.net/whatsappWebhook"
echo "🏥 Checking webhook..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$WEBHOOK" \
  -H "Content-Type: application/json" \
  -d '{"object":"health_check"}')
if [ "$RESPONSE" != "200" ]; then
  echo "❌ Webhook health check failed: $RESPONSE"
  exit 1
fi
echo "✅ Webhook OK"

# 3. Check scheduled functions (recent logs)
echo "📅 Checking scheduled functions..."
firebase functions:log --project $PROJECT --filter="scheduled" --limit 5

# 4. Check task queues
echo "⚙️ Checking Cloud Tasks queues..."
gcloud tasks queues list --project=$PROJECT --location=$REGION

# 5. Check Secret Manager access
echo "🔐 Checking secret access..."
for secret in META_VERIFY_TOKEN META_SYSTEM_USER_TOKEN FIREBASE_DATABASE_URL; do
  gcloud secrets versions access latest --secret=$secret --project=$PROJECT >/dev/null && echo "✅ $secret" || echo "❌ $secret"
done

echo "🎉 All verification checks passed!"
```

---

## Rollback Procedure

### Quick Rollback (Functions Only)
```bash
# List recent versions
firebase functions:list --project foodhubbie-prod --versions

# Rollback to previous version
firebase functions:rollback <function_name> --project foodhubbie-prod

# Or rollback all
firebase deploy --only functions --project foodhubbie-prod --version=<previous_version>
```

### Full Rollback (Including Traffic)
```bash
# 1. Revert Cloudflare Worker to 0% Functions
# 2. Restart EC2 processes
ssh ubuntu@ec2-foodhubbie "pm2 restart ecosystem.config.js --env production"

# 3. Verify EC2 health
curl https://api.foodhubbie.in/health

# 4. Notify team
curl -X POST $SLACK_ALERT_WEBHOOK -d '{"text":"🔄 ROLLBACK: Traffic reverted to EC2"}'
```

---

## Monitoring & Alerting Setup

### Cloud Monitoring Dashboards
```bash
# Create dashboard via gcloud or Console
# Key charts:
# 1. Function invocations / sec
# 2. Function latency (p50, p95, p99)
# 3. Function error rate
# 4. Task queue depth
# 5. Task queue processing time
# 6. Scheduled function success rate
# 7. Cold start rate
# 8. Memory/CPU utilization
# 9. Egress bytes
# 10. Cost per day
```

### Alert Policies
```yaml
# Save as alert-policies.yaml and apply with gcloud
# gcloud monitoring policies create --policy-from-file=alert-policies.yaml

- displayName: "Functions Error Rate High"
  conditions:
    - displayName: "Error rate > 1%"
      conditionThreshold:
        filter: 'metric.type="cloudfunctions.googleapis.com/function/executions" resource.type="cloud_function" metric.label.status="error"'
        comparison: COMPARISON_GT
        thresholdValue: 0.01
        duration: 300s

- displayName: "Webhook Latency High"
  conditions:
    - displayName: "p99 > 500ms"
      conditionThreshold:
        filter: 'metric.type="cloudfunctions.googleapis.com/function/execution_times" resource.type="cloud_function" resource.label.function_name="whatsappWebhook"'
        comparison: COMPARISON_GT
        thresholdValue: 500
        duration: 300s

- displayName: "Task Queue Backlog"
  conditions:
    - displayName: "Queue depth > 1000"
      conditionThreshold:
        filter: 'metric.type="cloudtasks.googleapis.com/queue/depth" resource.type="cloud_tasks_queue"'
        comparison: COMPARISON_GT
        thresholdValue: 1000
        duration: 300s

- displayName: "Functions Daily Cost > $5"
  conditions:
    - displayName: "Cost > $5/day"
      conditionThreshold:
        filter: 'metric.type="billing.googleapis.com/estimated_charges" resource.type="project"'
        comparison: COMPARISON_GT
        thresholdValue: 5
        duration: 86400s
```

---

## Troubleshooting Common Issues

### Issue: Function Timeout
```
Error: Function timed out after 60s
```
**Fix:** Increase `timeoutSeconds` in function config, optimize code, or use Task Queue for long operations.

### Issue: Cold Start Latency
```
High latency on first request after idle
```
**Fix:** Increase `minInstances`, reduce bundle size, use lazy imports.

### Issue: Secret Access Denied
```
Permission denied accessing secret
```
**Fix:** Grant `roles/secretmanager.secretAccessor` to Cloud Functions service account.

### Issue: RTDB Permission Denied
```
Permission denied writing to RTDB
```
**Fix:** Check database.rules.json, ensure service account has access.

### Issue: Task Queue Not Processing
```
Tasks stuck in queue
```
**Fix:** Check worker function logs, increase `maxInstances`, check rate limits.

---

## Maintenance Windows

| Activity | Frequency | Window | Owner |
|----------|-----------|--------|-------|
| Secret Rotation (Meta) | 60 days | Sunday 2 AM IST | DevOps |
| Dependency Updates | Monthly | Sunday 3 AM IST | DevOps |
| Log Retention Cleanup | Monthly | Auto | DevOps |
| Cost Review | Monthly | 1st Monday | Engineering + Finance |
| Performance Review | Quarterly | Sprint planning | Engineering |
| DR Drill | Semi-annually | Scheduled | All |

---

## Support Contacts

| Role | Name | Contact | Escalation |
|------|------|---------|------------|
| Platform Lead | — | — | Level 1 |
| DevOps Engineer | — | — | Level 2 |
| Backend Tech Lead | — | — | Level 3 |
| Engineering Manager | — | — | Level 4 |
| Firebase Support | Google Cloud | Support Case | Vendor |
| Meta Business Support | Meta | Business Manager | Vendor |