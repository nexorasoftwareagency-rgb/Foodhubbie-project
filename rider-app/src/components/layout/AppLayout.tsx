// === src/components/layout/AppLayout.tsx ===
import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { NotificationSheet } from "@/components/modals/NotificationSheet";
import { SyncIndicator } from "@/components/shared/SyncIndicator";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { useOfflineQueueProcessor } from "@/components/shared/OfflineQueue";
import { useRefreshAction } from "@/hooks/useRefreshAction";
import { PingModal } from "@/components/modals/PingModal";

// Full-screen "overlay" pages render their own back-button header and must not
// show the tab-bar chrome (Header/BottomNav) — they aren't one of the 4 main tabs.
const OVERLAY_ROUTES = ["/profile", "/earnings"];

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const isOverlay = OVERLAY_ROUTES.includes(location);
  const refresh = useRefreshAction();
  useOfflineQueueProcessor();

  if (isOverlay) {
    return (
      <div className="flex flex-col" style={{ minHeight: "100dvh" }}>
        {children}
        <PingModal />
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
      <Header onMenuClick={() => setSidebarOpen(true)} onNotifClick={() => setNotifOpen(true)} />
      <SyncIndicator />
      <main className="flex-1 min-h-0">
        <PullToRefresh onRefresh={refresh}>{children}</PullToRefresh>
      </main>
      <BottomNav />

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <NotificationSheet open={notifOpen} onClose={() => setNotifOpen(false)} />
      <PingModal />
    </div>
  );
}
