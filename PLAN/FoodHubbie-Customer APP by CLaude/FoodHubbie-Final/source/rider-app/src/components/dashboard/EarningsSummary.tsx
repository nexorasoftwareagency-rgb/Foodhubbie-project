// === src/components/dashboard/EarningsSummary.tsx ===
import { useLocation } from "wouter";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EarningsSummary() {
  const [, navigate] = useLocation();
  return (
    <Button variant="outline" size="block" onClick={() => navigate("/earnings")} className="mb-4">
      <BarChart3 size={15} /> View Detailed Stats
    </Button>
  );
}
