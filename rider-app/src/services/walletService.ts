// === src/services/walletService.ts ===
// Roshani has no wallet/ledger system (verified against app.js — completeDelivery
// only writes riderStats). The only rider-facing financial record besides live
// order data is admin-issued settlement history.
import { dbPaths } from "@/lib/constants";
import { subscribeCollection } from "./subscribeCollection";
import { db, ref, update, serverTimestamp } from "@/lib/firebase";
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

/** Rider confirms they received the cash for a settlement. Writes
 *  `<outlet>/settlements/${uid}/${settlementId}/riderAck` so the admin can see it was received. */
export async function acknowledgeSettlement(params: {
  uid: string;
  settlementId: string;
}): Promise<void> {
  const { uid, settlementId } = params;
  const ackRef = ref(db, dbPaths.settlementAck(uid, settlementId));
  await update(ackRef, {
    settlementId,
    acknowledged: true,
    acknowledgedAt: serverTimestamp(),
    riderUid: uid,
  });
}
