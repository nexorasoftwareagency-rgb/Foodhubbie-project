// === src/lib/constants.ts ===
// Firebase path helpers, proximity gates, rate limits, and WhatsApp templates —
// extracted 1:1 from rider/app.js and rider/js/whatsapp.js in roshani-pizza-bot.

/** Roshani runs exactly two fixed outlets — not a dynamic multi-tenant discovery
 *  like FoodHubbie. Matches window.outletCoords fallback values in app.js. */
export const OUTLETS = [
  { id: "pizza" as const, name: "Pizza", icon: "🍕", color: "#E84908", fallbackLat: 25.887944, fallbackLng: 85.026194 },
  { id: "cake" as const, name: "Cake", icon: "🎂", color: "#D946EF", fallbackLat: 25.887472, fallbackLng: 85.026861 },
];

export type OutletId = "pizza" | "cake";

export const dbPaths = {
  rider: (rId: string) => `riders/${rId}`,
  riderNotifs: (rId: string) => `riders/${rId}/notifications`,
  riderLocation: (rId: string) => `riders/${rId}/location`,
  /** Per-outlet, matching the real schema exactly (NOT the unused top-level riderStats node). */
  riderStats: (outlet: OutletId, rId: string) => `${outlet}/riderStats/${rId}`,
  orders: (outlet: OutletId) => `${outlet}/orders`,
  singleOrder: (outlet: OutletId, orderId: string) => `${outlet}/orders/${orderId}`,
  outletSettings: (outlet: OutletId) => `${outlet}/settings`,
  botCommands: (outlet: OutletId) => `bot/${outlet}/commands`,
  otpAttempts: (outlet: OutletId, orderId: string) => `${outlet}/otpAttempts/${orderId}`,
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

/** Proximity gate — Roshani uses ONE uniform radius for accept/reached-outlet/
 *  confirm-pickup (window.PICKUP_RADIUS_KM = 0.5), and NO gate at all for
 *  reached-drop (verified against app.js — reachedDropLocation has no distance check). */
export const PROXIMITY = {
  PICKUP_RADIUS_KM: 0.5,
};

/** OTP rate limiting — identical constants to the real app.js (10 attempts / 60s block, 60s resend). */
export const OTP_LIMITS = {
  MAX_ATTEMPTS: 10,
  BLOCK_DURATION_MS: 60 * 1000,
  RESEND_COOLDOWN_MS: 60 * 1000,
};

/** GPS sync interval while Online (matches FoodHubbie port's cadence — reasonable
 *  default; the real app.js doesn't specify one since it's a distinct interaction). */
export const LOCATION_SYNC_INTERVAL_MS = 10 * 1000;

export const PING_COUNTDOWN_SECONDS = 30;

/** Ghost-order filtering window — matches existing rider app's 48h window. */
export const GHOST_ORDER_WINDOW_MS = 48 * 60 * 60 * 1000;

/** WhatsApp templates — exact strings from rider/js/whatsapp.js, branded "Roshani Sudha"
 *  (the real customer-facing name used in these messages, distinct from the "Roshani
 *  Pizza | Rider Portal" browser title). NOTE: there is deliberately NO template call
 *  for sending the OTP itself — the WhatsApp bot independently watches the order's
 *  deliveryOTP field and messages the customer; the rider app never has that responsibility
 *  ("Removed triggerWhatsAppAlert from here to hide OTP from Rider" — real code comment). */
export const WHATSAPP_TEMPLATES = {
  ACCEPTED: (riderName: string, orderId: string) =>
    `Hello! I am ${riderName}, your delivery partner for Roshani Sudha order #${orderId}. I am on my way to pick up your order! \u{1F6F5}`,

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

/** Motivational weekly earnings target shown on the Earnings page. No backend field
 *  for this exists — safe to wire to a real Firebase setting later if needed. */
export const WEEKLY_EARNINGS_TARGET = 4000;
