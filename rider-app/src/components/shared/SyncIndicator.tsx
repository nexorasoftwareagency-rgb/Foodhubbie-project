// === src/components/shared/SyncIndicator.tsx ===
// Monitors Firebase's special `.info/connected` node (PRD §12.18) — this reflects
// the actual RTDB socket status, which is more reliable than navigator.onLine alone
// (e.g. a rider can have wifi but no path to Firebase's servers).
import { useEffect, useState } from "react";
import { db, ref, onValue, off } from "@/lib/firebase";
import { toast } from "@/hooks/use-toast";
import { WifiOff, RefreshCw } from "lucide-react";
import { useOnlineStatus, getOfflineQueue } from "@/components/shared/OfflineQueue";

export function useFirebaseConnection() {
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const connRef = ref(db, ".info/connected");
    let firstFire = true;
    const handler = onValue(connRef, (snap) => {
      const isConnected = snap.val() === true;
      setConnected(isConnected);
      if (firstFire) {
        firstFire = false;
        return;
      }
      if (isConnected) {
        toast.success("Connection Restored");
      } else {
        toast.warning("Connection Lost", { description: "Reconnecting..." });
      }
    });
    return () => off(connRef, "value", handler);
  }, []);

  return connected;
}

export function SyncIndicator() {
  const connected = useFirebaseConnection();
  const online = useOnlineStatus();
  const [queueLength, setQueueLength] = useState(0);

  useEffect(() => {
    const tick = () => setQueueLength(getOfflineQueue().length);
    tick();
    const interval = window.setInterval(tick, 1500);
    return () => window.clearInterval(interval);
  }, []);

  // Device has network and Firebase is reachable, and nothing is waiting to sync — hide entirely.
  if (connected && online && queueLength === 0) return null;

  // Regained connectivity but queued actions are still flushing.
  if ((connected || online) && queueLength > 0) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-1.5 text-[11.5px] font-semibold bg-[#EAF2FF] text-[#1D4ED8] border-b border-[#CFE0FF]">
        <RefreshCw size={13} className="animate-spin" />
        <span>
          Syncing {queueLength} action{queueLength > 1 ? "s" : ""}...
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3.5 py-1.5 text-[11.5px] font-semibold bg-[#FEF9E7] text-[#946200] border-b border-[#F5E7BC]">
      <WifiOff size={13} />
      <span>
        Offline{queueLength > 0 ? ` — ${queueLength} action${queueLength > 1 ? "s" : ""} queued` : " — reconnecting to Roshani..."}
      </span>
    </div>
  );
}
