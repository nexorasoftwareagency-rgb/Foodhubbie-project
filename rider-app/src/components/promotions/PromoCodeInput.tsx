// === src/components/promotions/PromoCodeInput.tsx ===
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface PromoCodeInputProps {
  onApply: (code: string) => void;
}

export function PromoCodeInput({ onApply }: PromoCodeInputProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const knownCodes = ["WELCOME20", "WEEKEND10", "FESTIVE15"];

  const handleApply = () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter a promo code");
      return;
    }

    if (knownCodes.includes(trimmed)) {
      setError(null);
      setCode("");
      onApply(trimmed);
      toast.success(`Code "${trimmed}" applied`, {
        description: "Discount will be applied at checkout",
      });
    } else {
      setError("Invalid or expired promo code");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleApply();
    }
  };

  return (
    <div className="promo-input-wrap">
      <input
        type="text"
        id="promoCodeInput"
        className={`promo-input ${error ? "promo-input-error" : ""}`}
        placeholder="Enter promo code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.toUpperCase());
          if (code) setError(null);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      <button
        type="button"
        className="btn-apply-promo"
        onClick={handleApply}
        disabled={!code.trim()}
      >
        Apply
      </button>
    </div>
  );
}