// === src/services/orderService.ts ===
// The core delivery lifecycle, adapted 1:1 from rider/app.js's real functions
// (window.acceptOrder, window.reachedOutlet, window.confirmPickup + startNavigation,
// window.reachedDropLocation, window.verifyOTP, window.regenerateOTP,
// window.finalizeDeliverySequence) — exact field names, exact status strings,
// exact proximity radius, and exact absence of a wallet/ledger system.

import {
  db,
  ref,
  get,
  update,
  remove,
  runTransaction,
  query,
  orderByChild,
  equalTo,
  onValue,
  off,
  serverTimestamp,
} from "@/lib/firebase";
import { dbPaths, PROXIMITY, OTP_LIMITS, type OutletId } from "@/lib/constants";
import { getDistanceKm, isGhostOrder, formatOrderId } from "@/lib/utils";
import { whatsappService } from "@/services/whatsappService";
import type { AvailableOrder, OtpAttemptRecord, OutletSettings, RiderOrder } from "@/types";

export class ProximityError extends Error {
  distanceKm: number;
  maxKm: number;
  constructor(distanceKm: number, maxKm: number) {
    super(`Too far away (${distanceKm.toFixed(2)}km). Move within ${maxKm}km and try again.`);
    this.name = "ProximityError";
    this.distanceKm = distanceKm;
    this.maxKm = maxKm;
  }
}

export class OrderTakenError extends Error {
  constructor() {
    super("This order has already been accepted by another rider.");
    this.name = "OrderTakenError";
  }
}

