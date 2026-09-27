// === src/hooks/useFirebaseConnection.ts ===
// Monitors Firebase's special `.info/connected` node (PRD §12.18) — this reflects
// the actual RTDB socket status, which is more reliable than navigator.onLine alone
// (e.g. a rider can have wifi but no real path to Firebase's servers, such as a
// captive portal or a flaky connection that still reports "online").
//
// Lives in its own file (rather than inside SyncIndicator.tsx, where it
// originated) so that OfflineQueue.tsx can also import it — SyncIndicator
// already imports from OfflineQueue.tsx, so keeping this hook there would
// create a circular import between the two.
import { useEffect, useState } from "react";
import { db, ref, onValue, off } from "@/lib/firebase";

export function useFirebaseConnection(): boolean {
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const connRef = ref(db, ".info/connected");
    const handler = onValue(connRef, (snap) => {
      setConnected(snap.val() === true);
    });
    return () => off(connRef, "value", handler);
  }, []);

  return connected;
}
