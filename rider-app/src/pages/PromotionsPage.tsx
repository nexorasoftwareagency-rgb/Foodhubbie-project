// === src/pages/PromotionsPage.tsx ===
import { useState } from "react";
import { PromoCard } from "@/components/promotions/PromoCard";
import { PromoCodeInput } from "@/components/promotions/PromoCodeInput";
import { PromoRecordItem } from "@/components/promotions/PromoRecordItem";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// Sample promo codes - in production these come from the outlet's promotion config
const samplePromos = [
  {
    code: "WELCOME20",
    title: "Welcome Offer",
    subtitle: "First order discount",
    description: "20% off your first order",
    valid: "Valid for 7 days",
    discount: 0.2,
  },
  {
    code: "WEEKEND10",
    title: "Weekend Special",
    subtitle: "Weekend discount",
    description: "10% off orders above ₹500",
    valid: "Sat & Sun only",
    discount: 0.1,
  },
  {
    code: "FESTIVE15",
    title: "Festive Deal",
    subtitle: "Seasonal offer",
    description: "15% off all items",
    valid: "Valid until month-end",
    discount: 0.15,
  },
];

// Simulated promo usage history (in production this comes from Firebase)
const samplePromoHistory = [
  { code: "WELCOME20", discount: 200, usedAt: Date.now() - 86400000, orderId: "261105-001" },
  { code: "WEEKEND10", discount: 50, usedAt: Date.now() - 172800000, orderId: "261104-005" },
];

export function PromotionsPage() {
  const [promoCodes, setPromoCodes] = useState<{ code: string; title: string; subtitle: string; description: string; valid: string; discount: number }[]>(samplePromos);
  const [isApplied, setIsApplied] = useState<Record<string, boolean>>({});

  const handleApplyCode = (code: string) => {
    setIsApplied((prev) => ({ ...prev, [code]: true }));
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
  };

  return (
    <div className="px-3.5 pt-4 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[20px] font-extrabold">Promotions</h2>
        <div className="flex items-center gap-2">
          <span className="bg-[var(--primary-light)] text-[var(--primary-dark)] text-[10px] font-extrabold px-2 py-1 rounded-[6px]">
            Active
          </span>
        </div>
      </div>

      {/* Promo code input */}
      <div className="promo-input-wrap mb-6">
        <PromoCodeInput onApply={handleApplyCode} />
      </div>

      {/* Active offers */}
      <div className="promo-section-label">Active Offers</div>
      <div className="promo-grid">
        {promoCodes.length > 0 ? (
          promoCodes.map((promo) => (
            <PromoCard
              key={promo.code}
              code={promo.code}
              title={promo.title}
              subtitle={promo.subtitle}
              description={promo.description}
              valid={promo.valid}
              applied={isApplied[promo.code] || false}
              onApply={handleApplyCode}
              onCopy={handleCopyCode}
            />
          ))
        ) : (
          <div className="col-span-2 flex flex-col items-center justify-center py-12 text-muted-foreground">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 opacity-40">
              <path d="M3 3l18 18" />
              <circle cx="12" cy="9" r="2" />
            </svg>
            <div className="promo-empty-title">No active offers</div>
            <div className="promo-empty-sub">Check back soon for discounts and special deals from this kitchen.</div>
          </div>
        )}
      </div>

      {/* Connect links */}
      <div className="promo-divider"></div>
      <div className="promo-section-label">Connect with us</div>
      <div className="promotions-links">
        <a
          className="promo-link-card promo-link-whatsapp"
          href="https://wa.me/919724649971?text=Hi%20Roshani%20Pizza"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="promo-link-icon promo-link-whatsapp">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.5 3.5A11 11 0 0 0 2.1 17.6L1 23l5.5-1.4A11 11 0 1 0 20.5 3.5zM12 20.9a9 9 0 0 1-4.6-1.3l-.3-.2-3.4.9.9-3.3-.2-.3A9 9 0 1 1 12 20.9z" />
            </svg>
          </span>
          <span class="promo-link-body">
            <span className="promo-link-title">Chat on WhatsApp</span>
            <span className="promo-link-sub">Questions or feedback? Message us</span>
          </span>
          <svg className="promo-link-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </a>
      </div>

      {/* Promo history */}
      <div className="promo-divider"></div>
      <div className="promo-section-label">Promo History</div>
      <div className="promo-record-list">
        {samplePromos.length > 0 ? (
          samplePromos.map((record) => (
            <PromoRecordItem
              key={record.code}
              code={record.code}
              discount={record.discount}
              usedAt={record.usedAt}
              orderId={record.orderId}
            />
          ))
        ) : (
          <div className="promo-empty-title">No promo codes used yet</div>
        )}
      </div>
    </div>
  );
}