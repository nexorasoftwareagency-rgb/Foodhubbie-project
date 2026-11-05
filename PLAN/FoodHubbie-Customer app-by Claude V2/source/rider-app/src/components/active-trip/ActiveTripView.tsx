// === src/components/active-trip/ActiveTripView.tsx ===
import { Navigation as NavigationIcon } from "lucide-react";
import { useActiveOrder } from "@/hooks/useActiveOrder";
import { useLocationContext } from "@/contexts/LocationContext";
import { TripMap } from "@/components/active-trip/TripMap";
import { RouteOptimizer } from "@/components/active-trip/RouteOptimizer";
import { OrderTaskPanel } from "@/components/active-trip/OrderTaskPanel";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export function ActiveTripView() {
  const { activeOrder, secondaryOrders, allActiveOrders, loading, error, retry } = useActiveOrder();
  const { location } = useLocationContext();

  if (loading) return <LoadingSpinner fullscreen label="Loading your active trip..." />;

  if (error) {
    return (
      <ErrorState
        title="Couldn't load your active trip"
        description="Check your connection and try again."
        onRetry={retry}
      />
    );
  }

  if (!activeOrder) {
    return (
      <EmptyState
        icon={<NavigationIcon />}
        title="No active trip currently"
        description="Accept a pickup order from the Pickup tab to see your live delivery view here."
      />
    );
  }

  const primaryTarget = activeOrder.step < 2
    ? { lat: activeOrder.outletLat, lng: activeOrder.outletLng, label: `${activeOrder.outletIcon} ${activeOrder.outletName}`, color: activeOrder.outletColor }
    : { lat: activeOrder.lat, lng: activeOrder.lng, label: activeOrder.customerName || "Customer", color: "#1E293B" };

  const secondaryTarget = activeOrder.step < 2
    ? { lat: activeOrder.lat, lng: activeOrder.lng, label: activeOrder.customerName || "Customer", color: "#1E293B" }
    : { lat: activeOrder.outletLat, lng: activeOrder.outletLng, label: `${activeOrder.outletIcon} ${activeOrder.outletName}`, color: activeOrder.outletColor };

  return (
    <div className="px-3.5 pt-4 pb-6">
      <TripMap
        destination={primaryTarget}
        destinationLabel={primaryTarget.label}
        destinationColor={primaryTarget.color}
        secondaryStop={secondaryTarget}
      />

      {secondaryOrders.length > 0 && (
        <RouteOptimizer
          primary={activeOrder}
          secondary={secondaryOrders}
          riderLat={location?.lat ?? activeOrder.outletLat}
          riderLng={location?.lng ?? activeOrder.outletLng}
        />
      )}

      {allActiveOrders.map((order) => (
        <OrderTaskPanel key={order.id} order={order} />
      ))}
    </div>
  );
}
