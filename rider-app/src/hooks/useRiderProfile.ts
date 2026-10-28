// === src/hooks/useRiderProfile.ts ===
import { useEffect, useRef, useState } from "react";
import { resolveRiderScope, subscribeRiderProfile } from "@/services/riderService";
import { armDisconnectHandlers } from "@/services/authService";
import type { Rider } from "@/types";

/** Low-level listener hook — resolves riderIndex/{uid} to learn the outlet, then
 *  subscribes to the outlet-scoped rider record. Used internally by RiderContext. */
export function useRiderProfile(uid: string | null | undefined) {
  const [rider, setRider] = useState<Rider | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unsubRef.current?.();
    unsubRef.current = null;

    if (!uid) {
      setRider(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    setLoading(true);
    setError(null);

    const start = async (): Promise<void> => {
      try {
        await resolveRiderScope(uid);
        if (cancelled) return;
        // Only armable once the scope is known — these paths are outlet-scoped.
        armDisconnectHandlers(uid);
        unsubRef.current = subscribeRiderProfile(
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
      } catch (err) {
        if (cancelled) return;
        // Self-registration writes riderIndex right after the auth account is
        // created, so the auth listener can beat that write by a moment. Retry
        // briefly before surfacing "index missing" to a brand-new rider.
        if (++attempt < 4) {
          retryTimer = setTimeout(start, 700);
          return;
        }
        setError(err as Error);
        setLoading(false);
      }
    };
    start();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [uid]);

  return { rider, loading, error };
}
