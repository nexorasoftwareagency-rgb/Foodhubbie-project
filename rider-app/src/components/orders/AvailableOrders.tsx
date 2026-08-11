// === src/components/orders/AvailableOrders.tsx ===
import { PackageSearch } from "lucide-react";
import { useAvailableOrders } from "@/hooks/useAvailableOrders";
import { useRiderContext } from "@/contexts/RiderContext";
import { OrderCard } from "@/components/orders/OrderCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export function AvailableOrders() {
  const { orders, loading, error, retry } = useAvailableOrders();
  const { isOnline } = useRiderContext();

  if (loading) return <LoadingSpinner fullscreen label="Finding orders near you..." />;

  if (error) {
    return (
      <ErrorState
        title="Couldn't load available orders"
        description="Check your connection and try again."
        onRetry={retry}
      />
    );
  }

  if (!isOnline) {
    return (
      <EmptyState
        icon={<PackageSearch />}
        title="You're Offline"
        description="Go Online from the header toggle to see and accept new pickup orders."
      />
    );
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<PackageSearch />}
        title="No new orders available right now"
        description="Stay online \u2014 new pickups near you will show up here instantly."
      />
    );
  }

  return (
    <div className="px-3.5 pt-4 pb-6">
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="text-[15px] font-extrabold">Available Pickup</h3>
        <span className="rounded-full bg-[var(--primary-light)] px-2.5 py-0.5 text-[11px] font-extrabold text-[var(--primary-dark)]">
          {orders.length}
        </span>
      </div>
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} />
      ))}
    </div>
  );
}
