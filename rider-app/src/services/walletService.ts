// === src/services/walletService.ts ===
// Roshani has no wallet/ledger system (verified against app.js — completeDelivery
// only writes riderStats). The only rider-facing financial record besides live
// order data is admin-issued settlement history.
import { dbPaths } from "@/lib/constants";
import { subscribeCollection } from "./subscribeCollection";
import type { Settlement } from "@/types";

export function subscribeSettlements(
  uid: string,
  callback: (settlements: Array<Settlement>) => void,
  onError?: (err: Error) => void
) {
  return subscribeCollection<Settlement>(
    dbPaths.settlements(uid),
    (list) => {
      const sorted = list
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      callback(sorted as Settlement[]);
    },
    onError
  );
}
