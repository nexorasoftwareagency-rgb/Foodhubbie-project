// === src/pages/RegisterPage.tsx ===
import { RegisterForm } from "@/components/auth/RegisterForm";

export function RegisterPage() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#0F1720] px-6 py-10">
      <div className="pointer-events-none absolute -top-16 -left-16 size-[220px] rounded-full bg-[#E84908] opacity-[0.45] blur-[60px] animate-[float_9s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute bottom-10 -right-12 size-[180px] rounded-full bg-[#D946EF] opacity-[0.35] blur-[60px] animate-[float_9s_ease-in-out_infinite_2s]" />
      <div className="pointer-events-none absolute -bottom-10 left-8 size-[140px] rounded-full bg-[#10B981] opacity-[0.4] blur-[60px] animate-[float_9s_ease-in-out_infinite_4s]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
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
        <h1 className="text-center text-[19px] font-extrabold text-white tracking-tight">Create Account</h1>
        <p className="text-center text-[12.5px] text-white/55 mt-1 mb-6 leading-relaxed">
          Join as a delivery partner
          <br />
          Start accepting orders
        </p>
        <RegisterForm />
      </div>
      <style>{`
        @keyframes float { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(20px,-24px); } }
      `}</style>
    </div>
  );
}
