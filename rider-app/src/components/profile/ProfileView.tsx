// === src/components/profile/ProfileView.tsx ===
import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";
import { useRiderContext } from "@/contexts/RiderContext";
import { ProfilePhoto } from "@/components/profile/ProfilePhoto";
import { ProfileDetails } from "@/components/profile/ProfileDetails";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export function ProfileView() {
  const { rider, riderLoading } = useRiderContext();
  const [, navigate] = useLocation();

  return (
    <div>
      <div className="flex items-center gap-2.5 h-[var(--header-height)] px-3.5 border-b border-border bg-card sticky top-0 z-10">
        <button onClick={() => navigate("/dashboard")} className="flex size-9 items-center justify-center rounded-[10px] bg-muted">
          <ChevronLeft size={18} />
        </button>
        <b className="text-[14.5px] font-extrabold">My Profile</b>
      </div>

      <div className="px-3.5 pt-4.5 pb-6">
        {riderLoading || !rider ? (
          <LoadingSpinner fullscreen label="Loading profile..." />
        ) : (
          <>
            <ProfilePhoto rider={rider} />
            <ProfileDetails rider={rider} />
          </>
        )}
      </div>
    </div>
  );
}
