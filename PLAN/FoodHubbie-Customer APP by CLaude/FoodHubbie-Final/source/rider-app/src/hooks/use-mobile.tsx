// === src/hooks/use-mobile.tsx ===
import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 640;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : true
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", handler);
    handler();
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}
