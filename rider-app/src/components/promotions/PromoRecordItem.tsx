// === src/components/promotions/PromoRecordItem.tsx ===
import { formatCurrency } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

interface PromoRecordItemProps {
  code: string;
  discount: number;
  usedAt: number;
  orderId: string;
}

export function PromoRecordItem({
  code,
  discount,
  usedAt,
  orderId,
}: PromoRecordItemProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-[15px]" style={{ background: `${var(--primary-light)}` }}>
          {code.charAt(0)}
        </span>
        <div>
          <div className="text-[13px] font-extrabold">{code}</div>
          <div className="text-[10.5px] font-semibold text-muted-foreground/80 mt-0.5">
            {formatOrderId(orderId)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Saved</div>
          <div className="text-[15px] font-extrabold text-[#10B981]">-{formatCurrency(discount)}</div>
        </div>
      </div>
    </div>
  );
}