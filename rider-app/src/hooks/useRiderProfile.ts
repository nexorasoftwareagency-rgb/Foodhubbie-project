// === src/hooks/useRiderProfile.ts ===
import { useEffect, useState } from "react";
import { subscribeRiderProfile } from "@/services/riderService";
import type { Rider } from "@/types";

/** Low-level listener hook — subscribes directly to riders/{uid}. Used internally by RiderContext. */
export function useRiderProfile(uid: string | null | undefined) {
  const [rider, setRider] = useState<Rider | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) {
      setRider(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const unsubscribe = subscribeRiderProfile(
      uid,
      (r) => {
        setRider(r);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [uid]);

  return { rider, loading, error };
}
