// === src/components/orders/OrderHistory.tsx ===
import { ScrollText } from "lucide-react";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import { HistoryCard } from "@/components/orders/HistoryCard";
import { OrderSearch } from "@/components/orders/OrderSearch";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export function OrderHistory() {
  const { history, loading, error, retry, search, setSearch } = useOrderHistory();

  if (loading) return <LoadingSpinner fullscreen label="Loading trip history..." />;
  if (error) {
    return <ErrorState title="Couldn't load trip history" description="Check your connection and try again." onRetry={retry} />;
  }

  return (
    <div className="px-3.5 pt-4 pb-6">
      <h3 className="text-[15px] font-extrabold mb-3">Trip History</h3>
      <OrderSearch value={search} onChange={setSearch} />
      {history.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title={search ? "No matching deliveries" : "No completed deliveries yet"}
          description={search ? "Try a different Order ID." : "Your delivery history will show up here."}
        />
      ) : (
        history.map((o) => <HistoryCard key={o.id} order={o} />)
      )}
    </div>
  );
}
