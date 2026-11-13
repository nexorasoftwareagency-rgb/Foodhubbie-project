/**
 * Onboarding + credential route group (batch 23d-3) — the third control-API
 * surface to leave EC2.
 *
 *   GET  /api/admin/outlet-admin-status   (D2 email-verified unlock gate)
 *   POST /api/admin/approve-onboarding    (create the tenant from a signup)
 *   POST /api/admin/update-password       (Supreme's admin-login card / wizard)
 *
 * All three are pure cloud operations: verified Supreme ID token, Auth admin,
 * RTDB writes. No pm2, no socket, no WhatsApp.
 *
 * Contract is byte-compatible with `bot-control-api/server.js` at HEAD —
 * same status codes, same error strings, same `approveOnboardingRequest`
 * sequence (authUid adoption, duplicate-email refusal, retry id reuse, outlet
 * counter, template defaults, menuBank mirror, `locked: true`, walletBilling
 * defaults at the ROOT, email-only adminLogin, secret burn). The 2026-11-07
 * credential hardening is what is ported here; the older unused
 * `onboardingApprove` prototype function is deliberately NOT this code.
 *
 * Wiring: `config/adminUrl` points the Supreme dashboard here. Call sites fall
 * back to `config/tunnelUrl` when it is absent, so deleting this function
 * changes nothing.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import path from 'path';
import { initializeAdmin, getAuth, getDB, serverTimestamp } from '../shared/firebase/admin';
import {
  HttpError,
  readJsonBody,
  requireSuperRole,
  routeOf,
  supremeFromToken,
} from '../shared/http/tenant';

// CJS shared module, vendored byte-for-byte by scripts/copy-vendor.cjs.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getBillingDefaults } = require(path.join(__dirname, '../vendor/shared/billing-defaults.cjs'));

const MAX_BODY_BYTES = 100 * 1024;

const DASHBOARD_ORIGINS: Array<string | RegExp> = [
  'https://foodhubbie-admins.web.app',
  'https://foodhubbie-supremeadmin.web.app',
  'https://app.foodhubbie.in',
  'https://control.foodhubbie.in',
  'https://rider.foodhubbie.in',
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

// ---- D2: email-verification state of a restaurant's owner account ----------
async function outletAdminStatus(bid: string, oid: string): Promise<any> {
  const db = getDB();
  const snap = await db.ref(`businesses/${bid}/outlets/${oid}/adminLogin/email`).get();
  const email = snap.val() || null;
  if (!email) return { email: null, emailVerified: null };
  let user: any = null;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch (err: any) {
    if (err.code !== 'auth/user-not-found') throw err;
  }
  if (!user) return { email, emailVerified: false, missing: true };
  return {
    email,
    emailVerified: user.emailVerified === true,
    uid: user.uid,
    disabled: user.disabled === true,
  };
}

// ---- approval core (both the manual endpoint and, later, auto-approval) ----
// Port of `approveOnboardingRequest` from bot-control-api/server.js. Creates the
// Auth owner mirror, the outlet (locked), walletBilling defaults and the
// outletIndex entry; throws HttpError for expected refusals.
export async function approveOnboardingRequest(
  reqKey: string,
  f: any,
  reviewerUid: string | null,
): Promise<{ bid: string; oid: string; uid: string; email: string }> {
  const db = getDB();
  const {
    businessName, outletName, contactPhone, contactEmail, adminEmail,
    adminName, plan, template, whatsappConnect,
  } = f;

  const reqSnap = await db.ref(`onboardingRequests/${reqKey}`).get();
  const reqData = reqSnap.val();
  if (!reqData) throw new HttpError(404, 'Onboarding request not found');
  if (reqData.status !== 'pending') throw new HttpError(409, `Request already ${reqData.status}`);

  // New requests carry `authUid`: the applicant's browser created the Firebase
  // Auth user at signup, so no password ever exists in this process. Legacy
  // requests (pre-cutover) still carry a password to replay — one release only.
  const authUid = typeof reqData.authUid === 'string' && reqData.authUid ? reqData.authUid : null;
  let uid: string | null = null;
  let legacyPassword: string | null = null;

  if (authUid) {
    if (String(adminEmail || '').toLowerCase() !== String(reqData.adminEmail || '').toLowerCase()) {
      throw new HttpError(422, 'The admin email cannot be changed after the signup account was created.');
    }
    let user: any = null;
    try {
      user = await getAuth().getUser(authUid);
    } catch (err: any) {
      if (err.code !== 'auth/user-not-found') throw err;
    }
    if (!user) {
      throw new HttpError(422, 'The dashboard account recorded on this request no longer exists — ask the applicant to submit the form again.');
    }
    if (String(user.email || '').toLowerCase() !== String(adminEmail || '').toLowerCase()) {
      throw new HttpError(422, 'The dashboard account does not match the admin email on this request.');
    }
    uid = user.uid;
  } else {
    try {
      const secSnap = await db.ref(`onboardingSecrets/${reqKey}`).get();
      legacyPassword = secSnap.val()?.password || null;
    } catch (e: any) {
      logger.warn('[onboarding] secret read failed (non-fatal, trying legacy)', { error: e.message });
    }
    if (!legacyPassword) legacyPassword = reqData.adminPassword || null;
    if (!legacyPassword || legacyPassword.length < 6) {
      throw new HttpError(422, 'No signup account on this request — ask the applicant to submit the form again.');
    }
  }

  // Ids are decided here but only STAMPED after the duplicate-email check: the
  // stamp is the "this request may own an Auth user" marker. Stamping first
  // would let a failed first attempt adopt a stranger's account on retry.
  const isRetry = Boolean(reqData.bid && reqData.oid);
  const bid: string = reqData.bid || db.ref('businesses').push().key!.toLowerCase();
  const oid: string = reqData.oid || db.ref(`businesses/${bid}/outlets`).push().key!.toLowerCase();

  if (!authUid) {
    try {
      await getAuth().getUserByEmail(adminEmail);
      if (!isRetry) throw new HttpError(409, `Admin email ${adminEmail} already exists`);
    } catch (err: any) {
      if (err instanceof HttpError) throw err;
      if (err.code !== 'auth/user-not-found') throw err;
    }
  }

  if (!isRetry) {
    await db.ref(`onboardingRequests/${reqKey}`).update({ bid, oid }).catch((e: any) => {
      logger.warn('[onboarding] id stamp failed (non-fatal)', { error: e.message });
    });
  }

  // Reuse the outlet number a previous attempt assigned; never burn a second.
  let outletNo: string | null = null;
  if (isRetry) {
    const noSnap = await db.ref(`businesses/${bid}/outlets/${oid}/outletNo`).get().catch(() => null);
    outletNo = (noSnap && noSnap.val()) || null;
  }
  if (!outletNo) {
    try {
      const noSnap = await db.ref('meta/outletCounter').transaction((cur) => (cur || 0) + 1);
      outletNo = String(noSnap.snapshot.val() || '').padStart(2, '0') || null;
    } catch (e: any) {
      logger.warn('[onboarding] outletCounter failed (non-fatal)', { error: e.message });
    }
  }

  let tplDefaults: any = null;
  if (template) {
    const tplSnap = await db.ref(`appTemplates/${template}`).get();
    tplDefaults = tplSnap.val()?.defaults || null;
  }

  const slug = (name: any) => String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
  const bankUpdates: Record<string, any> = {};
  if (tplDefaults) {
    Object.values(tplDefaults.categories || {}).forEach((c: any) => {
      if (c && c.name) {
        bankUpdates[`menuBank/categories/${slug(c.name)}`] = {
          ...c, sourceBid: bid, sourceOid: oid, updatedAt: serverTimestamp,
        };
      }
    });
    Object.values(tplDefaults.dishes || {}).forEach((d: any) => {
      if (d && d.name) {
        bankUpdates[`menuBank/dishes/${slug(`${d.name}-${d.category || 'other'}`)}`] = {
          ...d, sourceBid: bid, sourceOid: oid, updatedAt: serverTimestamp,
        };
      }
    });
  }

  // New flow: the Auth user already exists and was proven above — there is
  // genuinely no password to set. Legacy flow replays its stored password.
  if (!uid) {
    try {
      const user = await getAuth().getUserByEmail(adminEmail);
      uid = user.uid;
      await getAuth().updateUser(uid, { password: legacyPassword as string });
    } catch (err: any) {
      if (err.code !== 'auth/user-not-found') throw err;
      const created = await getAuth().createUser({ email: adminEmail, password: legacyPassword as string });
      uid = created.uid;
    }
  }

  // Merge the admins mirror (never clobber owner-managed name/fcmToken/isSuper).
  const curAdmin = (await db.ref(`admins/${uid}`).get()).val();
  if (curAdmin && (curAdmin.businessId !== bid || curAdmin.outlet !== oid)) {
    throw new HttpError(409, 'This login already belongs to another outlet. Sign up with a different email.');
  }
  await db.ref(`admins/${uid}`).update({
    email: adminEmail, outlet: oid, businessId: bid, role: 'owner',
    ...(curAdmin ? {} : { name: adminName || outletName }),
  });

  const now = serverTimestamp;
  await db.ref().update({
    [`businesses/${bid}`]: {
      name: businessName,
      contactPhone: contactPhone || null,
      contactEmail: contactEmail || null,
      plan: plan || 'starter',
      createdAt: now,
      outlets: {
        [oid]: {
          name: outletName,
          contactPhone: contactPhone || null,
          createdAt: now,
          ...(outletNo ? { outletNo } : {}),
          // Template data first, identity/security fields after it: a stray key
          // in a template must never unlock a new outlet or rewrite its login.
          ...(tplDefaults || {}),
          whatsapp: { status: 'pending', ...(whatsappConnect ? { requestedConnect: whatsappConnect } : {}) },
          locked: true,
          // Email only. The password lives in Firebase Auth and nowhere else.
          adminLogin: { email: adminEmail, updatedAt: now },
          settings: {
            ...(tplDefaults?.settings || {}),
            features: { ...(tplDefaults?.settings?.features || {}), discountApproval: false },
          },
        },
      },
    },
    // Money lives at the ROOT, outside businesses/{bid} (tenant-writable).
    [`walletBilling/${bid}/${oid}`]: getBillingDefaults(),
    [`outletIndex/${oid}`]: { bid, name: outletName, createdAt: now },
    ...bankUpdates,
  });

  // Burn the secret + clear any legacy inline password AFTER user creation so a
  // mid-flow failure stays retryable.
  await db.ref(`onboardingSecrets/${reqKey}`).set(null).catch((e: any) => {
    logger.warn('[onboarding] secret delete failed (non-fatal)', { error: e.message });
  });

  await db.ref(`onboardingRequests/${reqKey}`).update({
    status: 'approved',
    bid, oid,
    reviewedAt: now,
    reviewedBy: reviewerUid || null,
    adminPassword: null,
  });

  return { bid, oid, uid: uid as string, email: adminEmail };
}

// ---- handlers ---------------------------------------------------------------
async function handleStatus(req: any, res: any): Promise<void> {
  await supremeFromToken(req); // read-only: support accounts may check
  const bid = String((req.query && req.query.bid) || '');
  const oid = String((req.query && req.query.oid) || '');
  if (!bid || !oid) throw new HttpError(400, 'bid and oid are required');
  try {
    res.json(await outletAdminStatus(bid, oid));
  } catch (err: any) {
    logger.error('[onboarding] status check failed', { error: err.message });
    throw new HttpError(500, `Status check failed — ${err.message}`);
  }
}

async function handleApprove(req: any, res: any): Promise<void> {
  const who = await supremeFromToken(req);
  requireSuperRole(who);
  const body = await readJsonBody(req, MAX_BODY_BYTES, 'Request body is too large');
  const {
    reqKey, businessName, outletName, contactPhone, contactEmail,
    adminEmail, adminName, plan, template, whatsappConnect,
  } = body || {};
  if (!reqKey || !businessName || !outletName || !adminEmail) {
    throw new HttpError(400, 'reqKey, businessName, outletName, adminEmail are required');
  }
  try {
    const r = await approveOnboardingRequest(reqKey, {
      businessName, outletName, contactPhone, contactEmail,
      adminEmail, adminName, plan, template, whatsappConnect,
    }, who.uid);
    res.json({ ok: true, ...r, loginUrl: 'https://app.foodhubbie.in' });
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    logger.error('[onboarding] approve failed', { error: err.message });
    throw new HttpError(500, `Approval failed — ${err.message}`);
  }
}

async function handlePassword(req: any, res: any): Promise<void> {
  const who = await supremeFromToken(req);
  requireSuperRole(who);
  const body = await readJsonBody(req, MAX_BODY_BYTES, 'Request body is too large');
  const { bid, oid, email, newPassword } = body || {};
  if (!bid || !oid || !email || !newPassword) {
    throw new HttpError(400, 'bid, oid, email, and newPassword are required');
  }
  if (newPassword.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  const db = getDB();
  try {
    let uid: string;
    try {
      const user = await getAuth().getUserByEmail(email);
      uid = user.uid;
      await getAuth().updateUser(uid, { password: newPassword });
    } catch (err: any) {
      if (err.code !== 'auth/user-not-found') throw err;
      const created = await getAuth().createUser({ email, password: newPassword });
      uid = created.uid;
    }
    const outlet = (await db.ref(`businesses/${bid}/outlets/${oid}`).get()).val() || {};
    const outletName = outlet.name || oid;
    const ownerSnap = await db.ref(`admins/${uid}`).get();
    if (!ownerSnap.exists()) {
      await db.ref(`admins/${uid}`).set({
        email, outlet: oid, name: outletName, role: 'owner', businessId: bid,
      });
    }
    // Record only the email. The password lives in Firebase Auth.
    await db.ref(`businesses/${bid}/outlets/${oid}/adminLogin`).set({ email, passwordUpdatedAt: Date.now() });
    res.json({ ok: true, uid });
  } catch (err: any) {
    logger.error('[onboarding] password update failed', { error: err.message });
    throw new HttpError(500, `Password update failed — ${err.message}`);
  }
}

const KNOWN_ROUTES = new Set([
  '/api/admin/outlet-admin-status',
  '/api/admin/approve-onboarding',
  '/api/admin/update-password',
]);

export const tenantOnboarding = onRequest(
  {
    region: 'us-central1',
    memory: '256MiB',
    cpu: 1,
    timeoutSeconds: 120,
    minInstances: 0,
    maxInstances: 10,
    concurrency: 20,
    ingressSettings: 'ALLOW_ALL',
    cors: DASHBOARD_ORIGINS,
    secrets: ['FIREBASE_DATABASE_URL'],
    labels: { 'critical-path': 'true' },
  },
  async (req, res) => {
    const route = routeOf(req, 'tenantOnboarding');
    res.set('Cache-Control', 'no-store');
    try {
      if (route === '/health' && req.method === 'GET') {
        res.json({ ok: true, service: 'tenant-onboarding' });
        return;
      }
      await initializeAdmin();
      if (route === '/api/admin/outlet-admin-status' && req.method === 'GET') {
        await handleStatus(req, res);
        return;
      }
      if (route === '/api/admin/approve-onboarding' && req.method === 'POST') {
        await handleApprove(req, res);
        return;
      }
      if (route === '/api/admin/update-password' && req.method === 'POST') {
        await handlePassword(req, res);
        return;
      }
      if (KNOWN_ROUTES.has(route)) throw new HttpError(405, 'Method not allowed');
      throw new HttpError(404, `Unknown route ${route}`);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) {
        logger.error('[onboarding] request failed', { route, method: req.method, error: (err as Error).message });
      }
      res.status(status).json({ error: (err as Error).message });
    }
  },
);
