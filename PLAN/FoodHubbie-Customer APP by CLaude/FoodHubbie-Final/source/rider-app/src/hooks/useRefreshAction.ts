// === src/hooks/useRefreshAction.ts ===
// Shared "refresh" behavior used by both the header tap-button and the pull-to-refresh
// gesture. Most data is already realtime via Firebase listeners, so this mainly
// re-runs outlet discovery (in case new restaurants came online) and gives feedback.
import { useCallback } from "react";
import { useRiderContext } from "@/contexts/RiderContext";
import { toast } from "@/hooks/use-toast";
import { haptic } from "@/lib/utils";

export function useRefreshAction() {
  const { retryOutlets } = useRiderContext();

  return useCallback(async () => {
    haptic(30);
    retryOutlets();
    await new Promise((resolve) => setTimeout(resolve, 500));
    toast.info("You're viewing live data", { description: "Everything here updates in real time." });
  }, [retryOutlets]);
}
