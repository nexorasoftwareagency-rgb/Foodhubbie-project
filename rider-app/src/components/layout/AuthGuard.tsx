// === src/components/layout/AuthGuard.tsx ===
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { LoginPage } from "@/components/auth/LoginPage";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, authLoading, hadPriorSession } = useAuth();

  if (authLoading && !hadPriorSession) {
    return (
      <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-[#0F1720]">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E84908] to-[#c43d00] shadow-[0_10px_30px_rgba(232,73,8,0.35)]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="5.5" cy="17.5" r="3.5" />
            <circle cx="18.5" cy="17.5" r="3.5" />
            <path d="M15 6a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v6l4 4h2" />
            <path d="M9 17.5h6" />
            <path d="M12 6l2 5h5" />
          </svg>
        </div>
        <LoadingSpinner label="Loading Roshani Rider..." className="text-white/60" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
