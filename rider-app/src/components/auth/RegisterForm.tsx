// === src/components/auth/RegisterForm.tsx ===
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, User, Phone, MapPin } from "lucide-react";
import { useNavigate } from "wouter";
import { registerRider } from "@/services/authService";
import type { AuthErrorInfo } from "@/services/authService";

export function RegisterForm() {
  const [fields, setFields] = useState({
    name: "",
    identifier: "",
    password: "",
    confirmPassword: "",
    outlet: "pizza",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [, navigate] = useNavigate();

  const outlets = [
    { id: "pizza", name: "Roshani Pizza", icon: "🍕" },
    { id: "cake", name: "Roshanis Cake", icon: "🎂" },
  ];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!fields.name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!fields.identifier.trim()) {
      setError("Please enter your mobile number.");
      return;
    }
    if (!fields.password) {
      setError("Please enter a password.");
      return;
    }
    if (fields.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (fields.password !== fields.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await registerRider({
        identifier: fields.identifier,
        password: fields.password,
        name: fields.name,
        outlet: fields.outlet as any,
      });
      setSuccess("Account created successfully!");
      navigate("/dashboard");
    } catch (err: any) {
      setError((err as AuthErrorInfo)?.message || "Registration failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <div className="mb-3.5">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-white/55 mb-1.5">
          Full Name
        </label>
        <div className="flex items-center rounded-xl bg-white/[0.07] border border-white/[0.14] px-3 transition-colors">
          <User size={16} className="text-white/40" />
          <input
            type="text"
            placeholder="John Doe"
            value={fields.name}
            onChange={(e) => setFields({ ...fields, name: e.target.value })}
            autoComplete="name"
            className="flex-1 bg-transparent py-3.5 text-[14px] font-medium text-white placeholder:text-white/30 outline-none"
          />
        </div>
      </div>

      <div className="mb-3.5">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-white/55 mb-1.5">
          Mobile Number
        </label>
        <div className="flex items-center rounded-xl bg-white/[0.07] border border-white/[0.14] px-3 transition-colors">
          <Phone size={16} className="text-white/40" />
          <input
            type="text"
            inputMode="tel"
            placeholder="98765 43210"
            value={fields.identifier}
            onChange={(e) => setFields({ ...fields, identifier: e.target.value })}
            autoComplete="username"
            className="flex-1 bg-transparent py-3.5 text-[14px] font-medium text-white placeholder:text-white/30 outline-none"
          />
        </div>
      </div>

      <div className="mb-3.5">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-white/55 mb-1.5">
          Password
        </label>
        <div className="flex items-center rounded-xl bg-white/[0.07] border border-white/[0.14] px-3 transition-colors">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={fields.password}
            onChange={(e) => setFields({ ...fields, password: e.target.value })}
            autoComplete="new-password"
            className="flex-1 bg-transparent py-3.5 text-[14px] font-medium text-white placeholder:text-white/30 outline-none"
          />
          <button type="button" onClick={() => setShowPassword((s) => !s)} className="p-1 text-white/45">
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="mb-3.5">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-white/55 mb-1.5">
          Confirm Password
        </label>
        <div className="flex items-center rounded-xl bg-white/[0.07] border border-white/[0.14] px-3 transition-colors">
          <input
            type={showConfirmPassword ? "text" : "password"}
            placeholder="••••••••"
            value={fields.confirmPassword}
            onChange={(e) => setFields({ ...fields, confirmPassword: e.target.value })}
            autoComplete="new-password"
            className="flex-1 bg-transparent py-3.5 text-[14px] font-medium text-white placeholder:text-white/30 outline-none"
          />
          <button type="button" onClick={() => setShowConfirmPassword((s) => !s)} className="p-1 text-white/45">
            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className="mb-3.5">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-white/55 mb-1.5">
          Restaurant Outlet
        </label>
        <div className="flex items-center rounded-xl bg-white/[0.07] border border-white/[0.14] px-3 transition-colors">
          <MapPin size={16} className="text-white/40" />
          <select
            value={fields.outlet}
            onChange={(e) => setFields({ ...fields, outlet: e.target.value })}
            className="flex-1 bg-transparent py-3.5 text-[14px] font-medium text-white outline-none"
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.icon} {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-[11.5px] font-semibold text-[#FF8A80] mt-2 mb-1">{error}</p>}
      {success && <p className="text-[11.5px] font-semibold text-[#10B981] mt-2 mb-1">{success}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full mt-3 rounded-xl bg-gradient-to-br from-[#E84908] to-[#c43d00] py-3.5 text-[14px] font-extrabold text-white shadow-[0_10px_24px_rgba(232,73,8,0.35)] disabled:opacity-70 flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <span className="size-4 rounded-full border-2 border-white/35 border-t-white animate-spin" />
            Creating Account...
          </>
        ) : (
          "Create Account"
        )}
      </button>

      <div className="flex items-center justify-center gap-1.5 mt-4 text-[10.5px] font-medium text-white/35">
        <span className="text-white/50">Already have an account?</span>
        <button
          type="button"
          onClick={() => {
            setSuccess("");
            navigate("/");
          }}
          className="text-[#3B82F6] font-semibold hover:underline"
        >
          Sign in
        </button>
      </div>
      <p className="text-center mt-1.5 text-[10.5px] text-white/25">By creating an account, you agree to our terms.</p>
    </form>
  );
}

