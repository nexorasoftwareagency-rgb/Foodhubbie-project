# Blaze Plan Upgrades — Staff Management & Beyond

Items that require Blaze (paid) plan — Cloud Functions, Admin SDK, increased quotas.

---

## 🔴 P0: Staff Management — Token Revocation on Disable

**Current (Spark):** Rules block `isActive: false` reads at DB level, but auth token valid until expiry (~1hr).

**Blaze Fix:** Cloud Function to revoke refresh tokens immediately.

```typescript
// functions/src/staff-disable.ts
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

export const onStaffDisable = functions.database
  .ref('/businesses/{bid}/outlets/{oid}/staff/{uid}/isActive')
  .onUpdate(async (change, context) => {
    const before = change.before.val();
    const after = change.after.val();
    if (before === true && after === false) {
      const { uid } = context.params;
      try {
        await admin.auth().revokeRefreshTokens(uid);
        console.log(`Revoked tokens for disabled staff ${uid}`);
      } catch (e) {
        console.error(`Token revocation failed for ${uid}:`, e);
      }
    }
  });
```

**Deploy:** `firebase deploy --only functions:onStaffDisable`

---

## 🔴 P0: Custom Claims for Role-Based Access

**Current:** Role checked in client + rules via `admins/{uid}.role`.

**Blaze Fix:** Set custom claims on auth user → rules use `auth.token.role === 'owner'` (faster, no DB read).

```typescript
// functions/src/auth-triggers.ts
export const onStaffCreate = functions.auth.user().onCreate(async (user) => {
  // Check if user exists in any outlet's admins node
  const adminsSnap = await admin.database().ref('admins').orderByChild('email').equalTo(user.email).once('value');
  if (adminsSnap.exists()) {
    const adminData = Object.values(adminsSnap.val())[0];
    await admin.auth().setCustomUserClaims(user.uid, {
      role: adminData.role,
      outlet: adminData.outlet,
      businessId: adminData.businessId
    });
  }
});

export const onStaffUpdate = functions.database
  .ref('/admins/{uid}')
  .onUpdate(async (change, context) => {
    const after = change.after.val();
    await admin.auth().setCustomUserClaims(context.params.uid, {
      role: after.role,
      outlet: after.outlet,
      businessId: after.businessId
    });
  });
```

**Rules Simplification:**
```json
"staff": {
  "$staffUid": {
    ".read": "auth != null && (auth.token.role == 'owner' || auth.token.role == 'manager') && auth.token.outlet == $outletId"
  }
}
```

---

## 🟡 P1: Scheduled Log Pruning (Server-Side)

**Current:** Client-side pruning in `Admin/js/log-prune.js` (runs once/day per browser).

**Blaze Fix:** Cloud Scheduler + Function runs nightly, independent of admin login.

```typescript
// functions/src/prune-logs.ts
export const nightlyLogPrune = functions.pubsub
  .schedule('0 3 * * *') // 3 AM daily
  .timeZone('Asia/Kolkata')
  .onRun(async () => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const cutoffKey = pushKeyFor(cutoff); // Same encoder as client
    const ref = admin.database().ref('logs/audit').orderByKey().endAt(cutoffKey);
    const snap = await ref.once('value');
    const updates = {};
    snap.forEach(child => { updates[child.key] = null; });
    await admin.database().ref().update(updates);
    console.log(`Pruned ${Object.keys(updates).length} audit logs`);
  });
```

---

## 🟡 P1: Image Storage (Firebase Storage)

**Current:** Base64 images in RTDB (limited, counts against Spark quota).

**Blaze Fix:** Firebase Storage bucket + signed URLs.

```typescript
// functions/src/upload-image.ts
export const uploadImage = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
  const { base64, path } = data;
  const buffer = Buffer.from(base64, 'base64');
  const file = admin.storage().bucket().file(path);
  await file.save(buffer, { metadata: { contentType: 'image/jpeg' } });
  const [url] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });
  return { url };
});
```

**Client:** `menu/js/app.js` → call function instead of base64 upload.

---

## 🟡 P1: App Check Enforcement

**Current:** Skipped (P3-8 #3) — DB-wide enforcement adds reCAPTCHA weight.

**Blaze Fix:** App Check with custom provider or reCAPTCHA Enterprise (10k free calls/mo on Blaze).

```typescript
// functions/src/app-check.ts
import { initializeAppCheck } from 'firebase-admin/app-check';

initializeAppCheck({
  provider: new ReCaptchaEnterpriseProvider('YOUR_SITE_KEY'),
  isTokenAutoRefreshEnabled: true
});
```

---

## 🟢 P2: Email Verification on Staff Create

**Current:** Password reset email sent, but email not verified.

**Blaze Fix:** `sendEmailVerification()` via Admin SDK after user creation.

```typescript
await admin.auth().updateUser(uid, { emailVerified: false });
await admin.auth().generateEmailVerificationLink(email);
// Send via custom email template (SendGrid, etc.)
```

---

## 🟢 P2: Multi-Factor Authentication (MFA) for Owners

**Blaze Fix:** Enroll TOTP or SMS MFA for owner accounts.

```typescript
await admin.auth().updateUser(uid, { multiFactor: { enrolledFactors: [] } });
// User enrolls via client SDK
```

---

## 🟢 P2: Scheduled Backups (RTDB)

**Blaze Fix:** `gcloud firestore export` or RTDB backup to GCS bucket nightly.

```bash
gcloud firestore export gs://my-backup-bucket/$(date +%Y%m%d)
```

---

## 📋 Migration Checklist (Spark → Blaze)

| Step | Command | Notes |
|------|---------|-------|
| 1 | Upgrade project to Blaze in Firebase Console | Billing account required |
| 2 | `firebase init functions` | TypeScript, ESLint |
| 3 | Add functions above | `functions/src/*.ts` |
| 4 | `npm install firebase-admin firebase-functions` | In `functions/` |
| 5 | `firebase deploy --only functions` | Deploy all |
| 6 | Update rules to use `auth.token.*` | Remove DB reads for role |
| 7 | Enable App Check in Console | ReCAPTCHA Enterprise |
| 8 | Enable Cloud Scheduler API | For nightly prune |
| 9 | Test token revocation flow | Disable staff → verify instant lockout |
| 10 | Migrate images to Storage | Update `menu/js/app.js` upload |

---

## 💰 Estimated Blaze Costs (Monthly, INR)

| Service | Usage | Est. Cost |
|---------|-------|-----------|
| Cloud Functions (invocation) | ~50k/mo | Free tier (2M) |
| Cloud Functions (CPU/memory) | Light | ~₹50 |
| Cloud Scheduler | 1 job/day | Free tier (3/mo) |
| Firebase Storage | ~10 GB | ~₹150 |
| App Check (reCAPTCHA Enterprise) | 10k calls | Free tier (10k/mo) |
| RTDB Backup (GCS) | ~1 GB/mo | ~₹20 |
| **Total** | | **~₹220/mo** |

---

## 📝 Notes

- All Spark-compatible fixes already deployed (rules + client)
- Blaze upgrades are **additive** — no breaking changes to current flow
- Priority order: Token revocation → Custom claims → Scheduled prune → Storage → App Check