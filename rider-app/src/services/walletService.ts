// === src/services/walletService.ts ===
// Roshani has no wallet/ledger system (verified against app.js — completeDelivery
// only writes riderStats). The only rider-facing financial record besides live
// order data is admin-issued settlement history.
import { db, ref, onValue, off } from "@/lib/firebase";
import { dbPaths } from "@/lib/constants";
import type { Settlement } from "@/types";

export function subscribeSettlements(
  uid: string,
  callback: (settlements: Array<Settlement>) => void,
  onError?: (err: Error) => void
) {
  const settleRef = ref(db, dbPaths.settlements(uid));
  const handler = onValue(
    settleRef,
    (snap) => {
      const val = snap.val() || {};
      const list = Object.entries(val)
        .map(([id, s]) => ({ id, ...(s as Omit<Settlement, "id">) }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      callback(list);
    },
    (err) => onError?.(err as unknown as Error)
  );
  return () => off(settleRef, "value", handler);
}
