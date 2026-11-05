# GitHub Actions Secrets Configuration

Configure these secrets in **GitHub Repository → Settings → Secrets and variables → Actions**:

## Required Secrets

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `FIREBASE_SERVICE_ACCOUNT` | Full Firebase service account JSON (for deploy) | Firebase Console → Project Settings → Service Accounts → Generate New Private Key |
| `FIREBASE_TOKEN` | Firebase CLI token (for database rules deploy) | Run `firebase login:ci` locally, copy token |
| `GITHUB_TOKEN` | Auto-provided by GitHub Actions | **Automatic** — no action needed |

## Firebase Service Account Setup

1. Go to [Firebase Console](https://console.firebase.google.com/project/foodhubbie-10/settings/serviceaccounts/adminsdk)
2. Click **Generate new private key**
2. Copy the entire JSON content
3. Add as `FIREBASE_SERVICE_ACCOUNT` secret in GitHub

## Firebase CLI Token Setup

```bash
# Run locally once
firebase login:ci

# Copy the output token (long string starting with "1//...")
# Add as FIREBASE_TOKEN secret in GitHub
```

## Required Permissions for Service Account

The service account needs these roles in Firebase:
- **Firebase Hosting Admin** (for hosting deploy)
- **Firebase Realtime Database Admin** (for database rules deploy)
- **Firebase Authentication Admin** (optional, for auth management)

## GitHub Environment

Create a **`production`** environment in GitHub:
1. Settings → Environments → New environment
2. Name: `production`
3. Add protection rules if needed (required reviewers, wait timer)

## Workflow Triggers

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci-cd.yml` | Push to `main` | Full CI → Test → Production Deploy |
| `ci-cd.yml` | Pull Request | CI → Test → Preview Deploy |
| `ci-cd.yml` | Manual (`workflow_dispatch`) | Manual trigger |

## Preview Deployments

Each PR gets a **7-day preview URL** like:
```
https://foodhubbie-10--pr-123.web.app
```

## Manual Deploy (Fallback)

If GitHub Actions fails, manual deploy still works:
```bash
# Admin
node tools/build.mjs && firebase deploy --only hosting:admin

# Database rules only
firebase deploy --only database

# Supreme Admin
node tools/build.mjs --supreme && firebase deploy --only hosting:supreme
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `FIREBASE_SERVICE_ACCOUNT` invalid | Regenerate key in Firebase Console, ensure no extra whitespace |
| `FIREBASE_TOKEN` expired | Run `firebase login:ci` again |
| Preview deploy fails | Check PR has access to secrets (private repo = OK, fork = needs secret pass-through) |
| Database rules not deploying | Ensure `FIREBASE_TOKEN` has Database Admin role |