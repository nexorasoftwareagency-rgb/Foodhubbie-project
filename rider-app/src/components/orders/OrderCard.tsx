// === src/components/orders/OrderCard.tsx ===
import { useState } from "react";
import { useLocation } from "wouter";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useRiderContext } from "@/contexts/RiderContext";
import { useLocationContext } from "@/contexts/LocationContext";
import { acceptOrder, OrderTakenError, ProximityError } from "@/services/orderService";
import { enqueueOfflineAction } from "@/components/shared/OfflineQueue";
import { logRiderError } from "@/services/auditService";
import { toast } from "@/hooks/use-toast";
import { formatCurrency, cn } from "@/lib/utils";
import type { AvailableOrder } from "@/types";

export function OrderCard({ order }: { order: AvailableOrder }) {
  const { user } = useAuth();
  const { rider } = useRiderContext();
  const { location } = useLocationContext();
  const [, navigate] = useLocation();
  const [accepting, setAccepting] = useState(false);

  async function handleAccept() {
    if (!user?.uid || !user.email || accepting) return;
    setAccepting(true);
    const payload = {
      outlet: order.outlet,
      orderId: order.id,
      riderEmail: user.email,
      riderUid: user.uid,
      riderPhone: rider?.phone || "",
      riderName: rider?.name || "Your rider",
      outletLat: order.outletLat,
      outletLng: order.outletLng,
      customerPhone: order.customerPhone || order.phone,
    };

    if (!navigator.onLine) {
      enqueueOfflineAction("ACCEPT_ORDER", payload);
      toast.warning("You're offline", { description: "This order will be accepted automatically once you're back online." });
      setAccepting(false);
      return;
    }

    try {
      const riderLat = location?.lat ?? order.outletLat;
      const riderLng = location?.lng ?? order.outletLng;
      await acceptOrder({ ...payload, riderLat, riderLng, accuracy: location?.accuracy });
      toast.success("Order Accepted!", { description: "Head to the outlet to pick it up." });
      navigate("/active");
    } catch (err) {
      if (err instanceof OrderTakenError) {
        toast.error("Already taken", { description: "Another rider accepted this order first." });
      } else if (err instanceof ProximityError) {
        toast.error("Too far from outlet", { description: err.message });
      } else {
        toast.error("Could not accept order");
        if (user?.uid) logRiderError(user.uid, "OrderCard.acceptOrder", err);
      }
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="rounded-[20px] bg-card border border-border/70 shadow-[var(--shadow-card)] p-3.5 mb-3">
      <div className="flex items-start justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-[15px]"
            style={{ background: `${order.outletColor}1A` }}
          >
            {order.outletIcon}
          </span>
          <div>
            <div className="text-[14px] font-extrabold">{order.outletName}</div>
            <div className="text-[10.5px] font-semibold text-muted-foreground/80 mt-0.5">#{order.id.slice(-8)}</div>
          </div>
        </div>
        <Badge variant="success">READY</Badge>
      </div>

      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground mb-2.5">
        <MapPin size={12} />
        {order.distance !== undefined ? `${order.distance.toFixed(1)} km away` : ""}
      </div>

      <div className="rounded-[10px] bg-muted px-2.5 py-2 text-[11.5px] mb-2.5">{order.address}</div>

      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Your Earning</div>
          <div className="text-[15px] font-extrabold text-[#10B981]">{formatCurrency(order.deliveryFee)}</div>
        </div>
        <div className="text-right">
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">Order Total</div>
          <div className="text-[15px] font-extrabold">{formatCurrency(order.total)}</div>
        </div>
      </div>

      <button
        onClick={handleAccept}
        disabled={accepting}
        className={cn(
          "w-full rounded-[11px] py-3 text-[12.5px] font-extrabold tracking-wide text-white shadow-[0_6px_16px_var(--primary-glow)] disabled:opacity-60 active:scale-[0.98] transition-transform"
        )}
        style={{ background: accepting ? undefined : order.outletColor }}
      >
        {accepting ? "ACCEPTING..." : "ACCEPT ORDER"}
      </button>
    </div>
  );
}
