// === src/components/active-trip/ActionButtons.tsx ===
import { useState } from "react";
import { Phone, MessageCircle, Navigation as NavigationIcon, Menu } from "lucide-react";
import { cleanPhoneDigits, haptic } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

type NavOption = {
  label: string;
  icon: string;
  url: (lat: number, lng: number) => string;
  color: string;
};

const NAV_OPTIONS: NavOption[] = [
  {
    label: "Google Maps",
    icon: "map-pin",
    url: (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    color: "#4285F4",
  },
  {
    label: "Waze",
    icon: "navigation",
    url: (lat, lng) => `https://waze.com/ul?q=${lat},${lng}&navigate=yes`,
    color: "#34C759",
  },
  {
    label: "Apple Maps",
    icon: "map",
    url: (lat, lng) => `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
    color: "#007AFF",
  },
];

export function ActionButtons({
  phone,
  destLat,
  destLng,
}: {
  phone?: string;
  destLat: number;
  destLng: number;
}) {
  const digits = cleanPhoneDigits(phone);
  const [navOpen, setNavOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacyAction, setPrivacyAction] = useState<"call" | "chat" | null>(null);

  function call() {
    haptic(20);
    if (!digits) return;
    setPrivacyAction("call");
    setPrivacyOpen(true);
  }
  function chat() {
    haptic(20);
    if (!digits) return;
    setPrivacyAction("chat");
    setPrivacyOpen(true);
  }
  function navigateTo(app: NavOption) {
    haptic(20);
    setNavOpen(false);
    window.open(app.url(destLat, destLng), "_blank", "noopener,noreferrer");
  }

  function proceed() {
    if (!digits || !privacyAction) return;
    setPrivacyOpen(false);
    toast.info(`${privacyAction === "call" ? "Calling customer..." : "Opening WhatsApp chat..."}`);
    if (privacyAction === "call") {
      window.location.href = `tel:+${digits}`;
    } else {
      window.open(`https://wa.me/${digits}`, "_blank", "noopener,noreferrer");
    }
    setPrivacyAction(null);
  }

  return (
    <div className="flex gap-2 my-3.5">
      <button
        onClick={call}
        disabled={!digits}
        className="flex flex-1 flex-col items-center gap-1 rounded-[11px] border-[1.5px] border-border py-2.5 text-[#3B82F6] disabled:opacity-40"
      >
        <Phone size={16} />
        <span className="text-[10px] font-bold">CALL</span>
      </button>
      <button
        onClick={chat}
        disabled={!digits}
        className="flex flex-1 flex-col items-center gap-1 rounded-[11px] border-[1.5px] border-border py-2.5 text-[#10B981] disabled:opacity-40"
      >
        <MessageCircle size={16} />
        <span className="text-[10px] font-bold">CHAT</span>
      </button>
      <button
        onClick={() => setNavOpen(true)}
        className="flex flex-1 flex-col items-center gap-1 rounded-[11px] border-[1.5px] border-border py-2.5 text-primary relative"
      >
        <NavigationIcon size={16} />
        <span className="text-[10px] font-bold">NAVIGATE</span>
      </button>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent className="sm:max-w-[280px]">
          <SheetHeader>
            <SheetTitle>Open in Maps</SheetTitle>
            <SheetDescription>Choose your navigation app</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4 space-y-2">
            {NAV_OPTIONS.map((app) => (
              <button
                key={app.label}
                onClick={() => navigateTo(app)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] border border-border/60 bg-white text-[12.5px] font-semibold hover:bg-muted/50 transition-colors"
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-[8px] ${app.color}15 text-${app.color === "#4285F4" ? "blue-600" : app.color === "#34C759" ? "green-600" : "blue-600"} font-bold`}
                >
                  {app.label.charAt(0)}
                </span>
                <span className="flex-1">{app.label}</span>
                <Menu size={14} className="text-muted-foreground/50" />
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={privacyOpen} onOpenChange={setPrivacyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contact Customer</DialogTitle>
            <DialogDescription>
              {privacyAction === "call"
                ? "Calling will share your phone number with the customer."
                : "Messaging will share your phone number with the customer via WhatsApp."}
            </DialogDescription>
          </DialogHeader>
          <div className="pt-4">
            <Button onClick={proceed} disabled={!digits} className="w-full">
              {privacyAction === "call" ? "Yes, Call Customer" : "Yes, Message on WhatsApp"}
            </Button>
            <Button variant="outline" onClick={() => setPrivacyOpen(false)} className="w-full mt-2">
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
