// === src/services/subscribeCollection.ts ===
// Generic real-time listener utility for Firebase collections.
// Reduces boilerplate in walletService.ts, notificationService.ts, etc.

import { ref, onValue, off, Unsubscribe } from "firebase/database";
import { db } from "@/lib/firebase";

export type CollectionItem<T> = { id: string } & T;

/**
 * Subscribe to a Firebase collection (node) and map snapshots to typed array.
 * @param path - Firebase path relative to database root
 * @param callback - Called with array of items on each change
 * @param onError - Optional error handler
 * @returns Unsubscribe function
 */
export function subscribeCollection<T>(
  path: string,
  callback: (items: CollectionItem<T>[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const collectionRef = ref(db, path);
  const handler = onValue(
    collectionRef,
    (snap) => {
      const val = snap.val() || {};
      const list = Object.entries(val).map(([id, item]) => ({ id, ...(item as T) }));
      callback(list);
    },
    (err) => onError?.(err as unknown as Error)
  );
  return () => off(collectionRef, "value", handler);
}

/**
 * Subscribe to a single Firebase document (node) and map snapshot to typed object.
 * @param path - Firebase path relative to database root
 * @param callback - Called with object on each change (null if not exists)
 * @param onError - Optional error handler
 * @returns Unsubscribe function
 */
export function subscribeDocument<T>(
  path: string,
  callback: (item: T | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const docRef = ref(db, path);
  const handler = onValue(
    docRef,
    (snap) => {
      const val = snap.val();
      callback(val ? ({ ...(val as T) } as T) : null);
    },
    (err) => onError?.(err as unknown as Error)
  );
  return () => off(docRef, "value", handler);
}