export class OtpBlockedError extends Error {
  retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`Too many attempts. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = "OtpBlockedError";
    this.retryAfterMs = retryAfterMs;
  }
}

function assertProximity(riderLat: number, riderLng: number, targetLat: number, targetLng: number, maxKm: number, accuracyMeters?: number) {
  const distance = getDistanceKm(riderLat, riderLng, targetLat, targetLng);
  if (distance > maxKm) throw new ProximityError(distance, maxKm);
  if (accuracyMeters != null && accuracyMeters / 1000 > maxKm * 4) {
    throw new ProximityError(Math.max(distance, accuracyMeters / 1000), maxKm);
  }
}

/** ─── Outlet coordinates + backup code (from Store/Delivery settings) ────── */

export type OutletInfo = {
  id: OutletId;
  name: string;
  icon: string;
  color: string;
  lat: number;
  lng: number;
  backupCode: string;
  businessId: string;
};

export async function loadOutlets(): Promise<OutletInfo[]> {
  // Discover all businesses and their outlets dynamically
  const businessesSnap = await get(ref(db, "businesses"));
  const businesses = (businessesSnap.val() || {}) as Record<string, any>;
  
  // Collect all outlet refs first, then batch-read all settings in one Promise.all
  const outletRefs: Array<{ bid: string; oid: string; outletData: any }> = [];
  for (const [bid, business] of Object.entries(businesses)) {
    const outlets = business.outlets || {};
    for (const [oid, outlet] of Object.entries(outlets)) {
      outletRefs.push({ bid, oid, outletData: outlet });
    }
  }
  
  // Batch read all Store + Delivery settings in parallel
  // Use Promise.allSettled so one outlet's failure doesn't block others
  const settingsResults = await Promise.allSettled(
    outletRefs.map(({ bid, oid }) =>
      Promise.all([
        get(ref(db, `businesses/${bid}/outlets/${oid}/settings/Store`)),
        get(ref(db, `businesses/${bid}/outlets/${oid}/settings/Delivery`)),
      ]).then(([storeSnap, deliverySnap]) => ({ bid, oid, storeSnap, deliverySnap }))
    )
  );
  
  // Filter successful results, log failures
  const allSettings = settingsResults
    .map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      console.error(`[loadOutlets] Failed to load settings for outlet ${outletRefs[i].oid}:`, result.reason);
      return null;
    })
    .filter((x): x is { bid: string; oid: string; storeSnap: any; deliverySnap: any } => x !== null);
  
  const results: OutletInfo[] = [];
  for (let i = 0; i < outletRefs.length; i++) {
    const { bid, oid, outletData: outletMeta } = outletRefs[i];
    const { storeSnap, deliverySnap } = allSettings[i];
    
    const store = (storeSnap.val() || {}) as OutletSettings["Store"];
    const delivery = (deliverySnap.val() || {}) as OutletSettings["Delivery"];
    const outletMetaData = outletMeta as Record<string, any>;
    
    // Get display name from outlet settings or use outlet ID
    const displayName = outletMetaData.name || outletMetaData.id || oid;
    
    results.push({
      id: oid,
      name: displayName,
      icon: "🏪",
      color: "#E84908",
      lat: parseFloat(store.lat as any) || 25.887944,
      lng: parseFloat(store.lng as any) || 85.026194,
      backupCode: delivery.backupCode || "",
      businessId: bid,
    });
  }
  return results;
}

/** ─── Real-time order listeners across both fixed outlets ───────────────────── */

export function subscribeAvailableOrders(
  outlets: OutletInfo[],
  callback: (orders: AvailableOrder[]) => void,
  onError?: (err: Error) => void
) {
  const cache: Record<string, { data: any; updatedAt: number }> = {};
  const unsubs: Array<() => void> = [];

  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL
  const CACHE_MAX_ENTRIES = 500; // hard cap

  function cleanupCache() {
    const now = Date.now();
    // Remove expired entries
    Object.keys(cache).forEach(key => {
      if (now - cache[key].updatedAt > CACHE_TTL_MS) {
        delete cache[key];
      }
    });
    // Enforce max entries by removing oldest
    if (Object.keys(cache).length > CACHE_MAX_ENTRIES) {
      const entries = Object.entries(cache).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const toRemove = entries.slice(0, entries.length - CACHE_MAX_ENTRIES);
      toRemove.forEach(([key]) => delete cache[key]);
    }
  }

  const emit = () => {
    cleanupCache(); // Run cleanup on each emit
    const list: AvailableOrder[] = Object.values(cache)
      .filter((entry) => entry.data.status === "Ready" && !entry.data.assignedRider && !isGhostOrder(entry.data.createdAt, false))
      .map((entry) => ({
        id: entry.data.id,
        outlet: entry.data.outlet,
        outletName: entry.data.outletName,
        outletIcon: entry.data.outletIcon,
        outletColor: entry.data.outletColor,
        outletLat: entry.data.outletLat,
        outletLng: entry.data.outletLng,
        status: entry.data.status,
        address: entry.data.address,
        lat: entry.data.lat,
        lng: entry.data.lng,
        deliveryFee: entry.data.deliveryFee,
        total: entry.data.total,
        subtotal: entry.data.subtotal,
        discountAmount: entry.data.discountAmount,
        items: entry.data.items || [],
        createdAt: entry.data.createdAt,
      }));
    callback(list);
  };

  for (const { id, name, icon, color, lat, lng } of outlets) {
    const ordersPath = dbPaths.orders(id);
    const q = query(ref(db, ordersPath), orderByChild("assignedRider"), equalTo(null));
    const handler = onValue(
      q,
      (snap) => {
        const val = snap.val() || {};
        // Do NOT delete from cache on assignedRider change — filter at emit time instead.
        // This ensures orders reappear if assignedRider is later cleared (cancellation/reassignment).
        Object.entries(val).forEach(([orderId, data]) => {
          cache[`${id}:${orderId}`] = {
            data: {
              ...(data as RiderOrder),
              id: orderId,
              outlet: id,
              outletName: name,
              outletIcon: icon,
              outletColor: color,
              outletLat: lat,
              outletLng: lng,
            },
            updatedAt: Date.now(),
          };
        });
        emit();
      },
      (err) => onError?.(err as unknown as Error)
    );
    unsubs.push(() => off(q, "value", handler));
  }

  return () => unsubs.forEach((fn) => fn());
}

export type ActiveOrderRow = RiderOrder & {
  outletName: string;
  outletIcon: string;
  outletColor: string;
  outletLat: number;
  outletLng: number;
  backupCode: string;
  step: number;
};

export function subscribeActiveOrders(
  outlets: OutletInfo[],
  riderEmail: string,
  callback: (orders: ActiveOrderRow[]) => void,
  onError?: (err: Error) => void
) {
  const cache: Record<string, any> = {};
  const unsubs: Array<() => void> = [];

  const emit = () => {
    const list = Object.values(cache).filter((o: any) => o.status !== "Delivered" && o.status !== "Cancelled");
    callback(list as any);
  };

  for (const { id, name, icon, color, lat, lng, backupCode } of outlets) {
    const ordersPath = dbPaths.orders(id);
    const q = query(ref(db, ordersPath), orderByChild("assignedRider"), equalTo(riderEmail.toLowerCase()));
    const handler = onValue(
      q,
      (snap) => {
        const val = snap.val() || {};
        Object.keys(cache).forEach((key) => {
          if (cache[key].outlet === id) delete cache[key];
        });
        Object.entries(val).forEach(([orderId, data]) => {
          cache[`${id}:${orderId}`] = {
            ...(data as RiderOrder),
            id: orderId,
            outlet: id,
            outletName: name,
            outletIcon: icon,
            outletColor: color,
            outletLat: lat,
            outletLng: lng,
            backupCode,
          };
        });
        emit();
      },
      (err) => onError?.(err as unknown as Error)
    );
    unsubs.push(() => off(q, "value", handler));
  }

  return () => unsubs.forEach((fn) => fn());
}

export function subscribeOrderHistory(
  outlets: OutletInfo[],
  riderEmail: string,
  callback: (orders: Array<RiderOrder & { outletName: string; outletIcon: string }>) => void,
  onError?: (err: Error) => void
) {
  const cache: Record<string, any> = {};
  const unsubs: Array<() => void> = [];

  const emit = () => {
    const list = Object.values(cache)
      .filter((o: any) => o.status === "Delivered")
      .sort((a: any, b: any) => (b.deliveredAt || 0) - (a.deliveredAt || 0));
    callback(list as any);
  };

  for (const { id, name, icon } of outlets) {
    const ordersPath = dbPaths.orders(id);
    const q = query(ref(db, ordersPath), orderByChild("assignedRider"), equalTo(riderEmail.toLowerCase()));
    const handler = onValue(
      q,
      (snap) => {
        const val = snap.val() || {};
        Object.keys(cache).forEach((key) => {
          if (cache[key].outlet === id) delete cache[key];
        });
        Object.entries(val).forEach(([orderId, data]) => {
          cache[`${id}:${orderId}`] = { ...(data as RiderOrder), id: orderId, outlet: id, outletName: name, outletIcon: icon };
        });
        emit();
      },
      (err) => onError?.(err as unknown as Error)
    );
    unsubs.push(() => off(q, "value", handler));
  }

  return () => unsubs.forEach((fn) => fn());
}

/** ─── Accept order — atomic transaction, matches window.acceptOrder exactly ──── */

export async function acceptOrder(params: {
  outlet: OutletId;
  orderId: string;
  riderEmail: string;
  riderUid: string;
  riderPhone: string;
  riderName: string;
  customerPhone?: string;
}): Promise<void> {
  const { outlet, orderId, riderEmail, riderUid, riderPhone, riderName, customerPhone } = params;

  // ponytail: no proximity gate on ACCEPT — riders accept from anywhere and drive
  // to the store (matches the desired flow "Rider accepts -> on way to restaurant").
  // The 0.5km gate still applies at markReachedOutlet/confirmPickup (physical presence).

  const orderPath = dbPaths.singleOrder(outlet, orderId);
  const result = await runTransaction(ref(db, orderPath), (current) => {
    if (!current) return current;
    if (current.assignedRider) return; // already taken — abort transaction
    const initialOTP = Math.floor(1000 + Math.random() * 9000).toString();
    return {
      ...current,
      status: "Arriving at Restaurant",
      deliveryOTP: initialOTP,
      otp: initialOTP,
      assignedRider: riderEmail.toLowerCase(),
      riderId: riderUid,
      riderPhone: riderPhone || "",
      acceptedAt: serverTimestamp(),
    };
  });

  if (!result.committed) {
    throw new OrderTakenError();
  }

  try {
    localStorage.setItem("activeOrderId", orderId);
  } catch {
    /* ignore */
  }

  if (customerPhone) {
    await whatsappService.sendAccepted(outlet, customerPhone, riderName, formatOrderId(orderId)).catch(() => {});
  }
}

/** ─── Reached outlet — matches window.reachedOutlet exactly (same 0.5km gate) ── */

export async function markReachedOutlet(params: {
  outlet: OutletId;
  orderId: string;
  riderLat: number;
  riderLng: number;
  outletLat: number;
  outletLng: number;
  accuracy?: number;
}): Promise<void> {
  const { outlet, orderId, riderLat, riderLng, outletLat, outletLng, accuracy } = params;
  assertProximity(riderLat, riderLng, outletLat, outletLng, PROXIMITY.PICKUP_RADIUS_KM, accuracy);
  const singleOrderPath = dbPaths.singleOrder(outlet, orderId);
  await update(ref(db, singleOrderPath), {
    status: "Arrived at Restaurant",
    arrivedAtRestaurantAt: serverTimestamp(),
  });
}

/** ─── Confirm pickup — rider has physically picked up the order. Writes the
 *  real "Picked Up" status (desired flow: Picked Up + OTP -> heading to
 *  delivery). The bot's handleOrderStatusUpdate sends the customer the OTP +
 *  "heading to your location" message for both "picked up" and "out for
 *  delivery", so the customer is notified here. ─────────────────────────────── */

export async function confirmPickup(params: {
  outlet: OutletId;
  orderId: string;
  riderLat: number;
  riderLng: number;
  outletLat: number;
  outletLng: number;
  riderPhone: string;
  accuracy?: number;
  customerPhone?: string;
}): Promise<void> {
  const { outlet, orderId, riderLat, riderLng, outletLat, outletLng, riderPhone, customerPhone, accuracy } = params;
  assertProximity(riderLat, riderLng, outletLat, outletLng, PROXIMITY.PICKUP_RADIUS_KM, accuracy);

  const singleOrderPath = dbPaths.singleOrder(outlet, orderId);
  await update(ref(db, singleOrderPath), {
    status: "Picked Up",
    pickedUpAt: serverTimestamp(),
  });

  if (customerPhone) {
    await whatsappService.sendPickedUp(outlet, customerPhone, riderPhone, formatOrderId(orderId)).catch(() => {});
  }
}

/** ─── Reached drop location — matches window.reachedDropLocation exactly:
 *  NO proximity gate (verified against the real function — genuinely absent),
 *  and sends only the ARRIVED template, never the OTP itself. ──────────────── */

export async function markReachedDrop(params: {
  outlet: OutletId;
  orderId: string;
  customerPhone?: string;
}): Promise<void> {
  const { outlet, orderId } = params;

  const singleOrderPath = dbPaths.singleOrder(outlet, orderId);
  await update(ref(db, singleOrderPath), {
    status: "Reached Drop Location",
    reachedDropAt: serverTimestamp(),
  });
  // ponytail: no direct ARRIVED send here — the bot's handleOrderStatusUpdate
  // already messages the customer on "reached drop location" (with the OTP), so
  // sending sendArrived too duplicated the alert. Removed the duplicate.
}

/** ─── OTP verification — matches window.verifyOTP exactly (10 attempts / 60s block) */

export async function verifyOtp(params: {
  outlet: OutletId;
  orderId: string;
  enteredOtp: string;
  actualOtp: string;
  backupCode?: string;
}): Promise<{ success: boolean; verifiedBy: "OTP" | "ADMIN_FALLBACK"; attemptsRemaining?: number }> {
  const { outlet, orderId, enteredOtp, actualOtp, backupCode } = params;
  const attemptsPath = dbPaths.otpAttempts(outlet, orderId);

  const existingSnap = await get(ref(db, attemptsPath));
  const existing = (existingSnap.val() as OtpAttemptRecord | null) || null;
  const now = Date.now();
  if (existing?.blockedUntil && existing.blockedUntil > now) {
    throw new OtpBlockedError(existing.blockedUntil - now);
  }

  const isCorrect = enteredOtp === actualOtp;
  // Matches app.js: fallback works regardless of isAdmin flag as long as a backup
  // code is configured — the emergency-override BUTTON is admin-gated in the UI,
  // but the code itself doesn't require it. Kept consistent here for parity.
  const isFallback = Boolean(backupCode && enteredOtp === backupCode);

  if (isCorrect || isFallback) {
    await remove(ref(db, attemptsPath));
    return { success: true, verifiedBy: isCorrect ? "OTP" : "ADMIN_FALLBACK" };
  }

  const result = await runTransaction(ref(db, attemptsPath), (current) => {
    const data: OtpAttemptRecord = current || { count: 0, lastTry: 0, blockedUntil: 0, lastResend: 0, resendCount: 0 };
    data.count = (data.count || 0) + 1;
    data.lastTry = now;
    if (data.count >= OTP_LIMITS.MAX_ATTEMPTS) {
      data.blockedUntil = now + OTP_LIMITS.BLOCK_DURATION_MS;
    }
    return data;
  });

  if (!result.committed) throw new Error("Failed to record OTP attempt");

  const updated = result.snapshot.val() as OtpAttemptRecord;
  if (updated?.blockedUntil && updated.blockedUntil > now) {
    throw new OtpBlockedError(updated.blockedUntil - now);
  }

  return {
    success: false,
    verifiedBy: "OTP",
    attemptsRemaining: Math.max(0, OTP_LIMITS.MAX_ATTEMPTS - (updated?.count || 0)),
  };
}

/** ─── Resend / regenerate OTP — matches window.regenerateOTP exactly. Note the
 *  real app deliberately does NOT call triggerWhatsAppAlert here — "hide OTP
 *  from Rider... the WhatsApp Bot will detect the field change and send the
 *  alert instead." Replicated faithfully: this never touches whatsappService. */

export async function resendOtp(params: { outlet: OutletId; orderId: string }): Promise<{ otp: string }> {
  const { outlet, orderId } = params;
  const attemptsPath = dbPaths.otpAttempts(outlet, orderId);
  const snap = await get(ref(db, attemptsPath));
  const existing = (snap.val() as OtpAttemptRecord | null) || null;
  const now = Date.now();

  if (existing?.lastResend && now - existing.lastResend < OTP_LIMITS.RESEND_COOLDOWN_MS) {
    const remaining = OTP_LIMITS.RESEND_COOLDOWN_MS - (now - existing.lastResend);
    throw new Error(`Wait ${Math.ceil(remaining / 1000)}s before resending.`);
  }

  const newOtp = Math.floor(1000 + Math.random() * 9000).toString();
  const singleOrderPath = dbPaths.singleOrder(outlet, orderId);
  await update(ref(db), {
    [singleOrderPath + "/deliveryOTP"]: newOtp,
    [singleOrderPath + "/otp"]: newOtp,
    [attemptsPath + "/resendCount"]: (existing?.resendCount || 0) + 1,
    [attemptsPath + "/lastResend"]: now,
  });

  return { otp: newOtp };
}

export async function getOtpAttemptsStatus(
  outlet: OutletId,
  orderId: string
): Promise<{ blockedUntilMs: number; resendAvailableAtMs: number }> {
  const attemptsPath = dbPaths.otpAttempts(outlet, orderId);
  const snap = await get(ref(db, attemptsPath));
  const val = (snap.val() as OtpAttemptRecord | null) || null;
  const now = Date.now();
  return {
    blockedUntilMs: val?.blockedUntil && val.blockedUntil > now ? val.blockedUntil - now : 0,
    resendAvailableAtMs:
      val?.lastResend && now - val.lastResend < OTP_LIMITS.RESEND_COOLDOWN_MS
        ? OTP_LIMITS.RESEND_COOLDOWN_MS - (now - val.lastResend)
        : 0,
  };
}

/** ─── Payment complete → riderStats only, matches window.finalizeDeliverySequence
 *  exactly. There is NO wallet or ledger in the real Roshani schema — verified
 *  against app.js line-by-line. Do not add one; it would silently diverge from
 *  what ShopAdmin/SupremeAdmin-equivalent tools actually read. ──────────────── */

export async function completeDelivery(params: {
  outlet: OutletId;
  orderId: string;
  riderId: string;
  deliveryFee: number;
  paymentMethod: "CASH" | "UPI" | "CARD";
  verifiedBy: "OTP" | "ADMIN_FALLBACK";
}): Promise<void> {
  const { outlet, orderId, riderId, deliveryFee, paymentMethod, verifiedBy } = params;

  const riderStatsPath = dbPaths.riderStats(riderId);
  const result = await runTransaction(ref(db, riderStatsPath), (current) => {
    if (!current) return { totalOrders: 1, totalEarnings: deliveryFee };
    return {
      ...current,
      totalOrders: (current.totalOrders || 0) + 1,
      totalEarnings: (current.totalEarnings || 0) + deliveryFee,
    };
  });
  if (!result.committed) throw new Error("Failed to update rider earnings");

  const singleOrderPath = dbPaths.singleOrder(outlet, orderId);
  await update(ref(db, singleOrderPath), {
    status: "Delivered",
    deliveredAt: serverTimestamp(),
    verifiedBy,
    paymentCollected: true,
    paymentMethod: paymentMethod.toUpperCase(),
  });

  try {
    localStorage.removeItem("activeOrderId");
    localStorage.removeItem("activeOrderData");
  } catch {
    /* ignore */
  }
}

export function subscribeRiderStats(
  uid: string,
  callback: (stats: { totalOrders: number; totalEarnings: number }) => void
) {
  const statsPath = dbPaths.riderStats(uid);
  const statsRef = ref(db, statsPath);
  const handler = onValue(statsRef, (snap) => {
    callback(snap.val() || { totalOrders: 0, totalEarnings: 0 });
  });
  return () => off(statsRef, "value", handler);
}
