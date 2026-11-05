// === src/components/layout/BottomNav.tsx ===
import { Link, useLocation } from "wouter";
import { Home, ShoppingBag, Navigation, Wallet } from "lucide-react";
import { useAvailableOrders } from "@/hooks/useAvailableOrders";
import { CountBadge } from "@/components/shared/CountBadge";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/utils";

const TABS = [
  { path: "/dashboard", label: "HOME", icon: Home, alsoMatch: ["/"] },
  { path: "/available", label: "PICKUP", icon: ShoppingBag, alsoMatch: [] as string[] },
  { path: "/active", label: "LIVE", icon: Navigation, alsoMatch: [] as string[] },
  { path: "/wallet", label: "WALLET", icon: Wallet, alsoMatch: [] as string[] },
];

export function BottomNav() {
  const [location] = useLocation();
  const { orders } = useAvailableOrders();

  return (
    <nav
      className="flex bg-card border-t border-border sticky bottom-0 z-20"
      style={{ height: "var(--bottom-nav-height)" }}
    >
      {TABS.map((tab) => {
        const active = location === tab.path || tab.alsoMatch.includes(location);
        const Icon = tab.icon;
        return (
          <Link key={tab.path} href={tab.path} onClick={() => haptic(20)} className="flex-1">
            <div
              className={cn(
                "relative flex h-full flex-col items-center justify-center gap-0.5",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-b-[4px] bg-primary" />
              )}
              <div className="relative">
                <Icon size={20} strokeWidth={2.2} />
                {tab.label === "PICKUP" && orders.length > 0 && (
                  <CountBadge count={orders.length} className="absolute -top-1.5 -right-2" />
                )}
              </div>
              <span className="text-[10px] font-extrabold tracking-wide">{tab.label}</span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
