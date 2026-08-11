// === src/hooks/use-toast.ts ===
import { toast as sonnerToast } from "sonner";
import { haptic } from "@/lib/utils";
import type { ToastVariant } from "@/types";

type ToastOptions = { description?: string; duration?: number };

function fire(message: string, variant: ToastVariant, options?: ToastOptions) {
  const duration = options?.duration ?? 3200;
  switch (variant) {
    case "success":
      haptic(40);
      return sonnerToast.success(message, { description: options?.description, duration });
    case "error":
      haptic([60, 40, 60]);
      return sonnerToast.error(message, { description: options?.description, duration });
    case "warning":
      haptic(60);
      return sonnerToast.warning(message, { description: options?.description, duration });
    default:
      return sonnerToast(message, { description: options?.description, duration });
  }
}

export const toast = {
  success: (message: string, options?: ToastOptions) => fire(message, "success", options),
  error: (message: string, options?: ToastOptions) => fire(message, "error", options),
  warning: (message: string, options?: ToastOptions) => fire(message, "warning", options),
  info: (message: string, options?: ToastOptions) => fire(message, "info", options),
};

/** Convenience hook form, for parity with the directory spec / familiar shadcn ergonomics. */
export function useToast() {
  return { toast };
}
