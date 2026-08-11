// === src/components/orders/OrderSearch.tsx ===
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function OrderSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-3.5">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Search by Order ID..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}
