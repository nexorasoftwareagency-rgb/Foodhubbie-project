// === src/lib/constants.ts ===
// Firebase path helpers, proximity gates, rate limits, and WhatsApp templates.
// Supports dynamic outlets — outlet metadata fetched from Firebase at runtime.

/** Outlet ID is any string (business-specific). Fallback coords for unknown outlets. */
export type OutletId = string;

/** Fallback coordinates when outlet settings not yet loaded. */
export const FALLBACK_COORDS = { lat: 25.887944, lng: 85.026194 };

/** In-memory cache for outlet -> businessId mapping */
const outletBusinessIdCache = new Map<OutletId, string>();

/** Resolve businessId for an outlet at runtime. */
export async function resolveBusinessIdForOutlet(outletId: OutletId): Promise<string> {
  if (outletBusinessIdCache.has(outletId)) {
    return outletBusinessIdCache.get(outletId)!;
  }
  const { db, ref, get } = await import("@/lib/firebase");
  const snap = await get(ref(db, `businesses`));
  const businesses = (snap.val() || {}) as Record<string, any>;
  
  for (const [bid, business] of Object.entries(businesses)) {
    if (business.outlets && business.outlets[outletId]) {
      outletBusinessIdCache.set(outletId, bid);
      return bid;
    }
  }
  // Fallback to first business (should not happen in production)
  const firstBid = Object.keys(businesses)[0];
  outletBusinessIdCache.set(outletId, firstBid);
  return firstBid;
}

/** Sync version — works when outletBusinessIdCache is already populated (after RiderContext init).
 *  Throws if cache miss — callers must ensure cache is populated first. */
export function getBusinessIdForOutletSync(outletId: OutletId): string {
  const bid = outletBusinessIdCache.get(outletId);
  if (!bid) throw new Error(`Business ID not cached for outlet: ${outletId}. Call resolveBusinessIdForOutlet() first.`);
  return bid;
}

/** Display meta for outlet breakdown cards (fallback for unknown outlets). */
export function getOutletMeta(outletId: OutletId): { name: string; icon: string; color: string } {
  if (outletId === "cake") return { name: "Cake", icon: "🎂", color: "#D946EF" };
  if (outletId === "pizza") return { name: "Pizza", icon: "🍕", color: "#E84908" };
  return { name: outletId, icon: "🏪", color: "#E84908" };
}

/** Async version for paths that need runtime resolution — use during app initialization. */
export async function tenantPathAsync(outlet: OutletId, path: string): Promise<string> {
  const bid = await resolveBusinessIdForOutlet(outlet);
  return `businesses/${bid}/outlets/${outlet}/${path}`;
}

/** Sync version — use AFTER RiderContext initializes cache. Throws if cache miss. */
export function tenantPathSync(outlet: OutletId, path: string): string {
  const bid = getBusinessIdForOutletSync(outlet);
  return `businesses/${bid}/outlets/${outlet}/${path}`;
}

/** Async path helpers — use during app initialization. */
export const dbPathsAsync = {
  rider: (rId: string) => `riders/${rId}`,
  riderNotifs: (rId: string) => `riders/${rId}/notifications`,
  riderLocation: (rId: string) => `riders/${rId}/location`,
  /** Global rider stats (NOT per-outlet) — matches Admin's global riderStats node. */
  riderStats: async (_outlet: OutletId, rId: string) => `riderStats/${rId}`,
  orders: async (outlet: OutletId) => {
    const bid = await resolveBusinessIdForOutlet(outlet);
    return `businesses/${bid}/outlets/${outlet}/orders`;
  },
  singleOrder: async (outlet: OutletId, orderId: string) => {
    const bid = await resolveBusinessIdForOutlet(outlet);
    return `businesses/${bid}/outlets/${outlet}/orders/${orderId}`;
  },
  outletSettings: async (outlet: OutletId) => {
    const bid = await resolveBusinessIdForOutlet(outlet);
    return `businesses/${bid}/outlets/${outlet}/settings`;
  },
  botCommands: async (outlet: OutletId) => {
    const bid = await resolveBusinessIdForOutlet(outlet);
    return `businesses/${bid}/outlets/${outlet}/bot/commands`;
  },
  otpAttempts: async (outlet: OutletId, orderId: string) => {
    const bid = await resolveBusinessIdForOutlet(outlet);
    return `businesses/${bid}/outlets/${outlet}/otpAttempts/${orderId}`;
  },
  settlements: (rId: string) => `settlements/${rId}`,
  riderErrors: (rId: string) => `logs/riderErrors/${rId}`,
};

