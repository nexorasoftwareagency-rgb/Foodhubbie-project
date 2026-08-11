// === src/components/modals/OTPSheet.tsx ===
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { OTP_LIMITS } from "@/lib/constants";
import { toast } from "@/hooks/use-toast";
import { OtpBlockedError, getOtpAttemptsStatus } from "@/services/orderService";
import type { OutletId } from "@/lib/constants";

export function OTPSheet({
  open,
  onOpenChange,
  outlet,
  orderId,
  onVerify,
  onResend,
  onLater,
  onEmergencyOverride,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outlet: OutletId;
  orderId: string;
  onVerify: (code: string) => Promise<{ success: boolean; attemptsRemaining?: number }>;
  onResend: () => Promise<void>;
  onLater: () => void;
  onEmergencyOverride: () => void;
  isAdmin?: boolean;
}) {
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [blockedSeconds, setBlockedSeconds] = useState(0);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // The sheet unmounts on close (Radix Dialog under the hood via vaul), so local
  // cooldown/block timers would otherwise reset every reopen even though the
  // server-side rate limit is still active. Re-hydrate the real state each time.
  useEffect(() => {
    if (!open) return;
    setDigits(["", "", "", ""]);
    setError("");
    setTimeout(() => inputsRef.current[0]?.focus(), 150);

    getOtpAttemptsStatus(outlet, orderId)
      .then(({ blockedUntilMs, resendAvailableAtMs }) => {
        setBlockedSeconds(Math.ceil(blockedUntilMs / 1000));
        setResendCooldown(Math.ceil(resendAvailableAtMs / 1000));
      })
      .catch(() => {
        // Non-fatal — worst case the countdown displays start fresh and the
        // server-side check still enforces the real limit on the next attempt.
      });
  }, [open, outlet, orderId]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (blockedSeconds <= 0) return;
    const t = setTimeout(() => setBlockedSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [blockedSeconds]);

  function handleChange(i: number, value: string) {
    const clean = value.replace(/\D/g, "").slice(0, 1);
    setDigits((d) => {
      const next = [...d];
      next[i] = clean;
      return next;
    });
    if (clean && i < 3) inputsRef.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputsRef.current[i - 1]?.focus();
  }

  async function handleVerify() {
    const code = digits.join("");
    if (code.length < 4) {
      setError("Enter all 4 digits");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const result = await onVerify(code);
      if (!result.success) {
        setError(
          result.attemptsRemaining !== undefined
            ? `Incorrect OTP. ${result.attemptsRemaining} attempt(s) remaining.`
            : "Incorrect OTP."
        );
        setDigits(["", "", "", ""]);
        inputsRef.current[0]?.focus();
      }
    } catch (err) {
      if (err instanceof OtpBlockedError) {
        setBlockedSeconds(Math.ceil(err.retryAfterMs / 1000));
        setError(`Too many attempts. Try again in ${Math.ceil(err.retryAfterMs / 1000)}s.`);
      } else {
        setError("Verification failed. Try again.");
      }
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    try {
      await onResend();
      setResendCooldown(OTP_LIMITS.RESEND_COOLDOWN_MS / 1000);
      toast.success("New OTP sent to customer");
    } catch (err: any) {
      toast.error(err?.message || "Could not resend OTP right now.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Trip Complete</SheetTitle>
          <SheetDescription>Enter the 4-digit verification code from the customer.</SheetDescription>
        </SheetHeader>
        <div className="px-5 pt-2">
          <div className="flex justify-center gap-3 mb-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputsRef.current[i] = el; }}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                inputMode="numeric"
                maxLength={1}
                disabled={blockedSeconds > 0}
                className="size-13 rounded-2xl border-2 border-border text-center text-2xl font-extrabold outline-none focus:border-primary disabled:opacity-50"
              />
            ))}
          </div>
          {error && <p className="text-center text-[11.5px] font-bold text-destructive min-h-4 mb-1">{error}</p>}
          {blockedSeconds > 0 && (
            <p className="text-center text-[11px] text-muted-foreground mb-1">Try again in {blockedSeconds}s</p>
          )}
        </div>
        <SheetFooter>
          <Button size="block" onClick={handleVerify} disabled={verifying || blockedSeconds > 0}>
            {verifying ? "Verifying..." : "VERIFY"}
          </Button>
          <Button variant="outline" size="block" onClick={handleResend} disabled={resendCooldown > 0}>
            {resendCooldown > 0 ? `RESEND IN ${resendCooldown}s` : "REGENERATE & SEND OTP"}
          </Button>
          <Button variant="ghost" size="block" onClick={onLater}>
            LATER
          </Button>
          {isAdmin && (
            <Button variant="destructive" size="block" onClick={onEmergencyOverride}>
              EMERGENCY OVERRIDE
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
