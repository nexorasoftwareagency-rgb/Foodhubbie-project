// === src/types/index.ts ===
// TypeScript interfaces mirroring the exact Roshani Firebase Realtime Database schema.

import type { OutletId } from "@/lib/constants";

export type RiderStatus = "Online" | "Offline";

export type Rider = {
  uid: string;
  name: string;
  fatherName: string;
  age: string;
  aadharNo: string;
  aadharPhoto: string;
  qualification: string;
  phone: string;
  address: string;
  profilePhoto: string;
  status: RiderStatus;
  lastSeen: number;
  fcmToken: string;
  isAdmin: boolean;
  /** No rating pipeline exists in the real schema — renders as "New" until one exists. */
  rating?: number;
  notifications?: Record<string, RiderNotification>;
  location?: RiderLocation;
};

export type RiderNotification = {
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  type: "info" | "success" | "warning";
  icon: string;
};

export type RiderLocation = {
  lat: number;
  lng: number;
  accuracy: number;
  ts: number;
  lastUpdate?: number;
  signalLost?: boolean;
};

/** Per-outlet running totals — {outlet}/riderStats/{riderId}. No daily reset field
 *  exists in the real schema; "today" figures are derived from order timestamps instead. */
export type RiderStats = {
  totalOrders: number;
  totalEarnings: number;
};

export type OrderStatus =
  | "Placed"
  | "Confirmed"
  | "Preparing"
  | "Cooked"
  | "Ready"
  | "Arriving at Restaurant"
  | "Arrived at Restaurant"
  | "Picked Up"
  | "Out for Delivery"
  | "Reached Drop Location"
  | "Delivered"
  | "Cancelled";

export type OrderItem = {
  menuItemId?: string;
  name: string;
  image?: string;
  quantity: number;
  price: number;
};

export type RiderOrder = {
  id: string;
  orderId?: string;
  outlet: OutletId;

  assignedRider?: string;
  riderId?: string;
  riderPhone?: string;
  acceptedAt?: number;

  status: OrderStatus;
  arrivedAtRestaurantAt?: number;
  pickedUpAt?: number;
  reachedDropAt?: number;
  deliveredAt?: number;

  deliveryOTP?: string;
  otp?: string;
  otpVerifiedAt?: number;

  customerName?: string;
  customerPhone?: string;
  phone?: string;
  address: string;
  lat: number;
  lng: number;

  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  discountAmount?: number;
  paymentStatus?: string;
  paymentMethod?: "CASH" | "UPI" | "CARD";
  paymentCollected?: boolean;
  verifiedBy?: "OTP" | "ADMIN_FALLBACK";
  createdAt: string;
  source?: string;
};

/** Convenience shape used in the Pickup / Available Orders list */
export type AvailableOrder = {
  id: string;
  outlet: OutletId;
  outletName: string;
  outletIcon: string;
  outletColor: string;
  outletLat: number;
  outletLng: number;
  status: string;
  address: string;
  lat: number;
  lng: number;
  deliveryFee: number;
  total: number;
  subtotal: number;
  discountAmount?: number;
  items: OrderItem[];
  distance?: number;
  createdAt: string;
  phone?: string;
  customerPhone?: string;
};

export type Settlement = {
  id: string;
  amountCollected: number;
  ordersClearedCount: number;
  settledByAdmin: string;
  timestamp: number;
};

export type OfflineAction = {
  type: "ACCEPT_ORDER" | "UPDATE_STATUS" | "REACHED_OUTLET";
  payload: any;
  queuedAt: number;
  id: string;
};

export type OutletSettings = {
  Store: { lat: string; lng: string };
  Delivery: {
    backupCode: string;
  };
};

export type OtpAttemptRecord = {
  count: number;
  lastTry: number;
  blockedUntil: number;
  lastResend: number;
  resendCount: number;
};

export type ToastVariant = "success" | "error" | "warning" | "info";
