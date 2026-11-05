// === src/hooks/useSettlements.ts ===
import { useEffect, useState } from "react";
import { useAuthContext } from "@/contexts/AuthContext";
import { subscribeSettlements } from "@/services/walletService";
import { logRiderError } from "@/services/auditService";
import type { Settlement } from "@/types";

export function useSettlements() {
  const { user } = useAuthContext();
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);
    const unsubscribe = subscribeSettlements(
      user.uid,
      (list) => {
        setSettlements(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        logRiderError(user.uid, "subscribeSettlements", err);
      }
    );
    return unsubscribe;
  }, [user?.uid]);

  return { settlements, loading };
}
