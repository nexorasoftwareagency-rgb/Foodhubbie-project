// === src/components/active-trip/RouteOptimizer.tsx ===
import { useMemo, useState } from "react";
import { Route } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { optimizeRoute, getDeliveryStep } from "@/lib/utils";
import type { ActiveOrder } from "@/hooks/useActiveOrder";

export function RouteOptimizer({
  primary,
  secondary,
  riderLat,
  riderLng,
}: {
  primary: ActiveOrder;
  secondary: ActiveOrder[];
  riderLat: number;
  riderLng: number;
}) {
  const [open, setOpen] = useState(false);

  const stops = useMemo(() => {
    const all = [primary, ...secondary];
    return all.map((o) => {
      const step = getDeliveryStep(o);
      const atOutlet = step < 2;
      return {
        id: o.id,
        label: atOutlet ? `Pickup \u2014 ${o.outletName}` : `Drop \u2014 ${o.customerName || "Customer"}`,
        address: atOutlet ? `${o.outletName} outlet` : o.address,
        lat: atOutlet ? o.outletLat : o.lat,
        lng: atOutlet ? o.outletLng : o.lng,
      };
    });
  }, [primary, secondary]);

  const optimized = useMemo(() => optimizeRoute({ lat: riderLat, lng: riderLng }, stops), [stops, riderLat, riderLng]);

  if (secondary.length === 0) return null;

  return (
    <>
      <div className="flex items-center gap-2.5 rounded-[14px] bg-[#EAF2FF] border border-[#CFE0FF] px-3.5 py-2.5 mb-3.5">
        <Route size={16} className="text-[#1D4ED8] shrink-0" />
        <div className="min-w-0">
          <b className="block text-[12px] text-[#1D4ED8]">Multi-Order Route &middot; {secondary.length + 1} stops</b>
          <span className="block text-[10.5px] text-[#3B5FC4]">You have both a pizza and cake order active</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="ml-auto shrink-0 rounded-[9px] bg-[#1D4ED8] px-3 py-2 text-[11px] font-bold text-white"
        >
          Optimize
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader className="border-none pt-4">
            <DialogTitle>Optimized Delivery Route</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-4 max-h-[320px] overflow-y-auto">
            {optimized.map((stop, i) => (
              <div key={stop.id} className="py-2.5 border-b border-border/70 last:border-0">
                <div className="flex justify-between text-[12.5px] font-bold">
                  <span>
                    {i + 1}. {stop.label}
                  </span>
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-0.5">{stop.address}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
