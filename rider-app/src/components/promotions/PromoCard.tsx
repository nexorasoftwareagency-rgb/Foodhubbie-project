// === src/components/promotions/PromoCard.tsx ===
interface PromoCardProps {
  code: string;
  title: string;
  subtitle: string;
  description: string;
  valid: string;
  applied: boolean;
  onApply: (code: string) => void;
  onCopy: (code: string) => void;
}

export function PromoCard({
  code,
  title,
  subtitle,
  description,
  valid,
  applied,
  onApply,
  onCopy,
}: PromoCardProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    onCopy(code);
  };

  return (
    <div className="promo-card">
      <div className="promo-card-header">
        <span className="promo-badge">{code}</span>
      </div>
      <div className="promo-card-title">{title}</div>
      <div className="promo-card-sub">{subtitle}</div>
      <div className="promo-card-terms">{description} · {valid}</div>
      <div className="promo-card-actions">
        <button
          type="button"
          className="promo-btn-copy"
          onClick={handleCopy}
          title="Copy code"
        >
          Copy Code
        </button>
        <button
          type="button"
          className="promo-btn-apply"
          onClick={() => onApply(code)}
          disabled={applied}
        >
          {applied ? "Applied" : "Apply"}
        </button>
      </div>
    </div>
  );
}