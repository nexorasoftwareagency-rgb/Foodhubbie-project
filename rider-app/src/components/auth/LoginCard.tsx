// === src/components/auth/LoginCard.tsx ===
import { LoginForm } from "@/components/auth/LoginForm";

export function LoginCard() {
  return (
    <div className="relative z-[2] w-full max-w-[320px] rounded-[24px] bg-white/[0.06] border border-white/[0.12] backdrop-blur-xl p-7 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
      <div className="mx-auto mb-4 flex size-[58px] items-center justify-center rounded-[18px] bg-gradient-to-br from-[#E84908] to-[#c43d00] shadow-[0_8px_24px_rgba(232,73,8,0.35)]">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="5.5" cy="17.5" r="3.5" />
          <circle cx="18.5" cy="17.5" r="3.5" />
          <path d="M15 6a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v6l4 4h2" />
          <path d="M9 17.5h6" />
          <path d="M12 6l2 5h5" />
        </svg>
      </div>
      <h1 className="text-center text-[19px] font-extrabold text-white tracking-tight">Roshani Rider</h1>
      <p className="text-center text-[12.5px] text-white/55 mt-1 mb-6 leading-relaxed">
        Pizza &amp; Cake Delivery Partner
        <br />
        Sign in to start delivering
      </p>
      <LoginForm />
    </div>
  );
}
