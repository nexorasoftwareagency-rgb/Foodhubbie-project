// === src/pages/NotFoundPage.tsx ===
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Compass } from "lucide-react";

export function NotFoundPage() {
  const [, navigate] = useLocation();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-8 text-center">
      <Compass size={40} className="text-muted-foreground mb-3.5" />
      <h2 className="text-[16px] font-extrabold mb-1.5">Page not found</h2>
      <p className="text-[12.5px] text-muted-foreground mb-5">This screen doesn't exist in Roshani Rider.</p>
      <Button onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
    </div>
  );
}
