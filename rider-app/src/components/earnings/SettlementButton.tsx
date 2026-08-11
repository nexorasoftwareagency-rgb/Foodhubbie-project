// === src/components/earnings/SettlementButton.tsx ===
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SettlementButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="block" onClick={onClick} className="mt-1">
      <History size={15} /> View Settlement History
    </Button>
  );
}
