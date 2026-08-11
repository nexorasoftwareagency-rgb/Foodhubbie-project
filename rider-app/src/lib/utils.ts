// === src/lib/utils.ts ===
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { RiderOrder } from "@/types";
import { GHOST_ORDER_WINDOW_MS } from "@/lib/constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats a number as Indian Rupees with Indian digit grouping, e.g. ₹1,234.56 */
export function formatCurrency(amount: number | undefined | null, opts?: { decimals?: boolean }): string {
  const value = Number(amount) || 0;
  const decimals = opts?.decimals ?? false;
  return `\u20B9${value.toLocaleString("en-IN", {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  })}`;
}

/** Formats a timestamp (ms or ISO string) into a readable date/time, e.g. "28 Jun 2026, 10:32 AM" */
export function formatDate(input: number | string | undefined | null): string {
  if (!input) return "\u2014";
  const date = typeof input === "string" ? new Date(input) : new Date(input);
  if (isNaN(date.getTime())) return "\u2014";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Relative time string, e.g. "2m ago", "1h ago", "Yesterday", "3d ago" */
export function getRelativeTime(input: number | string | undefined | null): string {
  if (!input) return "\u2014";
  const date = typeof input === "string" ? new Date(input) : new Date(input);
  const ts = date.getTime();
  if (isNaN(ts)) return "\u2014";
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Haversine great-circle distance in km */
export function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - Math.min(a, 1)));
  return R * c;
}

export type RouteStop = { id: string; lat: number; lng: number; [key: string]: any };

/** Nearest-neighbor route optimization for multi-drop orders (a rider can hold one
 *  pizza + one cake order simultaneously since they're independent outlets). */
export function optimizeRoute<T extends RouteStop>(start: { lat: number; lng: number }, stops: T[]): T[] {
  const unvisited = [...stops];
  const route: T[] = [];
  let current = start;
  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const dist = getDistanceKm(current.lat, current.lng, unvisited[i].lat, unvisited[i].lng);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const [next] = unvisited.splice(nearestIdx, 1);
    route.push(next);
    current = next;
  }
  return route;
}

/** Maps an order's status onto the 4-step delivery pipeline used by the UI.
 *  Roshani's real pipeline has finer-grained status strings than FoodHubbie's
 *  (an explicit "Arriving at Restaurant" set at accept time, and a momentary
 *  "Picked Up" that the legacy app immediately advances to "Out for Delivery"),
 *  but they collapse onto the same 4 conceptual steps: Accept → Pickup → Transit → Drop. */
export function getDeliveryStep(order: Pick<RiderOrder, "status" | "reachedDropAt" | "pickedUpAt" | "arrivedAtRestaurantAt">): number {
  const status = (order.status || "").toLowerCase();
  if (status === "reached drop location" || order.reachedDropAt) return 3;
  if (status === "out for delivery" || status === "picked up" || order.pickedUpAt) return 2;
  if (status === "arrived at restaurant" || order.arrivedAtRestaurantAt) return 1;
  return 0;
}

/** True if an order is too old to be trustworthy */
export function isGhostOrder(createdAt: string | number | undefined, isActive: boolean): boolean {
  const orderTime = createdAt ? new Date(createdAt).getTime() : 0;
  if (isNaN(orderTime)) return true;
  return (orderTime > 0 && orderTime < Date.now() - GHOST_ORDER_WINDOW_MS) || (!orderTime && isActive);
}

/** Haptic feedback wrapper */
export function haptic(pattern: number | number[] = 40) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* no-op — unsupported browsers */
    }
  }
}

/** Masks a phone number for display, e.g. +919876543210 -> 91XXXX43210 */
export function maskPhone(phone: string | undefined | null): string {
  if (!phone) return "\u2014";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  return `${digits.slice(0, 2)}XXXX${digits.slice(-4)}`;
}

/** Masks an Aadhar number, showing only the last 4 digits */
export function maskAadhar(aadhar: string | undefined | null): string {
  if (!aadhar) return "\u2014";
  const digits = aadhar.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX XXXX XXXX";
  return `XXXX XXXX ${digits.slice(-4)}`;
}

/** Cleans a phone number down to digits only, for tel:/wa.me links and DB keys */
export function cleanPhoneDigits(phone: string | undefined | null): string {
  return (phone || "").replace(/\D/g, "");
}

/** Compresses/resizes an image File client-side before upload. Default target matches
 *  Roshani's real storage.rules limit exactly: maxRiderPhotoSize() = 300 * 1024 bytes. */
export async function compressImage(file: File, targetSizeKB = 300, maxWidth = 1024): Promise<Blob> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxWidth / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  while (blob && blob.size / 1024 > targetSizeKB && quality > 0.3) {
    quality -= 0.1;
    blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }
  if (!blob) throw new Error("Image compression failed");
  return blob;
}

/** Fully clears service workers, caches, and local state, then force-reloads */
export async function completeSiteRefresh() {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await Promise.race([
        navigator.serviceWorker.getRegistrations(),
        new Promise<ServiceWorkerRegistration[]>((resolve) => setTimeout(() => resolve([]), 2000)),
      ]);
      for (const reg of registrations) {
        await reg.unregister().catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }
  try {
    if ("caches" in window) {
      const keys = await Promise.race([
        caches.keys(),
        new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 2000)),
      ]);
      for (const key of keys) {
        await caches.delete(key).catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem("activeOrderId");
    localStorage.removeItem("activeOrderData");
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  const cleanUrl = window.location.origin + window.location.pathname;
  window.location.href = `${cleanUrl}?v=${Date.now()}&sync=${Math.random().toString(36).substring(7)}`;
}
