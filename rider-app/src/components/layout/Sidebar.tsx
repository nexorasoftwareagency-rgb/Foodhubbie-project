// === src/components/layout/Sidebar.tsx ===
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { LayoutDashboard, ScrollText, Wallet, User, Download, RotateCcw, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRiderContext } from "@/contexts/RiderContext";
import { ConfirmDialog } from "@/components/modals/ConfirmDialog";
import { completeSiteRefresh } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { rider } = useRiderContext();
  const { logout } = useAuth();
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    setIsStandalone(standaloneQuery.matches || (window.navigator as any).standalone === true);
    const handler = (e: MediaQueryListEvent) => setIsStandalone(e.matches);
    standaloneQuery.addEventListener("change", handler);
    return () => standaloneQuery.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const initials = (rider?.name || "R")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const links = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/completed", label: "Trip History", icon: ScrollText },
    { href: "/wallet", label: "Earnings & Settlements", icon: Wallet },
    { href: "/profile", label: "My Profile", icon: User },
  ];

  const handleInstall = async () => {
    if (!installEvent) {
      toast.info("Install from your browser menu", { description: "Look for 'Add to Home Screen' or 'Install App'." });
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") toast.success("App installed!");
    setInstallEvent(null);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      setConfirmSignOut(false);
    } catch {
      toast.error("Sign out failed. Try again.");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[#0F1720]/50 transition-opacity",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed top-0 left-0 bottom-0 z-41 flex flex-col bg-card shadow-[var(--shadow-premium)] transition-transform duration-300",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ width: "min(var(--sidebar-width), 82vw)" }}
      >
        <div className="p-5 text-white bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)]">
          <div className="flex size-13 items-center justify-center rounded-full bg-white/20 text-lg font-extrabold mb-2.5">
            {initials}
          </div>
          <b className="block text-[14.5px] font-extrabold">{rider?.name || "Rider"}</b>
          <span className="text-[11px] opacity-85 font-semibold">
            {rider ? `RID-${rider.uid.slice(0, 6).toUpperCase()}` : ""}
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto p-2.5">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} onClick={onClose}>
                <div className="flex items-center gap-3 rounded-[11px] px-2.5 py-3 text-[13px] font-bold text-foreground active:bg-muted">
                  <Icon size={17} className="text-primary" />
                  {link.label}
                </div>
              </Link>
            );
          })}

          <div className="my-2.5 mx-1 h-px bg-border" />

          {!isStandalone && (
            <button
              onClick={handleInstall}
              className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-3 text-[13px] font-bold text-foreground active:bg-muted"
            >
              <Download size={17} className="text-primary" /> Install App
            </button>
          )}
          <button
            onClick={() => setConfirmReset(true)}
            className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-3 text-[13px] font-bold text-[var(--warning)] active:bg-muted"
          >
            <RotateCcw size={17} /> Reset App
          </button>
          <button
            onClick={() => setConfirmSignOut(true)}
            className="flex w-full items-center gap-3 rounded-[11px] px-2.5 py-3 text-[13px] font-bold text-destructive active:bg-muted"
          >
            <LogOut size={17} /> Sign Out
          </button>
        </nav>
      </aside>

      <ConfirmDialog
        open={confirmSignOut}
        onOpenChange={setConfirmSignOut}
        title="Sign Out"
        description="You'll need to sign in again to go Online and accept orders."
        confirmLabel="Sign Out"
        onConfirm={handleSignOut}
        loading={signingOut}
      />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset App"
        description="This clears cached data and reloads Roshani Rider fresh. Your account and delivery history are not affected."
        confirmLabel="Reset & Reload"
        destructive={false}
        onConfirm={() => completeSiteRefresh()}
      />
    </>
  );
}
