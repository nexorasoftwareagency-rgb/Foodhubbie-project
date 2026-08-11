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
import { dbPaths, PROXIMITY, OTP_LIMITS, OUTLETS, type OutletId } from "@/lib/constants";
import { getDistanceKm, isGhostOrder } from "@/lib/utils";
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

function assertProximity(riderLat: number, riderLng: number, targetLat: number, targetLng: number, maxKm: number, accuracyKm?: number) {
  if (accuracyKm != null && accuracyKm > maxKm) throw new ProximityError(accuracyKm, maxKm);
  const distance = getDistanceKm(riderLat, riderLng, targetLat, targetLng);
  if (distance > maxKm) throw new ProximityError(distance, maxKm);
}

/** ─── Outlet coordinates + backup code (real Store/Delivery settings, with the
 *  exact fallback coordinates hardcoded in app.js's window.outletCoords) ────── */

export type OutletInfo = {
  id: OutletId;
  name: string;
  icon: string;
  color: string;
  lat: number;
  lng: number;
  backupCode: string;
};

export async function loadOutlets(): Promise<OutletInfo[]> {
  const results = await Promise.all(
    OUTLETS.map(async (o) => {
      const [storeSnap, deliverySnap] = await Promise.all([
        get(ref(db, `${dbPaths.outletSettings(o.id)}/Store`)),
        get(ref(db, `${dbPaths.outletSettings(o.id)}/Delivery`)),
      ]);
      const store = (storeSnap.val() || {}) as OutletSettings["Store"];
      const delivery = (deliverySnap.val() || {}) as OutletSettings["Delivery"];
      return {
        id: o.id,
        name: o.name,
        icon: o.icon,
        color: o.color,
        lat: parseFloat(store.lat as any) || o.fallbackLat,
        lng: parseFloat(store.lng as any) || o.fallbackLng,
        backupCode: delivery.backupCode || "",
      };
    })
  );
  return results;
}

/** ─── Real-time order listeners across both fixed outlets ───────────────────── */

export function subscribeAvailableOrders(
  outlets: OutletInfo[],
  callback: (orders: AvailableOrder[]) => void,
  onError?: (err: Error) => void
) {
  const cache: Record<string, any> = {};
  const unsubs: Array<() => void> = [];

  const emit = () => {
    const list: AvailableOrder[] = Object.values(cache)
      .filter((o: any) => o.status === "Ready" && !isGhostOrder(o.createdAt, false))
      .map((o: any) => ({
        id: o.id,
        outlet: o.outlet,
        outletName: o.outletName,
        outletIcon: o.outletIcon,
        outletColor: o.outletColor,
        outletLat: o.outletLat,
        outletLng: o.outletLng,
        status: o.status,
        address: o.address,
        lat: o.lat,
        lng: o.lng,
        deliveryFee: o.deliveryFee,
        total: o.total,
        subtotal: o.subtotal,
        discountAmount: o.discountAmount,
        items: o.items || [],
        createdAt: o.createdAt,
      }));
    callback(list);
  };

  outlets.forEach(({ id, name, icon, color, lat, lng }) => {
    const q = query(ref(db, dbPaths.orders(id)), orderByChild("assignedRider"), equalTo(null));
    const handler = onValue(
      q,
      (snap) => {
        const val = snap.val() || {};
        Object.keys(cache).forEach((key) => {
          if (cache[key].outlet === id && !cache[key].assignedRider) delete cache[key];
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
          };
        });
        emit();
      },
      (err) => onError?.(err as unknown as Error)
    );
    unsubs.push(() => off(q, "value", handler));
  });

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

  outlets.forEach(({ id, name, icon, color, lat, lng, backupCode }) => {
    const q = query(ref(db, dbPaths.orders(id)), orderByChild("assignedRider"), equalTo(riderEmail.toLowerCase()));
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
  });

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

  outlets.forEach(({ id, name, icon }) => {
    const q = query(ref(db, dbPaths.orders(id)), orderByChild("assignedRider"), equalTo(riderEmail.toLowerCase()));
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
  });

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
  riderLat: number;
  riderLng: number;
  outletLat: number;
  outletLng: number;
  accuracy?: number;
  customerPhone?: string;
}): Promise<void> {
  const { outlet, orderId, riderEmail, riderUid, riderPhone, riderName, riderLat, riderLng, outletLat, outletLng, customerPhone, accuracy } =
    params;

  assertProximity(riderLat, riderLng, outletLat, outletLng, PROXIMITY.PICKUP_RADIUS_KM, accuracy);

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
    await whatsappService.sendAccepted(outlet, customerPhone, riderName, orderId).catch(() => {});
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
  await update(ref(db, dbPaths.singleOrder(outlet, orderId)), {
    status: "Arrived at Restaurant",
    arrivedAtRestaurantAt: serverTimestamp(),
  });
}

/** ─── Confirm pickup — matches window.confirmPickup + startNavigation, which run
 *  back-to-back in the real app (Picked Up → Out for Delivery within the same
 *  user action), so this performs both writes together. ─────────────────────── */

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

  await update(ref(db, dbPaths.singleOrder(outlet, orderId)), {
    status: "Out for Delivery",
    pickedUpAt: serverTimestamp(),
  });

  if (customerPhone) {
    await whatsappService.sendPickedUp(outlet, customerPhone, riderPhone, orderId).catch(() => {});
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
  const { outlet, orderId, customerPhone } = params;

  await update(ref(db, dbPaths.singleOrder(outlet, orderId)), {
    status: "Reached Drop Location",
    reachedDropAt: serverTimestamp(),
  });

  if (customerPhone) {
    await whatsappService.sendArrived(outlet, customerPhone, orderId).catch(() => {});
  }
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
  await update(ref(db), {
    [dbPaths.singleOrder(outlet, orderId) + "/deliveryOTP"]: newOtp,
    [dbPaths.singleOrder(outlet, orderId) + "/otp"]: newOtp,
    [attemptsPath + "/resendCount"]: (existing?.resendCount || 0) + 1,
    [attemptsPath + "/lastResend"]: now,
  });

  return { otp: newOtp };
}

export async function getOtpAttemptsStatus(
  outlet: OutletId,
  orderId: string
): Promise<{ blockedUntilMs: number; resendAvailableAtMs: number }> {
  const snap = await get(ref(db, dbPaths.otpAttempts(outlet, orderId)));
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

  const result = await runTransaction(ref(db, dbPaths.riderStats(outlet, riderId)), (current) => {
    if (!current) return { totalOrders: 1, totalEarnings: deliveryFee };
    return {
      ...current,
      totalOrders: (current.totalOrders || 0) + 1,
      totalEarnings: (current.totalEarnings || 0) + deliveryFee,
    };
  });
  if (!result.committed) throw new Error("Failed to update rider earnings");

  await update(ref(db, dbPaths.singleOrder(outlet, orderId)), {
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
  outlet: OutletId,
  uid: string,
  callback: (stats: { totalOrders: number; totalEarnings: number }) => void
) {
  const statsRef = ref(db, dbPaths.riderStats(outlet, uid));
  const handler = onValue(statsRef, (snap) => {
    callback(snap.val() || { totalOrders: 0, totalEarnings: 0 });
  });
  return () => off(statsRef, "value", handler);
}
