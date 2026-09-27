// === src/components/shared/SyncIndicator.tsx ===
// Monitors Firebase's special `.info/connected` node (PRD §12.18) — this reflects
// the actual RTDB socket status, which is more reliable than navigator.onLine alone
// (e.g. a rider can have wifi but no path to Firebase's servers).
import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { WifiOff, RefreshCw } from "lucide-react";
import { useOnlineStatus, getOfflineQueue } from "@/components/shared/OfflineQueue";
import { useFirebaseConnection } from "@/hooks/useFirebaseConnection";

// Re-exported for backward compatibility with any existing import of
// `useFirebaseConnection` from this file — the implementation now lives in
// src/hooks/useFirebaseConnection.ts so OfflineQueue.tsx can use it too
// without a circular import. This wrapper restores the "Connection
// Restored" / "Connection Lost" toasts that used to live inline here.
export function useFirebaseConnectionWithToast(): boolean {
  const connected = useFirebaseConnection();
  const [hasFiredOnce, setHasFiredOnce] = useState(false);

  useEffect(() => {
    if (!hasFiredOnce) {
      setHasFiredOnce(true);
      return;
    }
    if (connected) {
      toast.success("Connection Restored");
    } else {
      toast.warning("Connection Lost", { description: "Reconnecting..." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  return connected;
}

export function SyncIndicator() {
  const connected = useFirebaseConnectionWithToast();
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
        Offline{queueLength > 0 ? ` — ${queueLength} action${queueLength > 1 ? "s" : ""} queued` : " — reconnecting..."}
      </span>
    </div>
  );
}
