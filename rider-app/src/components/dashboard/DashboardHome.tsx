// === src/components/dashboard/DashboardHome.tsx ===
import { useRiderContext } from "@/contexts/RiderContext";
import { useActiveOrder } from "@/hooks/useActiveOrder";
import { PerformanceGrid } from "@/components/dashboard/PerformanceGrid";
import { EarningsSummary } from "@/components/dashboard/EarningsSummary";
import { ActiveDeliveryCard } from "@/components/dashboard/ActiveDeliveryCard";
import { TripMap } from "@/components/active-trip/TripMap";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ErrorState } from "@/components/shared/ErrorState";

export function DashboardHome() {
  const { rider, riderLoading, riderError, isOnline } = useRiderContext();
  const { activeOrder } = useActiveOrder();

  const firstName = (rider?.name || "").split(" ")[0] || "Rider";
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  if (riderLoading) {
    return <LoadingSpinner fullscreen label="Loading your dashboard..." />;
  }

  if (riderError) {
    return (
      <ErrorState
        title="Couldn't load your profile"
        description="Check your connection and try again."
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="px-3.5 pb-6 pt-4">
      <div className="mb-1">
        <h2 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Welcome, <b className="text-primary">{firstName}!</b>
        </h2>
        <p className="text-[12.5px] text-muted-foreground mt-0.5">Ready for your next delivery?</p>
        <div className="text-[11px] font-semibold text-muted-foreground/70 mt-1.5">{today}</div>
      </div>

      <PerformanceGrid />
      <EarningsSummary />
      <ActiveDeliveryCard />

      {!activeOrder && isOnline && <TripMap />}
    </div>
  );
}
