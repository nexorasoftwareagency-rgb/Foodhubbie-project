// === src/components/auth/LoginForm.tsx ===
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { AuthErrorInfo } from "@/services/authService";

export function LoginForm() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError("Enter your mobile number and password.");
      return;
    }
    setSubmitting(true);
    try {
      await login(identifier, password);
    } catch (err) {
      setError((err as AuthErrorInfo)?.message || "Sign in failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="mb-3.5">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-white/55 mb-1.5">
          Mobile Number
        </label>
        <div className="flex items-center rounded-xl bg-white/[0.07] border border-white/[0.14] focus-within:border-primary focus-within:bg-white/[0.1] px-3 transition-colors">
          <input
            type="text"
            inputMode="tel"
            placeholder="98765 43210"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            className="flex-1 bg-transparent py-3.5 text-[14px] font-medium text-white placeholder:text-white/30 outline-none"
          />
        </div>
      </div>

      <div className="mb-2">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-white/55 mb-1.5">Password</label>
        <div className="flex items-center rounded-xl bg-white/[0.07] border border-white/[0.14] focus-within:border-primary focus-within:bg-white/[0.1] px-3 transition-colors">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="flex-1 bg-transparent py-3.5 text-[14px] font-medium text-white placeholder:text-white/30 outline-none"
          />
          <button type="button" onClick={() => setShowPassword((s) => !s)} className="p-1 text-white/45">
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {error && <p className="text-[11.5px] font-semibold text-[#FF8A80] mt-2 mb-1">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full mt-3 rounded-xl bg-gradient-to-br from-[#E84908] to-[#c43d00] py-3.5 text-[14px] font-extrabold text-white shadow-[0_10px_24px_rgba(232,73,8,0.35)] disabled:opacity-70 flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <span className="size-4 rounded-full border-2 border-white/35 border-t-white animate-spin" />
            Signing in...
          </>
        ) : (
          "Sign In & Start Delivering"
        )}
      </button>

      <div className="flex items-center justify-center gap-1.5 mt-4 text-[10.5px] font-medium text-white/35">
        <ShieldCheck size={12} /> Secured with Firebase Auth &amp; App Check
      </div>
      <p className="text-center mt-1.5 text-[10.5px] text-white/25">Contact your admin if you forgot your credentials</p>
    </form>
  );
}