/** Sync path helpers — use AFTER RiderContext initializes cache. */
export const dbPaths = {
  rider: (rId: string) => `riders/${rId}`,
  riderNotifs: (rId: string) => `riders/${rId}/notifications`,
  riderLocation: (rId: string) => `riders/${rId}/location`,
  /** Global rider stats (NOT per-outlet) — matches Admin's global riderStats node. */
  riderStats: (rId: string) => `riderStats/${rId}`,
  orders: (outlet: OutletId) => `businesses/${getBusinessIdForOutletSync(outlet)}/outlets/${outlet}/orders`,
  singleOrder: (outlet: OutletId, orderId: string) => `businesses/${getBusinessIdForOutletSync(outlet)}/outlets/${outlet}/orders/${orderId}`,
  outletSettings: (outlet: OutletId) => `businesses/${getBusinessIdForOutletSync(outlet)}/outlets/${outlet}/settings`,
  botCommands: (outlet: OutletId) => `businesses/${getBusinessIdForOutletSync(outlet)}/outlets/${outlet}/bot/commands`,
  otpAttempts: (outlet: OutletId, orderId: string) => `businesses/${getBusinessIdForOutletSync(outlet)}/outlets/${outlet}/otpAttempts/${orderId}`,
  settlements: (rId: string) => `settlements/${rId}`,
  riderErrors: (rId: string) => `logs/riderErrors/${rId}`,
};

/** Rider-facing order status pipeline (app.js literals, exact strings) */
export const ORDER_STATUSES = [
  "Placed",
  "Confirmed",
  "Preparing",
  "Cooked",
  "Ready",
  "Arriving at Restaurant",
  "Arrived at Restaurant",
  "Picked Up",
  "Out for Delivery",
  "Reached Drop Location",
  "Delivered",
  "Cancelled",
] as const;

/** Proximity gate — uniform radius for accept/reached-outlet/
 *  confirm-pickup (PICKUP_RADIUS_KM = 0.5), and NO gate at all for
 *  reached-drop (reachedDropLocation has no distance check). */
export const PROXIMITY = {
  PICKUP_RADIUS_KM: 0.5,
};

/** OTP rate limiting — 10 attempts / 60s block, 60s resend. */
export const OTP_LIMITS = {
  MAX_ATTEMPTS: 10,
  BLOCK_DURATION_MS: 60 * 1000,
  RESEND_COOLDOWN_MS: 60 * 1000,
};

/** GPS sync interval while Online. */
export const LOCATION_SYNC_INTERVAL_MS = 10 * 1000;

export const PING_COUNTDOWN_SECONDS = 30;

/** Ghost-order filtering window — 48h window. */
export const GHOST_ORDER_WINDOW_MS = 48 * 60 * 60 * 1000;

/** WhatsApp templates — generic for any restaurant brand. */
export const WHATSAPP_TEMPLATES = {
  ACCEPTED: (riderName: string, orderId: string) =>
    `Hello! I am ${riderName}, your delivery partner for order #${orderId}. I am on my way to pick up your order! \u{1F6F5}`,

  PICKED_UP: (riderPhone: string, orderId: string) =>
    `Great news! I have picked up your order #${orderId}. If you need anything, you can call me at ${riderPhone}. I am on my way! \u{1F355}\u{1F382}`,

  ARRIVED: (orderId: string) =>
    `I have arrived with your order #${orderId}! Please have your 4-digit OTP ready. \u2705`,
};

export const BRAND = {
  primary: "#E84908",
  primaryDark: "#c43d00",
  primaryLight: "#FFF5F1",
  success: "#10B981",
  info: "#3B82F6",
  warning: "#F59E0B",
  danger: "#EF4444",
};

export const CONFETTI_COLORS = ["#E84908", "#FF7A00", "#22C55E"];

export const APP_VERSION = "1.0.0";

/** Motivational weekly earnings target shown on the Earnings page. Configurable via settings. */
export const WEEKLY_EARNINGS_TARGET = 4000;
