// === src/components/active-trip/ActionButtons.tsx ===
import { Phone, MessageCircle, Navigation as NavigationIcon } from "lucide-react";
import { cleanPhoneDigits, haptic } from "@/lib/utils";

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

  function call() {
    haptic(20);
    if (!digits) return;
    window.location.href = `tel:+${digits}`;
  }
  function chat() {
    haptic(20);
    if (!digits) return;
    window.open(`https://wa.me/${digits}`, "_blank", "noopener,noreferrer");
  }
  function navigateTo() {
    haptic(20);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`, "_blank", "noopener,noreferrer");
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
        onClick={navigateTo}
        className="flex flex-1 flex-col items-center gap-1 rounded-[11px] border-[1.5px] border-border py-2.5 text-primary"
      >
        <NavigationIcon size={16} />
        <span className="text-[10px] font-bold">NAVIGATE</span>
      </button>
    </div>
  );
}
