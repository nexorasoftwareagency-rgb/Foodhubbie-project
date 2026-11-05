// === src/components/auth/LoginPage.tsx ===
import { LoginCard } from "@/components/auth/LoginCard";

export function LoginPage() {
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
      <LoginCard />
      <style>{`
        @keyframes float { 0%, 100% { transform: translate(0,0); } 50% { transform: translate(20px,-24px); } }
      `}</style>
    </div>
  );
}
