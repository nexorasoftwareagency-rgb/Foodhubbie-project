// === src/services/ratingService.ts ===
// Customer rating pipeline for riders.
// Ratings are stored at ratings/{riderId}/{orderId} and read back to compute
// an average rating displayed on the rider's profile.
// The menu app writes ratings after delivery; this service only reads them
// (and offers a submit helper for the rider app's own rating flows).
import { db } from "@/lib/firebase";
import { ref, get, update, serverTimestamp } from "firebase/database";

export type RatingSummary = {
  average: number;
  count: number;
};

/** Submit a customer rating for a rider on a specific order. */
export async function submitRating(params: {
  riderId: string;
  orderId: string;
  rating: number;
  comment?: string;
  customerId?: string;
}): Promise<void> {
  const { riderId, orderId, rating, comment, customerId } = params;
  if (rating < 1 || rating > 5) throw new Error("Rating must be between 1 and 5");

  const ratingRef = ref(db, `ratings/${riderId}/${orderId}`);
  await update(ratingRef, {
    orderId,
    riderId,
    customerId,
    rating,
    comment: comment || null,
    createdAt: serverTimestamp(),
  });
}

/** Read all ratings for a rider and compute an average. */
export async function getRiderRating(riderId: string): Promise<RatingSummary> {
  const snap = await get(ref(db, `ratings/${riderId}`));
  const ratings = snap.val() || {};

  const values = Object.values(ratings) as Array<{ rating: number }>;
  if (!values.length) return { average: 0, count: 0 };

  const sum = values.reduce((s, r) => s + (r.rating || 0), 0);
  const average = Math.round((sum / values.length) * 10) / 10;

  return { average, count: values.length };
}

/** Subscribe to rating changes for a rider.
 *  Reads once on subscribe; real-time listener wired separately. */
export function subscribeRiderRating(
  riderId: string,
  callback: (summary: RatingSummary) => void
) {
  getRiderRating(riderId).then(callback);
  return () => {};
}
